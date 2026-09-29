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

## Automated — light theme (`e2e/theme.spec.ts`, #1)
- [x] Navy by default, also when the system prefers light; toggle `#theme-toggle` in the header at 390 and 1280 px
- [x] Toggle → `html[data-theme=light]`, remembered across pages and reloads, set before DOMContentLoaded (no flash); toggling back returns to navy
- [x] Storage that throws: page renders navy, toggle still works for the visit, no page error
- [x] Every visible text run on 홈 / 티어 (QM, SL) / 영웅 / 영웅 상세 (QM, SL) / 전장 reaches WCAG AA against the colour behind it, both themes, 390 and 1280 px (a planted low-contrast line is caught — control)

## Automated — formula presets (`e2e/presets.spec.ts`, #2)
- [x] Default: `#preset` = 아이치, 아이치 formula printed, nothing marked
- [x] 가산식: rows re-tier (Whitemane S→A in QM), 31 moved heroes carry `data-changed` + "기본 X" chip, count in `#preset-diff`, printed formula and "자세히" follow, `preset=additive` in the URL; "기본 공식으로" clears it
- [x] `?mode=sl&preset=additive` opens with it (Brightwing F→A); `?preset=winrate` prints "티어 점수 = 승률" and unsigned scores; unknown value → 아이치
- [x] No horizontal scroll at 390 px with the selector

## Automated — desktop density and design review (`e2e/density.spec.ts`, #3 #16)
- [x] 1280: tier table has its own tier column (no badge on the portrait), rows ≤ 42 px, ≥ 14 heroes above a 900 px fold
- [x] 1280: role column, win rate ± interval, hero column ≤ 360 px wide
- [x] Tier divider rows (6) when ranked by score, none when sorted by another column
- [x] Column header sticks under the site header while scrolling
- [x] A preset-changed row is tinted (no stripe)
- [x] Hero page 1280: header and stats share a band; maps left, brackets and builds right; builds start above the fold; map rows ≤ 44 px
- [x] No text under 11 px on the hero page (tier badges excepted)

## Human, against the live site
- [ ] https://blas1n.github.io/hpgg/hots/ loads today's patch and match count in the meta line
- [ ] Switching to Storm League and picking a map re-tiers within a second on a phone
- [ ] Owner reads the QM S/A tiers and notes any hero that contradicts gut feel (input for the vote sensor, not for hand edits)
