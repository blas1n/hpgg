# STATUS — HPGG (hpgg.win)

Start every session here. Operating guide and architecture: `docs/HANDOFF.md`. Backlog: GitHub issues.

## State at end of 2026-09-29 (all issues from the morning closed)
- **Live**: https://hpgg.win/ko/hots/ (Korean, default) and https://hpgg.win/en/hots/ (English); root `/` forwards to the stored language choice, else Korean. Every URL from before (`/hots/…`, every hero and map, old `hots/*.html`) forwards to `/ko/…` (115 generated forwarders). Pages (under `/<locale>`): 홈 `/hots/` · 영웅 티어 `/hots/tier/` (QM/SL, brackets, per-map, region, formula presets `?preset=`) · 영웅 `/hots/heroes/` · 영웅 상세 `/hots/heroes/<slug>/` (stat cards, per-map, brackets, 지역별, 상성 counters/synergies, talent builds) · 전장 `/hots/maps/` · 전장 상세 `/hots/maps/<slug>/` (15; official objective text with source, top heroes) · 전적 검색 `/hots/players/` (live through api.hpgg.win; replay-upload guide, PR #35). Light theme toggle (navy default).
- **Stack**: Next.js 16 static export + React 19 + Tailwind 4 on GitHub Pages; one route tree `app/[locale]` (languages = `LOCALES` in `web/src/i18n/locales.ts` — adding a language = one entry + a message table, no route files). Pages read data through `readShown`; heroes without assets are hidden by one rule (`web/src/lib/known.ts`, #6).
- **Pipeline**: daily cron 03:20 KST — 4 stats calls (QM, SL, SL 1-4, SL 5-6) + 2 region calls (QM + SL, one region a day KR → NA → EU, #14) + 1 builds call; then SL matchups for heroes whose `data/matchups/<slug>.json` is missing / other patch / ≥ 2 days old (#15). A 429 `quota_exceeded` is never slept on (its Retry-After is the weekly reset).
- **API server** (`server/`, https://api.hpgg.win, HANDOFF "Server"): FastAPI + SQLite/Alembic, container `hpgg-api` on the Mac mini (`127.0.0.1:8800`, volume `hpgg-api-data`). Deploy dir `~/Works/hpgg-api/{.bare,main}`, registered in `~/Works/_infra/scripts/autodeploy.sh` (rebuilds on every push to main, a few seconds from cache); secrets `~/Works/hpgg-api/main/deploy/.env` (`HP_API_TOKEN`); tunnel ingress in `~/.cloudflared/config.yml` (tunnel a71ccd4d, shared with vault-cf; backup `config.yml.bak-20260929`); DNS `api` CNAME in the hpgg.win zone (owner). Player search uses only HP `/players` (10,000/week): cached 6 h, not-found 10 min, daily budget 1,300, floor 200, 20 req/min per IP. Logs: `docker --context colima logs -f hpgg-api`.
- **Data/localisation**: Korean + English names and talent text from HeroesToolChest game strings (2.55.16.97039); every talent icon fetched (PR #38); map objectives from the official battleground pages (Internet Archive, cited); ARAM maps incl. 공업 지구 (Blizzard KR brawl news, PR #38). GoatCounter paths are now `/ko/hots/…`.
- **Quality**: pytest 90 collector + 59 server, vitest 197, Playwright 104 (incl. contrast sweep both themes/languages, pre-hydration layout, forwarders); every PR runs `.github/workflows/ci.yml`.
- **Quota (Basic, rolling week)**: Heroes/Stats 42/70 at steady state; builds/all 7/7; Hero/Matchups 315/700; Player 10,000 (server). Plan stays Basic (owner, 2026-09-29). Full per-endpoint table: https://www.heroesprofile.com/Api/EndpointLimits (Cloudflare blocks curl; open it in a browser).

## First thing to check next session (2026-09-30)
1. `gh run list --event schedule -L 3` — a scheduled run exists after 03:20 KST (GitHub may start it hours late; on 2026-09-29 one started at 08:16 and was cancelled only because a push deploy was queued behind it — `cancel-in-progress: false` still drops an older *pending* run). Empty = schedule dead → dispatch once and investigate.
2. That run: `ls data/matchups | wc -l` = 90 (first matchups round), `data/latest/qm_kr.json` / `sl_kr.json` exist (first region day = KR), log has `matchups.done` and `hp.quota` remaining.
3. After three runs: `heroes_over_200` per region in `data/latest/meta.json` — Asia QM may be too thin for tiers.
4. When most heroes pass 200 games on 2.57, the previous-patch fallback ends by itself; Xal'atath stays hidden until HeroesToolChest heroes-data ships a 2.57 build → `uv run python tools/build_assets.py --build <that build>` and commit (see #6 comment).

## Open threads
- **Heroes Profile Discussions post** (owner to post, or tell the session to): draft in `docs/drafts/hp-discussion-upload-cors.md` — asks HP to allow `https://hpgg.win` in CORS for the keyless upload routes (`POST /v1/upload/heroesprofile/{source}`, `GET /v1/replays/fingerprints/{fp}`; per-IP 60/min, 20,000/day; `source` decides leaderboard eligibility). Facts from HP's open-source site (`routes/api-external.php`, `config/cors.php`, `config/api.php`) and uploader (`Uploader.cs`). Relaying through our server is technically possible but not without HP's OK. Post at https://github.com/Heroes-Profile/heroesprofile/discussions (category Ideas).
- **Issues**: #36 party-corrected win rate inside the tier formula (probe `Global/Party` first; printed formula must say so — the footer promises the formula is shown) · #37 hero summary sentences (review only; template sentences from numbers, playstyle via HP `Replay/Data` sampling) · #25 ban/pick simulator + recommendation · #28 accounts with Battle.net login · #7 community (on hold until traffic).
- **Decided against** (owner, 2026-09-29): replay viewer, tier-list maker (hots-scrap has them), herossearch's meta map / map meta heroes (the tier table covers it), time-of-day analysis. Tier C/D colours equal to brand accent/primary: fine as is.
- **Still open from the #30 design review**: footer/formula line length, `role="button"` rows, 홈 sub-line.
- **References**: hots.herossearch.com (own replay uploads, ~158k; party-corrected WR, ban/pick recommendation, prose hero cards) · sin0nis.github.io/hots-scrap (extracts game data itself — has 2.57 talents — but its repo has no licence, so don't copy its data; HeroesToolChest's HeroesDataParser (MIT) on a game install would do the same).

## Owner actions
1. First community post (Inven / Arca) — URLs are now `/ko/hots/…`.
2. Upload your own replays to Heroes Profile (Player11#1011 has no games there yet): https://www.heroesprofile.com/Upload → "Select a folder" → `~/Library/Application Support/Blizzard/Heroes of the Storm/Accounts` (macOS) or `Documents\Heroes of the Storm\Accounts` (Windows).
3. HP Discussions post (above).

## Operating notes learned 2026-09-29
- Merges: the owner's rule is "CI all green → merge", but the auto-mode classifier refuses a merge the session starts on its own (e.g. after a background notification) or delegates to a subagent — ask the owner per PR ("머지해"), then merge and watch the deploy.
- Stacked PRs: merge the bottom one, `gh pr edit <n> --base main` on the next, recheck mergeable, merge.
- The Playwright MCP browser is shared by the session and its subagents — verify with a headless script inside `web/` while agents run. heroesprofile.com blocks headless (Cloudflare); the MCP browser gets through.
- `npx playwright test` alone serves a stale `web/dist-e2e`; `npm run e2e` rebuilds it.

## History
- 2026-09-28: design (office-hours) → collector → repo/Actions/Pages → live data → five pages → table UI → official names + images → 폭풍 리그 naming, brackets, talent builds → lol.ps skin → handoff.
- 2026-09-29 (morning): Next.js rebuild (#11) — design system, shell with hero search, new 홈; owner phone review: copy without "체감과 맞는", no voting, brackets 브실골플 / 다마그, hero-detail cleanup, talent popover; Next 16. Full detail in `git log` and `docs/DESIGN-2026-09-28.md` ("UI rebuild and copy decisions").
- 2026-09-29 (day): every open issue worked — #6 hide heroes without assets, #8 API server + player search, #15 matchups, #14 regions, #1 light theme, #2 presets, #3/#16 design review, #9 map pages, #10 i18n with `/ko` `/en` routes; portrait backdrop + language-switch bounce fix (#34); replay-upload guide (#35); follow-ups (#38). Reference-site review → #36, #37.
