# Owner MCP (ChatGPT connector) — checks

Unit tests cover the OAuth flow and the tools against a fake HP and a fake Battle.net
(`tests/server/test_mcp_oauth.py`, `tests/server/test_mcp_tools.py`). These are the checks only
the real HP, the live tunnel and ChatGPT can answer.

## Local, real HP (done 2026-11-11, before the PR)

Server on 127.0.0.1 with the real HP key, `MCP_OWNER_BATTLETAG=blAs1N#3479`,
`MCP_REPLAYS_PER_SYNC=5`, an access token inserted by hand (no ChatGPT, no Battle.net).

- [x] `get_status` → 267 games stored, 2026-10-08 ~ 11-10; HP profile SL 142W 125L = 267
- [x] One refresh = 3 list pages (`player_match_history` +3), 5 replays (`replay_data` +5)
- [x] `list_matches` newest game: Malthael, Dragon Shire, 1,261 s, both teams' heroes and bans,
      draft position (4th of my team, 7th overall), party size 1
- [x] `summarize group_by=hero`: Ana 21 games 13 wins, K 26 D 52 A 289 — the same as the 11-06
      export
- [x] `get_match`: 10 players as player_1…player_9 + me, no `#` anywhere, 16 draft events
- [x] `get_baseline hero=키히라`: high-tier numbers with games kept; KR-only bracket is 142 games,
      so the default became all regions (20,629)
- [x] A call that starts a refresh waited the full wait (20 s then) → default lowered to 10 s

## After deploy (owner)

`deploy/.env` on the Mac mini: `MCP_OWNER_BATTLETAG=blAs1N#3479`, then redeploy.

- [ ] `curl -s https://api.hpgg.win/.well-known/oauth-authorization-server` → issuer
      `https://api.hpgg.win`, `registration_endpoint`, `S256`
- [ ] `curl -s -X POST https://api.hpgg.win/mcp` → 401 with `WWW-Authenticate: Bearer …
      resource_metadata="https://api.hpgg.win/.well-known/oauth-protected-resource/mcp"` (the
      tunnel passes the Host header; a 421 here means `MCP_ALLOWED_HOSTS` needs the host it sees)
- [ ] ChatGPT → Settings → (Apps/Connectors) Advanced → Developer mode on → create a connector,
      URL `https://api.hpgg.win/mcp`, authentication OAuth
- [ ] The connect button opens the HP-GG consent page (Battle.net sign-in first if signed out);
      it names ChatGPT and a chatgpt.com address; 허용 → back in ChatGPT, connected
- [ ] In a chat with the connector on: "내 상태 보여줘" → `get_status` runs and answers
- [ ] "폭풍리그 티어표 보여줘" → `get_tier_list`; top heroes and tiers match hpgg.win's 티어표 (same view)
- [ ] `docker logs hpgg-api`: `mcp.client_registered`, `mcp.consent_given`, `mcp.sync result=ok`;
      no token, code or BattleTag of another player
- [ ] A day later: ChatGPT still connected (refresh token works without signing in again)
