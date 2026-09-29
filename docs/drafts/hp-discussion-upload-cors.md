**Category:** Ideas
**Title:** Uploading replays from a third-party site (hpgg.win) — CORS for the keyless upload routes?

Hi! I run **hpgg.win** (https://hpgg.win/en/hots/), a Korean/English Heroes of the Storm stats site built on the Heroes Profile API v1 (Basic plan). Tier tables come from `/heroes/stats`, and player search goes through our small server to `/players`, credited to Heroes Profile on every page.

The most common problem our users hit is "my BattleTag isn't found", because none of their games have been uploaded. We now explain this and send them to https://www.heroesprofile.com/Upload. We'd also like to make uploading possible from our player-search page, so the replays go into Heroes Profile rather than into a separate archive of our own.

From the source, the upload routes are keyless (`POST /api/external/v1/upload/heroesprofile/{source}`, `GET /replays/fingerprints/{fp}`), rate-limited per IP, and CORS-restricted to heroesprofile.com origins. Some questions before we build anything:

1. **CORS.** Would you consider adding `https://hpgg.win` to the allowed origins for the upload and fingerprint routes? Uploads would go straight from the visitor's browser to you, with their own IP, and we'd use `source=hpgg` so they are easy to tell apart.
2. **If not, relaying.** Would you prefer that we don't relay uploads through our server? All of them would reach you from one IP (the 60/min and 20,000/day limits would apply to all our users together), and the files would pass through our server. We'd rather not do this without your OK.
3. **Leaderboards.** How would a custom `source` like `hpgg` be treated for leaderboard eligibility, compared with `web` and the desktop uploader? We'd tell users that the desktop uploader is the best option.
4. Is there anything else you'd like third-party sites to do, or not do, around uploads, such as attribution, a link to the uploader, or rate limits?

Thanks for Heroes Profile and the open API. We'd much rather add to the shared replay pool than split it.

— blas1n (hpgg.win) · contact@hpgg.win
