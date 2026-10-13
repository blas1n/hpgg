# 영웅별 주요 스탯 — checklist

Automated: `tests/test_identity_stats.py`, `tests/test_run.py` (identity), `tests/server/test_matches.py` (rows),
`web/tests/identity.test.ts`, `web/e2e/players.spec.ts` (signature stats, Korean and English).

- [x] Picks from real records follow the owner-reviewed rule (8,400 games 2026-10-07..13: 64 of 91 heroes, six candidates)
- [x] A card shows the hero's stats in order, the game's value (crowd control as m:ss) and +/-% against the hero's average
- [x] A hero without picks, a basic row, or a row from before the fields shows nothing (no zeros)
- [x] English labels on /en/
- [x] 390 px and 1280 px, dark theme: chips wrap under the hero line, nothing overflows (screenshots in the PR)
- [ ] After merge: the Mac mini serves rows with `silences` etc. (`curl` a known player's `/v1/players/matches`)
- [ ] After the next nightly run: `data/identity_stats.json` on main, `identity.done` in the log with ~89 heroes
