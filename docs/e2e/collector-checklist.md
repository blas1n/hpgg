# E2E 체크리스트 — collector (비웹, 사람/Claude 가 직접 실행)

전제: `~/Works/hotsmeta/.env` 에 `HP_API_TOKEN`, 계정 Data mode = **Test Data**(무과금). 라이브 항목은 별도 표시.

## 테스트 데이터 모드
- [x] `uv run python -m collector` 가 exit 0 으로 끝난다 (5콜, 콜 사이 60초 대기 → 약 4~5분) — 2026-09-28 run2: EXIT=0, 5분 06초, 첫 콜 429→Retry-After 60 대기 후 성공
- [x] `data/latest/{qm,sl,sl_low,sl_mid,sl_high,meta}.json` 6개가 생기고 `meta.json` 의 `current_patch` 가 `/v1/patches` 의 최신 `valid_globals` 빌드와 같다 — 2.55.17.97771 (테스트 모드 목록 기준)
- [x] `data/.snapshot_out/<오늘>/` 에 `raw_*.json.gz` 5개 + 정규화 gz 5개 + meta.json 이 있다 — 11개 확인
- [x] 로그(JSON)에 토큰 문자열이 없다 — grep 0회 (httpx 의 URL 로그도 WARNING 으로 내려 URL 자체가 안 찍힘)
- [ ] 두 번째 실행에서 `patch_started_at` 이 첫 실행 값 그대로다(패치 불변) — 유닛 `test_build_meta_first_run_and_patch_change` 로는 검증됨. 실제 연속 실행은 Actions 첫 이틀치 cron 에서 확인할 것
- [x] 잘못된 토큰(`HP_API_TOKEN=bad uv run python -m collector`)이면 exit 1, `data/latest/` 는 이전 내용 그대로 (2026-09-28 확인: `401 unauthenticated`, 파일 없음, 로그에 토큰 0회)
- [x] 테스트 데이터는 5영웅·`wins` 만 오고 **group_by_map 이 무시된 flat 응답**이다 → `normalize.flat_payload` 경고 5회, `map:"all"` 행 5개로 저장, 크래시 없음

## 라이브 전환 후 (1콜 = 주 70 중 1, 형님 승인 뒤)
- [ ] `raw_qm.json.gz` 를 열어 `data[]` 행의 실제 필드를 적는다 → `docs/DESIGN-2026-09-28.md` 의 "라이브 행 필드" 미지수 닫기
- [ ] `qm.json` 의 `map: "all"` 행 Illidan 의 `win_rate` 가 HP 웹 Global/Hero(QM, 최신 minor) 표시값과 ±0.1 안에서 같다
- [ ] `sl_high.json`(league_tier 5,6) 의 매치 수가 `sl.json` 보다 작다
- [ ] 첫 콜이 202 면 폴링 로그(`hp.poll`)가 찍히고 결국 200 으로 끝난다
