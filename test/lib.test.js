"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../scripts/lib");
const {merge} = require("../scripts/sync");

const item = (fields) =>
  `<item>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</item>`;
const page = (items, code = "00") =>
  `<?xml version="1.0"?><response><header><resultCode>${code}</resultCode>` +
  `<resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items.join("")}</items>` +
  `<numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>9</totalCount></body></response>`;

test("parseItems 는 item 을 평평한 객체로 읽고 엔티티를 푼다", () => {
  const rows = lib.parseItems(page([item({jobId: "A1", recrtTitle: "경비 &amp; 미화&#xD;"})]));
  assert.deepEqual(rows, [{jobId: "A1", recrtTitle: "경비 & 미화\r"}]);
});

test("apiError 는 정상 응답은 null, 키 오류는 메시지", () => {
  assert.equal(lib.apiError(page([])), null);
  assert.match(lib.apiError(page([], "30")), /resultCode=30/);
  assert.equal(
    lib.apiError("<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR" +
      "</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"),
    "SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
});

test("regionOf 는 표기가 달라도 같은 지역으로 묶는다", () => {
  assert.equal(lib.regionOf("경기 이천시"), "gyeonggi");
  assert.equal(lib.regionOf("경기도 화성시 동탄구"), "gyeonggi");
  assert.equal(lib.regionOf("전남광주 무안군"), "jeonnam_gwangju");
  assert.equal(lib.regionOf("07946 서울특별시 양천구 공항대로 538"), "seoul");
  assert.equal(lib.regionOf("24764 강원특별자치도 고성군"), "gangwon");
  assert.equal(lib.regionOf("전라북도 전주시"), "jeonbuk");
  assert.equal(lib.regionOf(""), null);
  assert.equal(lib.regionOf("해외"), null);
});

test("phoneOf 는 0000 으로 채운 번호를 버린다", () => {
  assert.equal(lib.phoneOf("031-869-9956"), "031-869-9956");
  assert.equal(lib.phoneOf("0000-4618-4112"), null);
  assert.equal(lib.phoneOf(""), null);
});

test("toJob 은 고용형태 이름을 붙이고 날짜를 ISO 로 바꾼다", () => {
  const j = lib.toJob({
    jobId: "K1", recrtTitle: " 아파트  미화원 ", oranNm: "효명", workPlcNm: "서울 강동구",
    emplymShp: "CM0103", deadline: "접수중", frDd: "20261012", toDd: "20261211", stmNm: "워크넷",
  });
  assert.equal(j.title, "아파트 미화원");
  assert.equal(j.typeName, "시간제");
  assert.equal(j.region, "seoul");
  assert.equal(j.regionFrom, "workplace");
  assert.equal(j.startDate, "2026-10-12");
  assert.equal(j.closeDate, "2026-12-11");
});

test("fetchOpenJobs 는 접수 중 공고가 없는 페이지에서 멈춘다", async () => {
  const open = (id) => item({jobId: id, deadline: "접수중", toDd: "20261231"});
  const closed = (id) => item({jobId: id, deadline: "마감", toDd: "20260101"});
  const pages = [
    page(Array.from({length: 100}, (_, i) => (i < 60 ? open(`O${i}`) : closed(`C${i}`)))),
    page(Array.from({length: 100}, (_, i) => closed(`D${i}`))),
    page([open("never")]),
  ];
  let calls = 0;
  const jobs = await lib.fetchOpenJobs({
    key: "k", today: "2026-10-13", fetchText: async () => pages[calls++],
  });
  assert.equal(calls, 2);
  assert.equal(jobs.length, 60);
});

test("fillRegion 은 근무지가 없으면 주소로 채우고 알림 대상에서 뺀다", () => {
  const job = {id: "1", title: "t", region: null, regionFrom: null, detail: {address: "22003 인천광역시 연수구"}};
  const filled = lib.fillRegion(job);
  assert.equal(filled.region, "incheon");
  assert.equal(filled.regionFrom, "address");
  assert.deepEqual(lib.buildMessages([filled]), []);
});

test("buildMessages 는 지역별로 묶는다", () => {
  const a = {id: "1", title: "경비원", region: "seoul", regionFrom: "workplace"};
  const b = {id: "2", title: "미화원", region: "seoul", regionFrom: "workplace"};
  const c = {id: "3", title: "주차", region: "busan", regionFrom: "workplace"};
  const msgs = lib.buildMessages([a, b, c]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].topic, "job_seoul");
  assert.equal(msgs[0].notification.title, "[서울] 새 일자리 2건");
  assert.equal(msgs[0].data.jobId, "");
  assert.equal(msgs[1].data.jobId, "3");
});

test("merge 는 이전 상세와 처음 본 시각을 이어받고 새 공고만 표시한다", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const prev = {jobs: [{id: "old", firstSeenAt: "2026-10-01T00:00:00Z", detail: {age: 60}}]};
  const {jobs, newIds} = merge(prev, [{id: "old"}, {id: "new"}], now);
  assert.equal(jobs.find((j) => j.id === "old").firstSeenAt, "2026-10-01T00:00:00Z");
  assert.deepEqual(jobs.find((j) => j.id === "old").detail, {age: 60});
  assert.deepEqual([...newIds], ["new"]);
  assert.equal(merge(null, [{id: "x"}], now).newIds.size, 0);
});
