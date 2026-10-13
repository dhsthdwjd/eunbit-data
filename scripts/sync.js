// GitHub Actions 에서 매시간 실행: 노인 구인공고 수집 → docs/jobs.json 갱신 → 새 공고 FCM 푸시
// 로컬 실행: DATA_GO_KR_KEY=키 node scripts/sync.js   (FIREBASE_SERVICE_ACCOUNT 없으면 푸시는 건너뜀)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {fetchOpenJobs, fetchDetail, fillRegion, isOpen, buildMessages} = require("./lib");

const OUT = path.join(__dirname, "..", "docs", "jobs.json");
// 한 번 실행에 상세를 받을 최대 공고 수. 나머지는 다음 실행에
const DETAIL_PER_RUN = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 연결 실패(네트워크·타임아웃·5xx)는 잠깐 쉬고 최대 3번까지 다시 시도 */
async function fetchText(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {signal: AbortSignal.timeout(30_000)});
      if (res.status >= 500 && i < tries) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(3000 * i);
    }
  }
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (e) {
    return null;
  }
}

function kstToday(now) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 이전 파일과 새로 받은 공고를 합친다.
 * - 목록이 접수 중인 공고 전체라서, 이번에 없는 공고는 마감된 것으로 보고 뺀다
 * - firstSeenAt 으로 처음 본 시각을, detail 로 이전에 받은 상세를 이어받는다
 * 반환: {jobs, newIds}  (이전 파일이 없으면 첫 실행이라 newIds 는 비움)
 */
function merge(prev, fetched, now) {
  const prevById = new Map((prev?.jobs ?? []).map((j) => [j.id, j]));
  const nowIso = now.toISOString();
  const newIds = new Set();
  const jobs = fetched.map((j) => {
    const old = prevById.get(j.id);
    if (!old && prev) newIds.add(j.id);
    return {
      ...j,
      firstSeenAt: old?.firstSeenAt ?? nowIso,
      ...(old?.detail ? {detail: old.detail} : {}),
    };
  });
  jobs.sort((a, b) =>
    (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id.localeCompare(b.id));
  return {jobs, newIds};
}

/** 상세가 없는 공고(새 공고)의 상세를 받는다 */
async function fillDetails(key, jobs) {
  const need = jobs.filter((j) => !j.detail);
  let ok = 0;
  let fail = 0;
  for (const j of need.slice(0, DETAIL_PER_RUN)) {
    try {
      const detail = await fetchDetail({key, id: j.id, fetchText});
      if (detail) j.detail = detail;
      ok++;
    } catch (e) {
      fail++;
      console.warn(e.message);
      if (/SERVICE_KEY|LIMITED|TRAFFIC|resultCode=(20|22|30)/i.test(e.message)) break; // 키·한도 문제면 그만
    }
  }
  console.log(`상세 정보: 대상 ${need.length}건 중 ${ok}건 갱신, 실패 ${fail}건`);
}

async function sendPush(newJobs) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log("FIREBASE_SERVICE_ACCOUNT 없음: 푸시 건너뜀");
    return 0;
  }
  const admin = require("firebase-admin");
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(raw))});
  const msgs = buildMessages(newJobs);
  let sent = 0;
  for (let i = 0; i < msgs.length; i += 500) {
    const res = await admin.messaging().sendEach(msgs.slice(i, i + 500));
    sent += res.successCount;
  }
  return sent;
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY 환경변수가 없어요.");
  const now = new Date();
  const today = kstToday(now);
  const prev = readPrevious();

  let fetched;
  try {
    fetched = await fetchOpenJobs({key, today, fetchText});
  } catch (e) {
    // 목록을 끝까지 못 받으면 마감 판단이 틀어진다. 이전 데이터를 그대로 두고 다음 실행에 다시 시도
    console.warn(`::warning::목록 수집 실패 (${e.message}). 이전 데이터 유지, 다음 실행에 다시 시도`);
    return;
  }

  const merged = merge(prev, fetched, now);
  await fillDetails(key, merged.jobs);
  const jobs = merged.jobs.map(fillRegion).filter((j) => isOpen(j, today));

  // 내용이 같으면 파일을 건드리지 않는다 → 커밋·배포 없음
  if (prev && JSON.stringify(prev.jobs) === JSON.stringify(jobs)) {
    console.log(`변경 없음 (공고 ${jobs.length}건)`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({version: 1, updatedAt: now.toISOString(), jobs}));

  const newJobs = jobs.filter((j) => merged.newIds.has(j.id));
  const sent = newJobs.length ? await sendPush(newJobs) : 0;
  console.log(`공고 ${jobs.length}건, 신규 ${newJobs.length}건, 알림 ${sent}건` +
    (prev ? "" : " (첫 실행: 알림 생략)"));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {merge};
