// 노인 구인정보 API(한국노인인력개발원 SenuriService) 호출·가공 로직 (Firebase 없이도 테스트 가능하게 분리)
"use strict";

const BASE_URL = "https://apis.data.go.kr/B552474/SenuriService";
const PAGE_SIZE = 100;
const DETAIL_VERSION = 2;

// 고용형태 (emplymShp). API 의 emplymShpNm 에도 코드가 그대로 와서 이름은 여기서 붙인다
const EMPLOYMENT = {
  CM0101: "정규직",
  CM0102: "계약직",
  CM0103: "시간제",
  CM0104: "일당직",
  CM0105: "기타",
};

// 지역 키 → 이름. 키는 FCM 토픽 job_{키} 에 쓰므로 영문. 앱의 지역 목록과 같게
const REGIONS = {
  seoul: "서울",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  daejeon: "대전",
  ulsan: "울산",
  sejong: "세종",
  gyeonggi: "경기",
  gangwon: "강원",
  chungbuk: "충북",
  chungnam: "충남",
  jeonbuk: "전북",
  jeonnam_gwangju: "전남광주",
  gyeongbuk: "경북",
  gyeongnam: "경남",
  jeju: "제주",
};

// 주소·근무지 첫 단어 → 지역 키. "경기"/"경기도"/"경기도청" 처럼 앞부분만 맞으면 된다
// 광주·전남은 통합특별시로 합쳐져 API 에 "전남광주"로 온다. 예전 표기도 같은 키로 묶는다
const REGION_PREFIXES = [
  ["전남광주", "jeonnam_gwangju"],
  ["광주", "jeonnam_gwangju"],
  ["전라남", "jeonnam_gwangju"],
  ["전남", "jeonnam_gwangju"],
  ["전라북", "jeonbuk"],
  ["전북", "jeonbuk"],
  ["서울", "seoul"],
  ["부산", "busan"],
  ["대구", "daegu"],
  ["인천", "incheon"],
  ["대전", "daejeon"],
  ["울산", "ulsan"],
  ["세종", "sejong"],
  ["경기", "gyeonggi"],
  ["강원", "gangwon"],
  ["충청북", "chungbuk"],
  ["충북", "chungbuk"],
  ["충청남", "chungnam"],
  ["충남", "chungnam"],
  ["경상북", "gyeongbuk"],
  ["경북", "gyeongbuk"],
  ["경상남", "gyeongnam"],
  ["경남", "gyeongnam"],
  ["제주", "jeju"],
];

function str(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** "20261012" → "2026-10-12" (못 읽으면 null) */
function toIso(v) {
  if (v == null) return null;
  const d = String(v).replace(/\D/g, "");
  if (d.length < 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function decodeXml(s) {
  return s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&");
}

/** 응답 XML 의 <item> 들을 {태그: 값} 객체 배열로. 이 API 의 item 은 한 단계로 평평하다 */
function parseItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const obj = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) obj[f[1]] = decodeXml(f[2]);
    items.push(obj);
  }
  return items;
}

/** 키 오류·한도 초과 등. 정상이면 null */
function apiError(xml) {
  if (typeof xml !== "string") return "응답 없음";
  const gateway = xml.match(/<returnAuthMsg>([^<]+)</) || xml.match(/<errMsg>([^<]+)</);
  if (gateway) return gateway[1];
  const code = xml.match(/<resultCode>([^<]*)</);
  if (!code) return "XML 이 아닌 응답";
  if (code[1] !== "00" && code[1] !== "0000") {
    const msg = xml.match(/<resultMsg>([^<]*)</);
    return `resultCode=${code[1]} ${msg ? msg[1] : ""}`.trim();
  }
  return null;
}

/** 근무지명·주소 → 지역 키 (못 찾으면 null). 주소 앞의 우편번호는 건너뛴다 */
function regionOf(text) {
  const s = str(text);
  if (!s) return null;
  const first = s.replace(/^\d{5}\s*/, "").split(" ")[0];
  for (const [prefix, key] of REGION_PREFIXES) {
    if (first.startsWith(prefix)) return key;
  }
  return null;
}

