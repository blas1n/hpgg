# E2E checklist — collector (non-web; run by a human or by Claude)

Preconditions: `HP_API_TOKEN` in `~/Works/hotsmeta/.env`. Test Data mode costs no quota; Live Data items are marked.

## Test Data mode (verified 2026-09-28)
- [x] `uv run python -m collector` exits 0 (5 calls, 60 s apart → about 5 min) — run 2: EXIT=0 in 5 min 06 s; the first call got a 429 and succeeded after the 60 s `Retry-After` wait
- [x] `data/latest/{qm,sl,sl_low,sl_mid,sl_high,meta}.json` exist and `meta.json.current_patch` equals the newest `valid_globals` build from `/v1/patches` — 2.55.17.97771 (test-mode list)
- [x] `data/.snapshot_out/<today>/` holds 5 `raw_*.json.gz` + 5 normalised gz + meta.json — 11 files
- [x] No token string in the JSON log — grep count 0 (httpx request lines are lowered to WARNING so URLs are not echoed)
- [ ] A second run keeps `patch_started_at` from the first run (same patch) — covered by the unit test `test_build_meta_first_run_and_patch_change`; confirm on the first two cron days in Actions
- [x] A bad token (`HP_API_TOKEN=bad uv run python -m collector`) exits 1 and leaves `data/latest/` untouched — `401 unauthenticated`, no files written, token absent from the log
- [x] Test data is five heroes with `wins` only and **`group_by_map` is ignored (flat payload)** → `normalize.flat_payload` warned 5 times, five `map: "all"` rows stored, no crash

## Live Data mode
- [x] Real `group_by_map=true` shape recorded from one probe call (1 of 70/week): `{map: {average_*, data: [rows]}}`, rows = `wins, losses, games_played, win_rate, ban_rate, win_rate_change, popularity, pick_rate, influence, confidence_interval, total_filter_type` (no `bans` count → derived from `ban_rate`). Fixture `tests/fixtures/live_probe_qm_2.55.17.98025.json.gz`, unit test `test_live_probe_fixture_normalizes_per_map`
- [x] A cold query answers 202 and the poll loop finishes with 200 — probe: `hp.job_started` → 2 polls → `hp.job_done` in 24 s
- [x] First full live run (dispatch 36376346599, 2026-09-28): patch 2.55.17.98025, QM 47,789 matches / 16 maps / 1,440 rows, SL 16,980, sl_low 3,362 (63/90 heroes over 200), sl_mid 13,573 (89/90), sl_high 7,308 (85/90); two calls answered 202 and finished after 2 polls each; data committed by the bot and deployed
- [x] `qm.json` `map: "all"` Illidan win_rate 50.79 vs web 50.70 (+0.09, four hours of drift); pick rates identical to two decimals for all five spot-checked heroes; across all 90 heroes max |Δ| 0.63, mean +0.01 → the Σgames/10 derivation matches the site
- [x] `sl_high.json` 7,308 < `sl.json` 16,980. Observation: the three brackets sum to 24,243 > 16,980, so a match is counted in every bracket its players belong to (or overall excludes untiered players) — bracket "matches" is a per-bracket slot normaliser, not a partition. Pick/ban rates within a bracket remain correct; do not add bracket matches together
