# Accounts (Battle.net sign-in, #28) — checks after deploy

Unit tests cover the flow against a fake Battle.net (`tests/server/test_accounts.py`). These are
the checks only the real Battle.net and the live tunnel can answer.

- [ ] `curl -sI 'https://api.hpgg.win/v1/auth/battlenet/login?next=/ko/hots/draft/'` → 302 to
      `https://oauth.battle.net/authorize?...client_id=eae3c94e...&redirect_uri=https%3A%2F%2Fapi.hpgg.win%2Fv1%2Fauth%2Fbattlenet%2Fcallback...`,
      `Set-Cookie: hpgg_oauth_state=…; HttpOnly; Path=/v1/auth; SameSite=lax; Secure`
- [ ] Following that authorize URL shows Battle.net's sign-in page, not an
      `invalid_request` / `redirect_uri mismatch` error (client id and redirect URL registered)
- [ ] Owner signs in once in a browser → lands on `https://hpgg.win/ko/hots/draft/` (no `?login=`)
- [ ] In that browser's console on hpgg.win:
      `fetch("https://api.hpgg.win/v1/me", {credentials: "include"}).then(r => r.json())`
      → `{battletag: "blAs1N#3479", region: null}` — confirms the userinfo field names (`id`/`sub`,
      `battletag`) and that the cookie rides cross-origin
- [ ] Server log: `accounts.login account_id=1`; no token, code or secret in `docker logs hpgg-api`
- [ ] Cancel on Battle.net's page → back on the site with `?login=cancelled`
- [ ] `DELETE /v1/me` from the console (credentials) → 204, `/v1/me` → 401
