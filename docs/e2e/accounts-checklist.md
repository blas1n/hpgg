# Accounts (Battle.net sign-in, #28) — checks after deploy

Unit tests cover the flow against a fake Battle.net (`tests/server/test_accounts.py`). These are
the checks only the real Battle.net and the live tunnel can answer.

- [x] `curl -sI 'https://api.hpgg.win/v1/auth/battlenet/login?next=/ko/hots/draft/'` → 302 to
      `https://oauth.battle.net/authorize?...client_id=eae3c94e...&redirect_uri=https%3A%2F%2Fapi.hpgg.win%2Fv1%2Fauth%2Fbattlenet%2Fcallback...`,
      `Set-Cookie: hpgg_oauth_state=…; HttpOnly; Path=/v1/auth; SameSite=lax; Secure`
- [x] Following that authorize URL shows Battle.net's sign-in page, not an
      `invalid_request` / `redirect_uri mismatch` error (client id and redirect URL registered)
- [x] Owner signs in once in a browser → lands on `https://hpgg.win/ko/hots/draft/` (no `?login=`)
- [x] In that browser's console on hpgg.win:
      `fetch("https://api.hpgg.win/v1/me", {credentials: "include"}).then(r => r.json())`
      → `{battletag: "blAs1N#3479", region: null}` — confirms the userinfo field names (`id`/`sub`,
      `battletag`) and that the cookie rides cross-origin
- [x] Server log: `accounts.login account_id=1`; no token, code or secret in `docker logs hpgg-api`
- [ ] Cancel on Battle.net's page → back on the site with `?login=cancelled`
- [ ] `DELETE /v1/me` from the console (credentials) → 204, `/v1/me` → 401

Checked 2026-10-30 after #194 deployed: authorize URL lands on kr.account.battle.net/login; the owner signed in and `/v1/me` answered `{"battletag":"blAs1N#3479","region":null}` (userinfo field names as expected; Battle.net sends no HotS region, so the site asks); log has `accounts.login account_id=1` and no token/code/secret. Cancel and DELETE are left for the site UI (stage B e2e covers them against a mock).
