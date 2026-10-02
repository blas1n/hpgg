# STATUS — HPGG (hpgg.win)

Start every session here. Operating guide and architecture: `docs/HANDOFF.md`. Backlog: GitHub issues.

## State at 2026-10-02 (handoff)
- **Live**: https://hpgg.win/ko/hots/ (Korean, default) and https://hpgg.win/en/hots/ (English); root `/` forwards to the stored language choice, else Korean; old URLs forward to `/ko/…`. Pages (under `/<locale>`): 홈 · 영웅 티어 `/hots/tier/` (QM/SL; **region and bracket combine**, e.g. `?mode=sl&region=kr&tier=low`; per-map; one formula with the party correction everywhere) · 영웅 `/hots/heroes/` · 영웅 상세 `/hots/heroes/<slug>/` (region/bracket filters drive the stat cards and per-map rows; one **지역 × 구간 grid**; 상성 and builds on every region and bracket, labelled so; patch changes incl. unannounced hotfixes) · 전장 / 전장 상세 · 전적 검색 `/hots/players/` (profile, up to 100 games with stat lines, a game in full, **영웅별 통계** with a mode switch). "Data provided by Heroes Profile" on every page's title line. **밴픽 `/hots/draft/` is switched off** (owner 10-02, `web/src/features.ts`: ignores team roles; back once it does not).
- **Heroes Profile plan: Intermediate** ($10, owner 2026-10-02). Weekly caps measured from `X-HP-Quota-Limit`: Heroes/Stats 210, builds/all 21, matchups 2,100, players 25,000, match history 500, MMR history 25,000, replay 25,000, player per-hero 500. Per-plan table and what Basic forced: HANDOFF "Plans compared".
- **Patch model**: a patch is a regular patch x.y.z with all its hotfix builds (HP is asked for every build comma-joined; HP `major` is x.y — never use it). Now: **current and reference 2.57.0** (98285 + 98304), **previous all of 2.55.17** (backfilled 10-02, PR #101).
- **Collection** (daily **03:20 KST, dispatched from the Mac mini** — launchd `com.blas1n.hpgg-collect`, `tools/collect/`; GitHub's cron started ~4 h late every night, so it is now only the 05:20 KST fallback, and a gate job skips whichever run finds data under 12 h old; dates on the site and snapshot folders are the KST day): KR / NA / EU × (QM, SL, 브실골플, 다마그) with a solo twin each = **24 Heroes/Stats calls** (~25 min at 1/min); the whole of each view is the **sum of its regions** (verified row for row on 98025); party correction on every row of every view; 1 builds call; SL matchups every other day. **Any failed call → no update** (yesterday's files stay; owner: no uncorrected or partial numbers). The collect job pushes with deploy key `DATA_DEPLOY_KEY` (main's ruleset takes no direct push; deploy keys are its one bypass) and uploads the data as the run artifact `collected-data` (14 days) before the push. `--only qm,sl` = recovery run (12 calls), `--previous <x.y.z>` = backfill (24).
- **Hero assets**: HeroesToolChest **heroes-data2** releases (HDP v5, `tools/build_assets.py --build 2.57.0.98304`; heroes-data v4 is archived). 91 heroes incl. Xal'atath.
- **API server** (`server/`, https://api.hpgg.win, container `hpgg-api` on the Mac mini, autodeploy on push to main): `/v1/players`, `/matches`, `/replays/{id}`, **`/heroes?mode=all|qm|sl`** (#99); daily budgets for Intermediate (#100): players 3,500, full match lists 70, MMR history 3,500, replays 3,500, per-hero 68 (asked only when the section scrolls into view). Privacy feed hourly (#74). `curl -s http://127.0.0.1:8800/healthz` on the Mac mini shows every bucket (the public one says only `{"ok":true}` since 10-02).
- **Hotfix watcher** (Mac mini, launchd `com.blas1n.hpgg-hotfix`, clone `~/Works/hpgg/bot`): pushes to main with its own deploy key (`~/.ssh/hpgg_hotfix_deploy`, `core.sshCommand`) since 10-02. Log `~/Library/Logs/hpgg-hotfix.log`.
- **Quality**: pytest 355 (collector + server), vitest 273, Playwright 153; every PR runs `.github/workflows/ci.yml`.
- **Quota this week** (window resets ≈ 2026-10-05 04:00 UTC / 13:00 KST): Heroes/Stats **90 left** on 10-02 13:40 KST; the three nightly runs before the reset take 72 → ~18 spare. From next week: 168/210 a week at steady state (42 spare ≈ one full rerun).

## Done 2026-10-01 evening → 10-02
- **Patch = x.y.z with hotfixes** (#84): the site had stayed on 2.55.17.98025 because one-day hotfix 98304 restarted the sample; other HP-based sites showed "2.57.0". Also #84: **no update without the party correction** (a failed solo call fails the run).
- **Xal'atath** (#85): heroes-data was archived, heroes-data2 has 2.57; `from_v5` adapter. First draft "carried" ability ids the new data seemed to lack — they were under v5 `heroUnits` (vikings, Medivh's raven…); fixed, nothing carried.
- **10-02 run lost** (#93 issue): main got a ruleset (PR required) on 10-01 15:30 KST and the bot's push was refused; the data went with the runner. Owner added deploy-key bypass; #94 pushes with it, keeps `collected-data` before the push, logs HP job URLs; recovery `--only qm,sl` (#95).
- **Plan → Intermediate** (owner), plans compared in HANDOFF (#96).
- **Region × bracket cube** (#97 collector, #98 web): owner wanted "KR 저티어 구간만 보기" on the tier table and the hero page, and the party correction everywhere. Regions are summed into the whole (24 calls a day instead of 32).
- **영웅별 통계** on 전적 검색 (#99; players met often left out by the owner); player budgets for Intermediate (#100).
- Full collection by hand on 10-02 (first deploy-key push, green), previous patch re-collected as all of 2.55.17 (#101).
- Hero page `#section` links land on their section after hydration (#102): a CI-only flake of the anchor test, not reproduced locally — defensive change + 15 s poll, stated as such in the PR.

## First thing to check next session
1. `gh run list --workflow collect-and-deploy -L 3`: the nightly run is green, its commit `data: <date> 2.57.0` is on main (pushed by the deploy key), and the run has a `collected-data` artifact. If it failed, the data is in that artifact — commit it through a PR rather than re-collecting.
2. `meta.json`: 16 views in `modes` and `previous_modes`; `reference_patch` 2.57.0. KR is thin (SL 82 matches, 다마그 0 on 10-02): KR × bracket views are mostly grey for now — expected, not a bug.
3. Hotfix watcher: after the next new build, its push must go through (deploy key). Until then `tail ~/Library/Logs/hpgg-hotfix.log` shows `outcome=unchanged` every 30 min.
4. `curl -s http://127.0.0.1:8800/healthz` on the Mac mini (the public URL says only ok): `privacy.last_ok_at` within the hour; `player_hero_all` live calls per day well under 68.
5. Do not spend Heroes/Stats calls by hand before 10-05 (18 spare).
6. Tier floor 50 is a first setting (owner: "계속 조율하자"): look at grey heroes per view now that every region × bracket exists.
7. Close issue **#93** (collector failed 2026-10-01 — cause and fix above) if still open.

## Open threads
- **Heroes Profile upload**: answered, built and acknowledged (#75 · #77, reply sent 10-01) — HP's widget only; see `docs/outreach/2026-09-29-heroes-profile-upload-cors.md` for what HP asked us not to do and what is still unverified (no real replay has gone through the embed yet).
- **Now affordable on Intermediate**: 팀운 #90 (replay 25,000/week ≈ 3,500 a day; owner said "when the plan goes up"); #88's remaining item, the MMR line per mode. Ask the owner before starting.
- **Issues**: #37 hero summary sentences (review only; template sentences from numbers, playstyle via HP `Replay/Data` sampling; two of its three sentences need the matchups data) · #28 accounts with Battle.net login (needs the owner's Battle.net developer client ID/secret; no feature uses accounts until #7) · #7 community (on hold until traffic).
- **Decided against** (owner, 2026-09-29): replay viewer, tier-list maker (hots-scrap has them), herossearch's meta map / map meta heroes (the tier table covers it), time-of-day analysis. Tier C/D colours equal to brand accent/primary: fine as is.
- **References**: hots.herossearch.com (own replay uploads, ~158k; party-corrected WR, ban/pick recommendation, prose hero cards) · sin0nis.github.io/hots-scrap (extracts game data itself — has 2.57 talents — but its repo has no licence, so don't copy its data; HeroesToolChest's HeroesDataParser (MIT) on a game install would do the same).

## Owner actions
1. First community post (Inven / Arca) — the site is on 2.57.0 with Xal'atath since 10-02.
3. ~~HP upload-access question~~: answered 2026-09-29, built and confirmed live (#75 · #77); thank-you reply sent 10-01.
2. **Upload one of your own replays through the widget** on https://hpgg.win/ko/hots/players/ — it is the only part of the integration never run end to end (we have seen the widget render; the completion notice was tested against stubbed messages).

## Operating notes learned 2026-09-29/30
- **Ephemeral ports on the Mac mini**: on 10-01 ~47,000 TIME_WAIT sockets (mostly to `127.0.0.1:8700` and `:5461`) stopped draining, so new connections failed — first the local e2e server (every Playwright test timed out at 30 s, which reads like a code regression and is not), then `git push` and `gh`. `netstat -an -p tcp | grep -c TIME_WAIT`: over ~16k means the pool (49152–65535) is oversubscribed. `sysctl net.inet.tcp.msl=1000` did **not** drain sockets already stuck; the reboot did (47,000 → 20). While it lasts, CI is the only e2e gate and live checks go through the Playwright MCP browser, which keeps its connections.
- Ruleset/deploy-key/secret changes are refused by the permission classifier — ask the owner to make them (10-02 they did in minutes from exact commands).
- Merges: the owner's rule is "CI all green → merge". On 09-29 the classifier refused merges started on a background notification or delegated to a subagent; later the same day and on 09-30, merges run right after a green `gh run watch` in the same command went through. If one is refused, ask the owner ("머지해").
- A collection can be re-run with `gh workflow run collect-and-deploy.yml --ref main` (it collects, commits the data and deploys).
- GitHub's API limit (5,000/h) was hit once on 09-30 while polling; check `gh api rate_limit` before long polling loops.
- Stacked PRs: merge the bottom one, `gh pr edit <n> --base main` on the next, recheck mergeable, merge.
- The Playwright MCP browser is shared by the session and its subagents — verify with a headless script inside `web/` while agents run. heroesprofile.com blocks headless (Cloudflare); the MCP browser gets through.
- `npx playwright test` alone serves a stale `web/dist-e2e`; `npm run e2e` rebuilds it.

## Owner rules learned 2026-09-29 → 10-02
- **No partial or uncorrected numbers**: if a party-correction call or any region of the cube fails, nothing is updated (yesterday's files stay).
- **Filters combine**: region and bracket together everywhere; the party correction is part of the formula, so every view has it.
- **Changes go through PRs** (ruleset `main`); only the deploy keys (collector, hotfix watcher) push directly. Merge on green CI.
- **A patch is a regular patch (x.y.z) with its hotfixes** (owner 2026-10-01, replacing "a patch is one build"): every HP call asks for all the patch's builds, comma-joined (HANDOFF "One reference patch"). HP `major` is x.y, not x.y.z — do not use it.
- **Copy is short and factual**: "새 패치 X의 표본을 쌓는 중입니다" — no day counts, no explanations the meta line already gives.
- **The tier table leads to the hero page**: a row click goes there; no expanding row repeating the table's numbers.
- **One reference patch for the whole site** (`meta.reference_patch`, decided once by the collector; HANDOFF "One reference patch"). Pages, builds, matchups and 밴픽 all use it; a view without data on it says so.
- **No person's name on the formula** — not on the page, in code, tests, docs or file names; the formula is shown as maths (presets removed). A guard for an absence checks structure, not the name.
- **Names and labels come from the game's or Blizzard's own data**, like hero names — never made up. Where heroes-data has no UI string, Blizzard's official pages on the Internet Archive (`locStrings`) are the source (universes, #43).

## History
- 2026-10-01 evening → 10-02: patch = x.y.z (#84), Xal'atath via heroes-data2 (#85), push refused → deploy keys + artifact (#94, recovery #95), Intermediate plan (#96), region × bracket cube (#97 #98), 영웅별 통계 (#99), Intermediate budgets (#100), previous = all of 2.55.17 (#101), anchor landing (#102).
- 2026-10-01 (afternoon): 전적 검색 upgrade (owner: lol.ps comparison) — up to 100 games with HP's stat line (#82 #83; HP `/players` carries only the newest 5), award badges and a game opened in full (#86 #87); 팀운 recorded in #90, later candidates in #88.
- 2026-09-30 night / 10-01: region menu on the reference patch (#72), tier floor 50 (#73), HP upload widget + on-screen attribution after HP's reply (#75), credit moved onto the page title's line (#77); privacy-feed gap found (#74). Thank-you reply to HP sent 10-01.
- 2026-09-28: design (office-hours) → collector → repo/Actions/Pages → live data → five pages → table UI → official names + images → 폭풍 리그 naming, brackets, talent builds → lol.ps skin → handoff.
- 2026-09-29 (morning): Next.js rebuild (#11) — design system, shell with hero search, new 홈; owner phone review: copy without "체감과 맞는", no voting, brackets 브실골플 / 다마그, hero-detail cleanup, talent popover; Next 16. Full detail in `git log` and `docs/DESIGN-2026-09-28.md` ("UI rebuild and copy decisions").
- 2026-09-30 (morning): 03:20 run failed on a new hotfix build (#54) → #55 (patch = build, healthy-build promotion, one-hour settle), re-run green; 90 matchups live, 밴픽 shows all terms; notice copy "표본을 쌓는 중" (#57).
- 2026-09-29 (night): one reference patch for the whole site (#52), builds on it and sorted by games (#53), tier rows go to the hero page (#51).
- 2026-09-29 (evening): party-corrected win rate in the tier formula (#36, `groupsize=Solo`, shrunk k=1000, 28/90 tiers move) and previous-patch re-backfill; formula presets and the formula's name removed; universe filter on 영웅 from the official heroes page (#43); rows open through a real button, 80-character formula line, 홈 tagline (#30); 밴픽 simulator with the real Storm League order and suggestions (#25).
- 2026-09-29 (day): every open issue worked — #6 hide heroes without assets, #8 API server + player search, #15 matchups, #14 regions, #1 light theme, #2 presets, #3/#16 design review, #9 map pages, #10 i18n with `/ko` `/en` routes; portrait backdrop + language-switch bounce fix (#34); replay-upload guide (#35); follow-ups (#38). Reference-site review → #36, #37.
