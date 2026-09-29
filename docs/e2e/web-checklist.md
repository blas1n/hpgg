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

## Automated — languages (`e2e/i18n.spec.ts`, #10; every language under `/<locale>/` from one route tree)
- [x] Every page type renders for every entry of `LOCALES` with its `lang`; `/fr/hots/` is a 404
- [x] Every old URL (`/hots/`, section pages, all 90 heroes, all 15 maps) serves a forwarder with canonical, meta refresh and noindex, and its target exists; with JS it keeps query and hash, `hots/*.html` go straight to the final URL, `/` and old links follow the stored language in one hop; without JS the meta refresh moves on
- [x] Every page type (홈, 티어, 영웅, 영웅 상세, 전장, 전장 상세, 전적 검색): `#lang-toggle` on `/ko/…` links to `/en/…` + the same path; ko → en → ko, `html[lang]` and the heading follow
- [x] English pages: `lang="en"`, canonical = the English URL, `hreflang` ko / en / x-default (= `/ko/…`); Korean pages point back
- [x] No visible Korean on English pages, including browser-built views (SL, map + preset, bracket, region, player result, talent popover, tier row detail); control: the same check finds Korean on 홈
- [x] English player page: Storm League / Diamond 2 / Unranked Draft / ARAM, ARAM map names, hero links under `/en/`; Korean: 일반 선발전, 무작위 영웅 대전, 브락시스 전초기지
- [x] Links stay in the language (nav, hero search incl. Korean query on English pages, map objective with its en-us source)
- [x] The switch keeps query and hash; the stored choice redirects a Korean link to English before DOMContentLoaded and back; no choice = no redirect even with an English browser; blocked storage still switches without errors
- [x] `/en/` forwards to `/en/hots/`; the 404 is bilingual; the switch sits next to the theme toggle at 390 and 1280 px without horizontal scroll
- [x] Contrast sweep (below) runs on the English pages too
- [ ] Human: read the English pages on a phone once (wording, line breaks — long talent names break mid-word under the icons at 390 px)

## Automated — light theme (`e2e/theme.spec.ts`, #1)
- [x] Navy by default, also when the system prefers light; toggle `#theme-toggle` in the header at 390 and 1280 px
- [x] Toggle → `html[data-theme=light]`, remembered across pages and reloads, set before DOMContentLoaded (no flash); toggling back returns to navy
- [x] Storage that throws: page renders navy, toggle still works for the visit, no page error
- [x] Every visible text run on 홈 / 티어 (QM, SL) / 영웅 / 영웅 상세 (QM, SL) / 전장 reaches WCAG AA against the colour behind it, both themes, 390 and 1280 px (a planted low-contrast line is caught — control)

## Automated — one formula, party correction (`e2e/tierlist.spec.ts`, #36; presets removed 2026-09-29)
- [x] No formula selector; the Storm League filters are region, bracket and map only; no person's name on the page
- [x] An old `?preset=` link opens the default view and the parameter leaves the URL (`%20` vs `+` alone never rewrites a link)
- [x] Quick Match ranks by `tier_win_rate` (fixture: The Butcher → F) while its win-rate cell stays raw
- [x] The formula line and "자세히" print the party correction on QM; the uncorrected SL fixture prints none; English too

## Automated — desktop density and design review (`e2e/density.spec.ts`, #3 #16)
- [x] 1280: tier table has its own tier column (no badge on the portrait), rows ≤ 42 px, ≥ 14 heroes above a 900 px fold
- [x] 1280: role column, win rate ± interval, hero column ≤ 360 px wide
- [x] Tier divider rows (6) when ranked by score, none when sorted by another column
- [x] Column header sticks under the site header while scrolling
- [x] A preset-changed row is tinted (no stripe)
- [x] Hero page 1280: header and stats share a band; maps left, brackets and builds right; builds start above the fold; map rows ≤ 44 px
- [x] No text under 11 px on the hero page (tier badges excepted)

## Automated — map detail (`e2e/maps.spec.ts`, #9)
- [x] `/hots/maps/cursed-hollow/`: banner, 3 official objective steps, archive source link, top heroes sorted by win rate (≤ 10, links to hero SL page), link to the map's tier table, 전장 nav active
- [x] A map without Storm League games still shows its objective and says there is no sample
- [x] Every map card opens `/hots/maps/<slug>/`; unknown slug → 404; no horizontal scroll at 390 px
- [x] Contrast sweep covers two map pages in both themes

## Human, against the live site
- [ ] https://blas1n.github.io/hpgg/hots/ loads today's patch and match count in the meta line
- [ ] Switching to Storm League and picking a map re-tiers within a second on a phone
- [ ] Owner reads the QM S/A tiers and notes any hero that contradicts gut feel (input for the vote sensor, not for hand edits)