/** 여러 줄 글: 줄바꿈은 살리고 줄 안의 공백만 정리, 빈 줄은 뺀다 */
function multiline(v) {
  if (v == null) return null;
  const lines = String(v).replace(/\r\n?/g, "\n").split("\n")
      .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
      .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

// 공고 등록 화면의 우대 조건 체크 항목. 우대사항(etcItm) 맨 앞에 ", " 로 이어 붙어 온다
const PREFERENCE_TAGS = [
  "(준)고령자(50세이상)", "고용촉진장려금대상자", "보훈취업지원대상자", "장기복무 제대군인",
  "북한이탈주민", "고용허가제", "장애인", "운전면허증", "차량소지자", "여성가장", "국가유공자",
];

/** 우대사항 앞의 체크 항목을 떼어낸다 → {tags, rest}. 목록에 없는 항목을 만나면 거기서 멈춘다 */
function splitPreferences(text) {
  const tags = [];
  let rest = text ?? "";
  for (;;) {
    const tag = PREFERENCE_TAGS.find((t) => rest.startsWith(t) && /^($|[,\s])/.test(rest.slice(t.length)));
    if (!tag) break;
    tags.push(tag);
    rest = rest.slice(tag.length).replace(/^,\s*/, "");
    if (!rest.startsWith(",") && /^\s/.test(rest)) { rest = rest.trimStart(); if (!PREFERENCE_TAGS.some((t) => rest.startsWith(t))) break; }
  }
  return {tags, rest: rest.trim() || null};
}

/** "0000-4618-4112" 처럼 자리를 채운 값은 걸 수 없는 번호라 버린다 */
function phoneOf(v) {
  const s = str(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || /^0000/.test(digits)) return null;
  return s;
}

function urlOf(v) {
  const s = str(v);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `http://${s}`;
  return null;
}

/** 목록 API 한 줄 → 앱에서 쓰는 공고 객체 (상세·지역 보정 전) */
function toJob(r) {
  const place = str(r.workPlcNm);
  const typeCode = str(r.emplymShp);
  return {
    id: String(r.jobId),
    title: str(r.recrtTitle) || "노인 구인공고",
    company: str(r.oranNm),
    place,
    region: regionOf(place),
    regionFrom: place ? "workplace" : null,
    typeCode,
    typeName: EMPLOYMENT[typeCode] || null,
    jobName: str(r.jobclsNm),
    applyMethod: str(r.acptMthd),
    status: str(r.deadline),
    startDate: toIso(r.frDd),
    closeDate: toIso(r.toDd),
    source: str(r.stmNm),
  };
}

/** 상세 API 한 줄 → 공고에 붙일 상세 정보 */
function toDetail(r) {
  const count = Number(str(r.clltPrnnum));
  const age = Number(str(r.age));
  return {
    age: Number.isFinite(age) && age > 0 ? age : null,
    count: Number.isFinite(count) && count > 0 ? count : null,
    clerk: str(r.clerk),
    phone: phoneOf(r.clerkContt),
    address: str(r.plDetAddr),
    business: str(r.plbizNm),
    ...(() => {
      const {tags, rest} = splitPreferences(multiline(r.etcItm));
      return {etcTags: tags, etc: rest};
    })(),
    // 상세 형식이 바뀌면 올린다 → sync 가 예전 형식 상세를 다시 받는다
    v: DETAIL_VERSION,
    homepage: urlOf(r.homepage),
  };
}

function isOpen(job, today) {
  if (job.status && job.status !== "접수중") return false;
  return !job.closeDate || job.closeDate >= today;
}

function encodeKey(key) {
  // 이미 인코딩된 키(%2B 등 포함)는 그대로, 아니면 인코딩
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

/**
 * 접수 중인 공고를 모두 가져온다. 목록이 최신순이라 접수 중이 하나도 없는 페이지가 나오면 멈춘다.
 * fetchText(url) 은 응답 본문 문자열을 돌려주는 함수 (테스트용 주입).
 */
async function fetchOpenJobs({key, today, fetchText, maxPages = 20}) {
  const got = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}/getJobList?serviceKey=${encodeKey(key)}` +
      `&pageNo=${page}&numOfRows=${PAGE_SIZE}`;
    const xml = await fetchText(url);
    const err = apiError(xml);
    if (err) throw new Error(`목록 API 오류(page ${page}): ${err}`);
    const rows = parseItems(xml);
    const open = rows.map(toJob).filter((j) => isOpen(j, today));
    open.forEach((j) => got.set(j.id, j));
    if (rows.length < PAGE_SIZE || open.length === 0) break;
  }
  return [...got.values()];
}

async function fetchDetail({key, id, fetchText}) {
  const url = `${BASE_URL}/getJobInfo?serviceKey=${encodeKey(key)}&id=${encodeURIComponent(id)}`;
  const xml = await fetchText(url);
  const err = apiError(xml);
  if (err) throw new Error(`상세 API 오류(${id}): ${err}`);
  const row = parseItems(xml)[0];
  return row ? toDetail(row) : null;
}

/** 목록에 근무지가 없으면 상세의 사업장(본사) 주소로 지역을 채운다. 이 경우 알림은 보내지 않는다 */
function fillRegion(job) {
  if (job.region || !job.detail?.address) return job;
  const region = regionOf(job.detail.address);
  return region ? {...job, region, regionFrom: "address"} : job;
}

function topicOf(region) {
  return `job_${region}`;
}

/** 근무지로 지역이 정해진 새 공고만 지역별로 묶어 알림 메시지를 만든다 */
function buildMessages(newJobs) {
  const byRegion = new Map();
  for (const j of newJobs) {
    if (!j.region || j.regionFrom !== "workplace") continue;
    if (!byRegion.has(j.region)) byRegion.set(j.region, []);
    byRegion.get(j.region).push(j);
  }
  const msgs = [];
  for (const [region, list] of byRegion) {
    const first = list[0];
    const name = REGIONS[region];
    msgs.push({
      topic: topicOf(region),
      notification: {
        title: list.length === 1 ? `[${name}] 새 일자리` : `[${name}] 새 일자리 ${list.length}건`,
        body: list.length === 1 ? first.title : `${first.title} 외 ${list.length - 1}건`,
      },
      data: {jobId: list.length === 1 ? first.id : ""},
      android: {
        priority: "high",
        notification: {channelId: "new_job"},
      },
    });
  }
  return msgs;
}

module.exports = {
  DETAIL_VERSION,
  multiline,
  splitPreferences,
  BASE_URL,
  EMPLOYMENT,
  REGIONS,
  str,
  toIso,
  parseItems,
  apiError,
  regionOf,
  phoneOf,
  urlOf,
  toJob,
  toDetail,
  isOpen,
  encodeKey,
  fetchOpenJobs,
  fetchDetail,
  fillRegion,
  topicOf,
  buildMessages,
};
