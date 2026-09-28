# STATUS — hotsmeta.kr

세션은 여기서 시작한다. 인수인계는 `docs/HANDOFF.md`.

## 2026-09-28
- 설계 확정: `docs/DESIGN-2026-09-28.md` (office-hours, 적대 리뷰 3회 8/10, API v1 실측 반영).
- **collector 1차 완료** (`05d6e0b`): 31 tests, 92% cov, ruff·mypy clean. E2E 체크리스트 `docs/e2e/collector-checklist.md` — 테스트 모드 6/7 확인, 연속 실행(patch_started_at 유지)은 Actions 첫 cron 이틀치로 확인.
- HP API 계정: Basic $5, **Data mode = Test Data**(무과금, group_by_map 무시된 flat 5영웅 응답). Live 전환은 형님이 결정.
- 도메인 hotsmeta.kr / .gg: **아직 미등록**(형님 직접).

## 다음
1. GitHub 레포 생성·push, Actions secret `HP_API_TOKEN`, `snapshots` orphan 브랜치 1회 생성, Pages 설정. 워크플로 초안 `.github/workflows/collect-and-deploy.yml` 은 미검증.
2. Live 전환 후 첫 실행 → `raw_qm.json.gz` 로 `data[]` 행 실제 필드 확정 → 픽스처·정규화 갱신(설계 문서 미지수 하나).
3. web/ (Vite+TS): 티어표 1페이지 — 공식 `formula.ts` 는 설계 문서 검산표 13영웅으로 vitest.
