# HANDOFF (덮어쓰기)

마지막 갱신 2026-09-28. 상태는 `docs/STATUS.md`.

- 코드는 collector 만 있다. `uv run python -m collector` 는 테스트 모드에서 5분 걸린다(group_by_map 분당 1콜). 첫 콜이 429 로 시작하는 건 정상(Retry-After 60 대기 후 재시도).
- 테스트 모드 응답은 group_by_map 을 무시한 flat 형태라 `normalize.flat_payload` 경고가 뜨고 `map:"all"` 행만 저장된다. 라이브에서 맵별 키 형태가 오면 그때 per-map 경로가 처음 실전을 탄다 — 첫 라이브 실행 로그를 꼭 봐라.
- 옛 API(`api.heroesprofile.com`, `?api_token=`)는 쓰지 마라. 문서 사이트가 그쪽을 가리켜도 v1 이 정본이다.
