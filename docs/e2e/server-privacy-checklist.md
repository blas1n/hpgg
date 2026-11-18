# E2E checklist — player privacy (HP API terms §5, #74; non-web part run by a human or by Claude)

Web part: `web/e2e/players.spec.ts` "a private profile says so" (Playwright). Unit: `tests/server/test_privacy.py`.

## Local, live HP (2026-10-01, before merge)
- [x] `python -m server` on a fresh DB applies 0001 → 0002 and polls the feed at startup — `privacy.polled changes=662 purged=0` 1.4 s after start (first sync, one page)
- [x] `/healthz` shows `privacy.last_ok_at`, `since` (2026-10-01T02:16:21+00:00) and the feed bucket's `remaining` (10,078 of 10,080)
- [x] 642 players stored private (EU 344, NA 210, KR 87, CN 1); `hp_feed_cursor` holds since + after_id 3413
- [x] A player the feed lists (Player13#1013, EU) → `403 player_private` in any letter case, and HP `/players` is not called (`quota.players` still unmeasured)
- [x] HP answers a private player with `403 player_unavailable` (recorded fixture `v1_players_403_private.json`)
- [x] No battletag is written to the log by the poller

## After deploy (api.hpgg.win)
- [x] `docker --context colima logs hpgg-api | grep privacy.polled` — one line at start (2026-10-01 06:23 UTC, `changes=662`, migration 0001 → 0002 applied); [ ] then one an hour
- [x] `curl -s https://api.hpgg.win/healthz` → `privacy.last_ok_at` within the last hour — 06:23:18Z, feed `remaining` 10,077
- [x] `curl -s "https://api.hpgg.win/v1/players?battletag=Player13%231013&region=EU"` → 403 `player_private`
- [x] https://hpgg.win/ko/hots/players/?tag=Player13%231013&region=EU shows "비공개 프로필입니다" (`data-state=private`, deploy of 919e70f)
- [x] The cached rows older than 24 h are gone: `purged=5` on the first poll after deploy
