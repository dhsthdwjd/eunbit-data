# eunbit-data

은빛일터 앱의 공고 데이터 저장소. 노인 구인공고를 모아 `docs/jobs.json` 하나로 만들고, 새 공고가 올라오면 지역별 FCM 푸시를 보낸다.

## 동작 방식

1. GitHub Actions(`sync.yml`)가 한국시간 07~22시 매시 23분에 실행
2. 한국노인인력개발원 노인 구인정보 API(`SenuriService/getJobList`)를 최신순으로 받아, 접수 중인 공고가 없는 페이지가 나오면 멈춤 (보통 6페이지, 약 300건)
3. 새 공고는 상세 API(`getJobInfo`)로 담당자·연락처·주소·연령·모집인원을 채움 (한 번에 최대 200건)
4. `docs/jobs.json`이 바뀌었을 때만 커밋 → GitHub Pages로 배포
   - 주소: `https://dhsthdwjd.github.io/eunbit-data/jobs.json` (앱 `values/strings.xml`의 `data_url`)
5. 처음 보는 공고면 FCM 토픽 `job_{지역키}`로 푸시 (지역키는 `scripts/lib.js`의 `REGIONS`)

## 지역을 정하는 방법

- 목록의 근무지(`workPlcNm`)가 있으면 그 지역 (`regionFrom: "workplace"`). 지역 알림을 보낸다.
- 근무지가 없으면 상세의 사업장 주소로 정한다 (`regionFrom: "address"`). 사업장 주소는 본사 주소라 실제 근무지와 다를 수 있어서, 앱에 "사업장 주소 기준"으로 표시하고 알림은 보내지 않는다.
- 광주·전남은 API에 "전남광주"로 와서 `jeonnam_gwangju` 하나로 묶는다.

## 설정

Settings → Secrets and variables → Actions:
- `DATA_GO_KR_KEY`: 공공데이터포털 서비스키 (노인 구인정보 API 활용신청)
- `FIREBASE_SERVICE_ACCOUNT`: Firebase 서비스 계정 JSON 전체 (`insta-chat-bc957` 프로젝트). 없으면 푸시만 건너뜀

Settings → Pages: Source `Deploy from a branch`, 브랜치 `main` / 폴더 `/docs`

## 로컬 실행

```
npm ci
npm test
DATA_GO_KR_KEY=키 node scripts/sync.js
```

## 호출량

한 번 실행에 목록 약 6회 + 새 공고 상세. 하루 16번 실행해도 개발계정 한도(하루 10,000회)보다 훨씬 적다.
