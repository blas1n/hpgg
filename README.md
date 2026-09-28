# hotsmeta.kr (히오스 티어표)

체감과 맞는 한국어 Heroes of the Storm 티어표. 빠대 기본, 스톰 리그(맵별·구간별) 토글. 데이터는 Heroes Profile API v1 을 하루 한 번 끌어와 정적 JSON 으로 서빙한다. 설계: `docs/DESIGN-2026-09-28.md`.

## 구성
- `collector/` — Python 3.11+ 수집기. `uv run python -m collector` 가 하루치 5콜(빠대 · 리그 전체 · 리그 구간 1-2 / 3-4 / 5-6, 전부 `group_by_map=true`)을 60초 간격으로 부르고 `data/latest/{qm,sl,sl_low,sl_mid,sl_high,meta}.json` 을 **원자적으로** 교체한다. 원본 응답은 `data/.snapshot_out/<날짜>/*.json.gz` 로 남겨 `snapshots` 브랜치에 보관한다.
- `data/latest/` — 프론트 계약(스키마는 설계 문서 "latest JSON 스키마").
- `web/` — (2단계) Vite + TS 정적 프론트.
- `.github/workflows/collect-and-deploy.yml` — cron 매일 1회 수집·커밋·스냅샷 보관 → Pages 배포. `push:main` 은 배포만.

## 로컬 실행
```bash
cp .env.example .env   # HP_API_TOKEN 채우기 (api 계정 → API Keys)
uv sync
uv run pytest tests/ --cov=collector --cov-fail-under=80
uv run ruff check collector/ tests/ && uv run ruff format --check collector/ tests/ && uv run mypy collector/
uv run python -m collector      # 약 5분 (분당 1콜 제한)
```
Heroes Profile 계정의 Data mode 가 **Test Data** 면 쿼터를 안 쓰고 플레이스홀더가 온다. Live 로 바꾸면 실제 데이터(Heroes/Stats 주 70콜, 하루 5콜 사용).

## 규칙
- 토큰은 `.env` 에만. 로그·예외·커밋에 절대 안 나온다(테스트로 단언).
- 에러 응답·202 폴링은 HP 가 과금하지 않는다. 재시도는 5xx/transport 1회, 429 는 Retry-After 만큼 대기 후 1회.
- 데이터 출처 표기: "Data provided by Heroes Profile".
