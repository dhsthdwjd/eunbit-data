// 어르신(노년) 복지서비스·지원금 목록 → docs/benefits.json
// 복지로(한국사회보장정보원) 중앙부처·지자체 복지서비스 API 의 "목록"만 쓴다.
// 개발계정 호출 한도가 하루 100회라 상세 조회는 하지 않고, 상세는 복지로 링크(servDtlLink)로 연결한다.
// 하루 한 번이면 충분해서, 파일이 20시간 안에 갱신됐으면 건너뛴다 (FORCE=1 이면 무조건 실행)
// 로컬 실행: DATA_GO_KR_KEY=키 node scripts/benefits.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {parseItems, apiError, regionOf, encodeKey, str} = require("./lib");

const OUT = path.join(__dirname, "..", "docs", "benefits.json");
const NATIONAL_URL = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001";
const LOCAL_URL = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist";
const LIFE_SENIOR = "006"; // 생애주기 코드: 노년
const PAGE_SIZE = 500; // API 최대
const MIN_INTERVAL_MS = 20 * 3600 * 1000;

/** "아동,청소년, 노년" → ["아동", "청소년", "노년"] */
function list(v) {
  return (str(v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** 문의처 문자열에서 전화번호 하나 (없으면 null). "129", "033-736-5000" 등 */
function phoneIn(v) {
  const m = (str(v) ?? "").match(/\d{2,4}-\d{3,4}-\d{4}|\b1\d{2,3}(-\d{4})?\b/);
  return m ? m[0] : null;
}

function toNational(r) {
  return {
    id: String(r.servId),
    scope: "national",
    name: str(r.servNm),
    summary: str(r.servDgst),
    org: [str(r.jurMnofNm), str(r.jurOrgNm)].filter(Boolean).join(" ") || null,
    region: null,
    sigungu: null,
    type: str(r.srvPvsnNm),
    cycle: str(r.sprtCycNm),
    apply: r.onapPsbltYn === "Y" ? "온라인 신청 가능" : null,
    contact: str(r.rprsCtadr),
    phone: phoneIn(r.rprsCtadr),
    seniorOnly: list(r.lifeArray).join() === "노년",
    views: Number(r.inqNum) || 0,
    link: str(r.servDtlLink),
  };
}

function toLocal(r) {
  return {
    id: String(r.servId),
    scope: "local",
    name: str(r.servNm),
    summary: str(r.servDgst),
    org: str(r.bizChrDeptNm),
    region: regionOf(r.ctpvNm),
    // 시도 단위 지원은 시군구가 "-"나 교육청 이름으로 와서, 시·군·구로 끝나는 이름만 쓴다 (나머지는 시도 전체 지원)
    sigungu: /(시|군|구)$/.test(str(r.sggNm) ?? "") ? str(r.sggNm) : null,
    type: str(r.srvPvsnNm),
    cycle: str(r.sprtCycNm),
    apply: str(r.aplyMtdNm),
    contact: null,
    phone: null,
    seniorOnly: list(r.lifeNmArray).join() === "노년",
    views: Number(r.inqNum) || 0,
    link: str(r.servDtlLink),
  };
}

/** 응답 루트가 <wantedList> 이고 항목 태그가 <servList> 라서 parseItems 용으로 바꿔 읽는다 */
function rowsOf(xml) {
  return parseItems(xml.replace(/<servList>/g, "<item>").replace(/<\/servList>/g, "</item>"));
}

function errorOf(xml) {
  const code = xml.match(/<resultCode>([^<]*)</);
  if (code && code[1] !== "0" && code[1] !== "00") {
    const msg = xml.match(/<resultMessage>([^<]*)</);
    return `resultCode=${code[1]} ${msg ? msg[1] : ""}`.trim();
  }
  return code ? null : apiError(xml);
}

async function fetchAll({key, url, extra, fetchText}) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const xml = await fetchText(`${url}?serviceKey=${encodeKey(key)}&pageNo=${page}&numOfRows=${PAGE_SIZE}${extra}`);
    const err = errorOf(xml);
    if (err) throw new Error(`복지서비스 API 오류(page ${page}): ${err}`);
    const rows = rowsOf(xml);
    all.push(...rows);
    const total = Number((xml.match(/<totalCount>(\d+)</) || [])[1]) || 0;
    if (rows.length < PAGE_SIZE || all.length >= total) break;
  }
  return all;
}

async function fetchText(url) {
  const res = await fetch(url, {signal: AbortSignal.timeout(60_000)});
  return res.text();
}

/** 노년 전용 먼저, 그다음 많이 본 순 */
function sortBenefits(list) {
  return list.sort((a, b) => (b.seniorOnly - a.seniorOnly) || (b.views - a.views) || a.name.localeCompare(b.name, "ko"));
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY 환경변수가 없어요.");
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (e) { /* 첫 실행 */ }
  const now = new Date();
  if (prev && !process.env.FORCE && now - new Date(prev.updatedAt) < MIN_INTERVAL_MS) {
    console.log("지원금 목록: 최근에 갱신해서 건너뜀");
    return;
  }

  let national;
  let local;
  try {
    national = (await fetchAll({key, url: NATIONAL_URL, extra: `&callTp=L&srchKeyCode=001&lifeArray=${LIFE_SENIOR}`, fetchText})).map(toNational);
    local = (await fetchAll({key, url: LOCAL_URL, extra: `&lifeArray=${LIFE_SENIOR}`, fetchText})).map(toLocal);
  } catch (e) {
    console.warn(`::warning::지원금 목록 수집 실패 (${e.message}). 이전 데이터 유지`);
    return;
  }
  const byId = new Map();
  for (const b of [...national, ...local.filter((b) => b.region)]) if (b.name && b.link) byId.set(b.id, b);
  const benefits = sortBenefits([...byId.values()]);

  if (prev && JSON.stringify(prev.benefits) === JSON.stringify(benefits)) {
    fs.writeFileSync(OUT, JSON.stringify({...prev, updatedAt: now.toISOString()}));
    console.log(`지원금 목록: 변경 없음 (${benefits.length}건)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({version: 1, updatedAt: now.toISOString(), benefits}));
  console.log(`지원금 목록: 전국 ${national.length}건, 지자체 ${benefits.length - national.length}건`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {phoneIn, toNational, toLocal, rowsOf, errorOf, sortBenefits};
