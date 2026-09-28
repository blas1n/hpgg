# STATUS — hotsmeta.kr

Start every session here. Handoff notes live in `docs/HANDOFF.md`.

## 2026-09-28
- Design frozen: `docs/DESIGN-2026-09-28.md` (office-hours session, three adversarial review rounds at 8/10, API v1 measurements folded in).
- **Collector v1 shipped** (`05d6e0b` and follow-ups): 33 tests, 92% coverage, ruff and mypy clean. E2E checklist `docs/e2e/collector-checklist.md` — all test-mode items verified; the "second run keeps `patch_started_at`" item is covered by a unit test and will be confirmed by the first two cron days.
- **GitHub**: https://github.com/blas1n/hotsmeta (public). `main` plus the orphan `snapshots` branch, Actions secret `HP_API_TOKEN`, Pages built by Actions. Both workflow paths verified: push → deploy, and dispatch → collect (5 calls) → data commit → snapshots → deploy (run 36374451271). Cron runs daily at 03:20 KST. Site: https://blas1n.github.io/hotsmeta/ (placeholder page + `data/latest`).
- **Live Data mode is on** (switched by the owner). One live probe call confirmed the real `group_by_map=true` shape: `{map: {average_*, data: [rows]}}`; rows carry `wins, losses, games_played, win_rate, ban_rate, win_rate_change, popularity, pick_rate, influence, confidence_interval, total_filter_type` — no `bans` count, so the collector derives it from `ban_rate` and the map's match count. Fixture: `tests/fixtures/live_probe_qm_2.55.17.98025.json.gz`. A cold query answered 202 and finished after two polls (24 s).
- Domains hotsmeta.kr / hotsmeta.gg: **not registered yet** (owner).

## Next
1. First live full run (dispatch or tonight's cron) → check the per-map path in the run log and the resulting `data/latest/*.json` sizes.
2. `web/`: the tier-list page. `formula.ts` gets vitest cases from the design doc's 13-hero verification table first.
3. Custom domain on Pages once the domain exists.
