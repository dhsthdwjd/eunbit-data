"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {phoneIn, toNational, toLocal, rowsOf, errorOf, sortBenefits} = require("../scripts/benefits");

test("phoneIn 은 문의처에서 전화번호를 꺼낸다", () => {
  assert.equal(phoneIn("033-736-5000"), "033-736-5000");
  assert.equal(phoneIn("보건복지상담센터 129"), "129");
  assert.equal(phoneIn("1577-1000(국민연금)"), "1577-1000");
  assert.equal(phoneIn("읍면동 주민센터"), null);
});

test("rowsOf 는 <servList> 항목을 읽고, errorOf 는 실패 코드를 알려준다", () => {
  const xml = "<wantedList><totalCount>1</totalCount><resultCode>0</resultCode><resultMessage>SUCCESS</resultMessage>" +
    "<servList><servId>WLF1</servId><servNm>기초연금</servNm></servList></wantedList>";
  assert.deepEqual(rowsOf(xml), [{servId: "WLF1", servNm: "기초연금"}]);
  assert.equal(errorOf(xml), null);
  assert.match(errorOf("<wantedList><resultCode>10</resultCode><resultMessage>INVALID</resultMessage></wantedList>"), /resultCode=10/);
});

test("toNational·toLocal 은 같은 모양으로 바꾼다", () => {
  const n = toNational({servId: "W1", servNm: "기초연금", servDgst: "요약", jurMnofNm: "보건복지부", jurOrgNm: "기초연금과",
    lifeArray: "노년", rprsCtadr: "129", onapPsbltYn: "Y", inqNum: "10", servDtlLink: "https://x"});
  assert.equal(n.scope, "national");
  assert.equal(n.org, "보건복지부 기초연금과");
  assert.equal(n.phone, "129");
  assert.equal(n.seniorOnly, true);
  const l = toLocal({servId: "W2", servNm: "효행장려", ctpvNm: "경기도", sggNm: "양주시", lifeNmArray: "노년, 중장년",
    aplyMtdNm: "방문", servDtlLink: "https://y"});
  assert.equal(l.region, "gyeonggi");
  assert.equal(l.sigungu, "양주시");
  assert.equal(l.seniorOnly, false);
});

test("sortBenefits 는 노년 전용을 먼저, 그다음 조회수 순", () => {
  const out = sortBenefits([
    {name: "a", seniorOnly: false, views: 100},
    {name: "b", seniorOnly: true, views: 1},
    {name: "c", seniorOnly: true, views: 50},
  ]);
  assert.deepEqual(out.map((x) => x.name), ["c", "b", "a"]);
});

test("toLocal 은 '-'나 기관 이름처럼 시군구가 아닌 값을 버린다", () => {
  assert.equal(toLocal({servId: "a", servNm: "x", ctpvNm: "경기도", sggNm: "-", servDtlLink: "l"}).sigungu, null);
  assert.equal(toLocal({servId: "b", servNm: "x", ctpvNm: "인천광역시", sggNm: "인천광역시교육청", servDtlLink: "l"}).sigungu, null);
  assert.equal(toLocal({servId: "c", servNm: "x", ctpvNm: "경기도", sggNm: "가평군", servDtlLink: "l"}).sigungu, "가평군");
});
