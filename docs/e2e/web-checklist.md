# E2E checklist — web tier-list page

Automated as Playwright specs in `web/e2e/tierlist.spec.ts`, run with `npm run e2e` against a frozen data set (`web/tests/e2e-data`, the 2026-09-28 fixtures) so tier expectations are deterministic. Human items are marked.

## Automated (`npm run e2e`) — 9/9 passed 2026-09-28 (table UI v2)
- [x] Default view: Quick Match, all maps, **no** map dropdown, ban column hidden; Illidan B, Azmodan S, Brightwing A; first row is rank #1 (Qhira)
- [x] Score, win rate and pick rate each show a number **and** a bar — no single-metric emphasis
- [x] Sorting by pick rate reorders rows (Abathur first in QM), toggles asc/desc, lands in the URL; tiers unchanged
- [x] Role filter "치유사" hides other roles, keeps the tier computed on everyone, writes `role=` to the URL
- [x] Storm League: map dropdown appears, Illidan A, Brightwing F, ban rate shown in the expanded card
- [x] One map selected: thin rows are grey (listed, not tiered, absent from the tier sections), meta line shows the Korean map name
- [x] 👍/👎 is one-shot per hero and mode (localStorage), survives reload, fires exactly one goatcounter event `vote/<mode>/<slug>/<up|down>` when the script is present
- [x] `?patch=previous` shows the banner and the previous patch's data; `?mode=sl&map=…&role=…` restores the controls
- [x] No horizontal scroll at 390 px; formula line and "Data provided by Heroes Profile" present

## Automated — pages (`e2e/pages.spec.ts`, 6/6 passed 2026-09-28)
- [x] Home: 6 role-leader cards, movers vs previous patch, 6 map cards, mode toggle in URL, no horizontal scroll, active tab
- [x] Heroes: 90 cards with tier badges, search narrows to 일리단, role filter in URL
- [x] Hero detail: tier/rank card, cross-mode line, SL per-map bars with Korean map names, brackets, one-shot vote; unknown slug shows a message
- [x] Maps: 15 cards with images/matches/top-3; card → tier.html?mode=sl&map=… with the map banner
- [x] Tier table ▲▼ deltas against the previous patch
- [x] Storm League bracket selector loads sl_<bracket>.json, lands in the URL (`tier=`), hidden in Quick Match
- [x] Hero page: 5 popular builds, 7 talents each with Korean names and icons, games and win rate; unknown hero shows a message

## Human, against the live site
- [ ] https://blas1n.github.io/hpgg/hots/ loads today's patch and match count in the meta line
- [ ] Switching to Storm League and picking a map re-tiers within a second on a phone
- [ ] Owner reads the QM S/A tiers and notes any hero that contradicts gut feel (input for the vote sensor, not for hand edits)
