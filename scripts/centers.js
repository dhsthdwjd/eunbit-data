// 노인일자리 수행기관(시니어클럽·노인복지관 등) 목록 → docs/centers.json
// API 가 전화번호를 가려서 주므로 이름·종류·주소만 담는다. 앱은 이름으로 지도 검색을 열어 전화번호를 보여준다.
// 하루 한 번이면 충분해서, 파일이 20시간 안에 갱신됐으면 건너뛴다 (FORCE=1 이면 무조건 실행)
// 로컬 실행: DATA_GO_KR_KEY=키 node scripts/centers.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {parseItems, apiError, regionOf, encodeKey, str, REGIONS} = require("./lib");

const OUT = path.join(__dirname, "..", "docs", "centers.json");
const LIST_URL = "https://apis.data.go.kr/B552474/JobBsnInfoService/getJobOperInsttList";
const PAGE_SIZE = 1000;
const MIN_INTERVAL_MS = 20 * 3600 * 1000;

/** "서울특별시 강북구수유동" → "강북구", "경기 안산시 상록구 일동" → "안산시" (시·군·구 첫 단위) */
// 시도 표기 (긴 것부터). 주소 앞에서 떼어내고 남은 부분에서 시·군·구를 찾는다
const SIDO = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|전남광주통합특별시|전남광주|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;

function sigunguOf(addr, {requireSido = true} = {}) {
  const s = str(addr);
  if (!s) return null;
  let rest = s.replace(/^\d{3}-?\d{3}\s*/, "").replace(/\s+/g, "");
  if (SIDO.test(rest)) rest = rest.replace(SIDO, "");
  else if (requireSido) return null;
  const m = rest.match(/^(.+?(?:시|군|구))/);
  return m ? m[1] : null;
}

/** 시·군·구 이름에서 끝 글자를 뗀 줄기 ("곡성군" → "곡성"). 두 글자면 그대로 */
function stemOf(sigungu) {
  return sigungu.length > 2 ? sigungu.slice(0, -1) : sigungu;
}

/**
 * 주소에 시도가 없거나 주소가 비어 있는 기관의 지역을 채운다.
 * 지역이 확인된 기관들로 "시군구 줄기 → 지역" 표를 만들고, 주소나 이름 앞부분이 줄기와 맞으면 그 지역으로.
 * 동구·중구처럼 여러 지역에 있는 줄기는 쓰지 않는다.
 */
function fillMissingRegions(centers) {
  const byStem = new Map();
  for (const c of centers) {
    if (!c.region || !c.sigungu) continue;
    const stem = stemOf(c.sigungu);
    if (!byStem.has(stem)) byStem.set(stem, new Map());
    byStem.get(stem).set(c.region, c.sigungu);
  }
  const stems = [...byStem.entries()]
      .filter(([, regions]) => regions.size === 1)
      .sort((a, b) => b[0].length - a[0].length);
  return centers.map((c) => {
    if (c.region) return c;
    const texts = [c.address, c.name].map((t) => (t ?? "").replace(/^\d{3}-?\d{3}\s*/, "").replace(/\s+/g, ""));
    for (const t of texts) {
      const hit = stems.find(([stem]) => stem.length >= 2 && t.startsWith(stem));
      if (hit) {
        const [region, sigungu] = [...hit[1].entries()][0];
        return {...c, region, sigungu: c.sigungu ?? sigungu};
      }
    }
    return c;
  });
}

/** 기관 이름으로 종류를 나눈다 (API 의 기관유형은 모두 "수행기관"이라 쓸모가 없음) */
function kindOf(name) {
  if (/시니어클럽/.test(name)) return "시니어클럽";
  if (/복지관/.test(name)) return "노인복지관";
  if (/노인회/.test(name)) return "대한노인회";
  if (/지역자활|자활센터/.test(name)) return "자활센터";
  if (/센터/.test(name)) return "지원센터";
  return "기타 기관";
}

function toCenter(r) {
  const name = str(r.orgName);
  if (!name) return null;
  const zip = str(r.zipAddr);
  const detail = str(r.dtlAddr);
  const address = [zip, detail].filter(Boolean).join(" ") || null;
  // 주소에 시도가 없으면 이름 앞의 시도("인천광역시동구…", "광주광산…")로
  const region = regionOf(zip) ?? regionOf(name);
  return {
    id: String(r.orgCd),
    name: name.replace(/\(일자리\)$/, "").trim(),
    kind: kindOf(name),
    region,
    sigungu: sigunguOf(zip) ?? sigunguOf(name),
    address,
  };
}

async function fetchText(url) {
  const res = await fetch(url, {signal: AbortSignal.timeout(60_000)});
  return res.text();
}

async function fetchCenters({key, year, fetchText}) {
  const all = new Map();
  for (let page = 1; page <= 10; page++) {
    const url = `${LIST_URL}?serviceKey=${encodeKey(key)}&pageNo=${page}&numOfRows=${PAGE_SIZE}&projYear=${year}`;
    const xml = await fetchText(url);
    const err = apiError(xml);
    if (err) throw new Error(`수행기관 API 오류(page ${page}): ${err}`);
    const rows = parseItems(xml);
    rows.map(toCenter).filter(Boolean).forEach((c) => all.set(c.id, c));
    if (rows.length < PAGE_SIZE) break;
  }
  return [...all.values()];
}

function sortCenters(list) {
  const order = Object.keys(REGIONS);
  return list.sort((a, b) =>
    (order.indexOf(a.region) - order.indexOf(b.region)) ||
    (a.sigungu ?? "").localeCompare(b.sigungu ?? "", "ko") ||
    a.name.localeCompare(b.name, "ko"));
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
    console.log("센터 목록: 최근에 갱신해서 건너뜀");
    return;
  }

  // 올해 사업 기관. 연초에 아직 등록 전이면 작년 목록을 쓴다
  const year = new Date(now.getTime() + 9 * 3600 * 1000).getUTCFullYear();
  let centers;
  try {
    centers = await fetchCenters({key, year, fetchText});
    if (centers.length < 100) centers = await fetchCenters({key, year: year - 1, fetchText});
  } catch (e) {
    console.warn(`::warning::센터 목록 수집 실패 (${e.message}). 이전 데이터 유지`);
    return;
  }
  const total = centers.length;
  centers = sortCenters(fillMissingRegions(centers).filter((c) => c.region));
  if (centers.length < total) console.log(`센터 목록: 지역을 못 정한 ${total - centers.length}곳 제외`);
  if (prev && JSON.stringify(prev.centers) === JSON.stringify(centers)) {
    // 내용이 같아도 갱신 시각은 남겨야 하루 한 번만 받는다
    fs.writeFileSync(OUT, JSON.stringify({...prev, updatedAt: now.toISOString()}));
    console.log(`센터 목록: 변경 없음 (${centers.length}곳)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({version: 1, updatedAt: now.toISOString(), centers}));
  console.log(`센터 목록: ${centers.length}곳`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {sigunguOf, kindOf, toCenter, fillMissingRegions};
