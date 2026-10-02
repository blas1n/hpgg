# Pre-launch fixes (before the first community post, 2026-10-02)

Automated: `tests/test_snapshot.py` (match floor), `tests/test_freshness.py`, `tests/test_run.py` (KST snapshot day),
`web/tests/{date,sitemap,og,i18n}.test.ts`, `web/e2e/launch.spec.ts`.

## Before merge
- [x] pytest, ruff, vitest, tsc, `npm run e2e` green locally
- [x] actionlint on `collect-and-deploy.yml`
- [x] OG cards rendered (`web/scripts/og-card.mjs`) and looked at: `data/img/brand/og-{ko,en}.png`, 1200×630

## After merge (live)
- [x] https://hpgg.win/robots.txt and /sitemap.xml return 200; sitemap has 224 URLs (10-02; 222 since 밴픽 is switched off, #108)
- [x] `og:image` of /ko/hots/ is og-ko.png (10-02, /en/ og-en.png)
- [ ] a pasted link previews as the card (Discord or KakaoTalk) — owner
- [x] Meta description reads "계산식 공개, 매일 새벽 갱신" (10-02)
- [x] launchd `com.blas1n.hpgg-collect` installed on the Mac mini (`launchctl print gui/$(id -u)/com.blas1n.hpgg-collect`) (10-02)

## Next night (10-03)
- [x] `~/Library/Logs/hpgg-collect.log` shows the 03:20 dispatch; the run's gate says `fresh=false` and it collects — dispatched 03:20:04 KST; gate → collect (26 min) → publish → build → deploy all green by 03:47
- [ ] The 05:20 cron run (whenever GitHub starts it) stops at the gate with `fresh=true`; Heroes/Stats spent 24, not 48
- [x] Site shows "10/03 갱신" in the morning; `snapshots/2026-10-03/` exists and `snapshots/2026-10-02/` is unchanged — data commit `data: 2026-10-03 2.57.0` by the publish job (first run since #111)
- [x] `data/latest/sl_high_kr.json` (KR 다마그): `matches` ≥ the largest hero's games, no pick over 100 % — 1 match, top pick 100 %; the page says "1 매치"
