"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {sigunguOf, kindOf, toCenter, fillMissingRegions} = require("../scripts/centers");

test("sigunguOf 는 붙어 있는 동 이름을 떼고 시·군·구만 남긴다", () => {
  assert.equal(sigunguOf("서울특별시 강북구수유동 "), "강북구");
  assert.equal(sigunguOf("경기 안산시 상록구 일동 125"), "안산시");
  assert.equal(sigunguOf("전라남도 장성군 장성읍 영천리 1184-8"), "장성군");
  assert.equal(sigunguOf("세종특별자치시"), null);
});

test("kindOf 는 이름으로 기관 종류를 나눈다", () => {
  assert.equal(kindOf("장성시니어클럽"), "시니어클럽");
  assert.equal(kindOf("비산노인종합복지관(일자리)"), "노인복지관");
  assert.equal(kindOf("대한노인회 충주시지회"), "대한노인회");
  assert.equal(kindOf("사단법인 청풍위장회"), "기타 기관");
});

test("toCenter 는 지역을 붙이고 (일자리) 꼬리를 뗀다", () => {
  const c = toCenter({orgCd: "0000009", orgName: "비산노인종합복지관(일자리)", zipAddr: "경기도 안양시 동안구 비산동", dtlAddr: "315-5"});
  assert.equal(c.name, "비산노인종합복지관");
  assert.equal(c.region, "gyeonggi");
  assert.equal(c.sigungu, "안양시");
  assert.equal(c.address, "경기도 안양시 동안구 비산동 315-5");
});

test("sigunguOf 는 띄어쓰기 없는 주소도 읽는다", () => {
  assert.equal(sigunguOf("대전중구호동88-6 사회복지법인"), "중구");
  assert.equal(sigunguOf("전라남도강진군강진읍남성리7"), "강진군");
  assert.equal(sigunguOf("천안시 서북구 미라11길"), null);
});

test("fillMissingRegions 는 시군구 줄기로 지역을 채우고 겹치는 줄기는 쓰지 않는다", () => {
  const known = [
    {id: "1", name: "a", region: "chungnam", sigungu: "천안시"},
    {id: "2", name: "b", region: "jeonnam_gwangju", sigungu: "곡성군"},
    {id: "3", name: "c", region: "busan", sigungu: "동구"},
    {id: "4", name: "d", region: "incheon", sigungu: "동구"},
  ];
  const out = fillMissingRegions([...known,
    {id: "5", name: "천안시노인종합복지관", region: null, sigungu: null, address: "천안시 서북구 미라11길 16번지"},
    {id: "6", name: "곡성시니어클럽", region: null, sigungu: null, address: null},
    {id: "7", name: "정나눔노인복지센터", region: null, sigungu: null, address: "동구 소태동 532-157"},
  ]);
  assert.equal(out[4].region, "chungnam");
  assert.equal(out[4].sigungu, "천안시");
  assert.equal(out[5].region, "jeonnam_gwangju");
  assert.equal(out[6].region, null);
});
