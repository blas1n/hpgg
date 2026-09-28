# E2E checklist — web tier-list page

Automated as Playwright specs in `web/e2e/tierlist.spec.ts`, run with `npm run e2e` against a frozen data set (`web/tests/e2e-data`, the 2026-09-28 fixtures) so tier expectations are deterministic. Human items are marked.

## Automated (`npm run e2e`) — 7/7 passed 2026-09-28
- [x] Default view: Quick Match, all maps, **no** map dropdown; Illidan B, Azmodan S, Brightwing A; no ban row
- [x] Role filter "치유사" hides other roles, keeps the tier computed on everyone, writes `role=` to the URL
- [x] Storm League: map dropdown appears, Illidan A, Brightwing F, ban rate shown in the expanded card
- [x] One map selected: thin rows are grey (listed, not tiered, absent from the tier sections), meta line shows the Korean map name
- [x] 👍/👎 is one-shot per hero and mode (localStorage), survives reload, fires exactly one goatcounter event `vote/<mode>/<slug>/<up|down>` when the script is present
- [x] `?patch=previous` shows the banner and the previous patch's data; `?mode=sl&map=…&role=…` restores the controls
- [x] No horizontal scroll at 390 px; formula line and "Data provided by Heroes Profile" present

## Human, against the live site
- [ ] https://blas1n.github.io/hotsmeta/ loads today's patch and match count in the meta line
- [ ] Switching to Storm League and picking a map re-tiers within a second on a phone
- [ ] Owner reads the QM S/A tiers and notes any hero that contradicts gut feel (input for the vote sensor, not for hand edits)
