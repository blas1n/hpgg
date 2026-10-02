# Pre-launch fixes (before the first community post, 2026-10-02)

Automated: `tests/test_snapshot.py` (match floor), `tests/test_freshness.py`, `tests/test_run.py` (KST snapshot day),
`web/tests/{date,sitemap,og,i18n}.test.ts`, `web/e2e/launch.spec.ts`.

## Before merge
- [x] pytest, ruff, vitest, tsc, `npm run e2e` green locally
- [x] actionlint on `collect-and-deploy.yml`
- [x] OG cards rendered (`web/scripts/og-card.mjs`) and looked at: `data/img/brand/og-{ko,en}.png`, 1200×630

## After merge (live)
- [ ] https://hpgg.win/robots.txt and /sitemap.xml return 200; sitemap has 224 URLs
- [ ] `og:image` of /ko/hots/ is og-ko.png; a pasted link previews as the card (Discord or KakaoTalk)
- [ ] Meta description reads "계산식 공개, 매일 새벽 갱신"
- [ ] launchd `com.blas1n.hpgg-collect` installed on the Mac mini (`launchctl print gui/$(id -u)/com.blas1n.hpgg-collect`)

## Next night (10-03)
- [ ] `~/Library/Logs/hpgg-collect.log` shows the 03:20 dispatch; the run's gate says `fresh=false` and it collects
- [ ] The 05:20 cron run (whenever GitHub starts it) stops at the gate with `fresh=true`; Heroes/Stats spent 24, not 48
- [ ] Site shows "10/03 갱신" in the morning; `snapshots/2026-10-03/` exists and `snapshots/2026-10-02/` is unchanged
- [ ] `data/latest/sl_high_kr.json` (KR 다마그): `matches` ≥ the largest hero's games, no pick over 100 %
