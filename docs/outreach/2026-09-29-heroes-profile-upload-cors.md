# Heroes Profile: uploading replays from hpgg.win (email, sent 2026-09-29)

Sent by the owner to **ZEMILL@heroesprofile.com** (the address on https://www.heroesprofile.com/Contact), not as a public GitHub Discussion. The request is a one-to-one ask about one site's access, and it touches abuse limits, so a public board was the wrong venue. Replies come to the owner's mail (contact@hpgg.win only forwards). **Status: answered 2026-09-29 by Zemill (reply below); done in the PR that embeds the widget.**

Background facts (from HP's open-source site and uploader, 2026-09-29):
- Routes: `POST /api/external/v1/upload/heroesprofile/{source}` and `GET /api/external/v1/replays/fingerprints/{fp}`. Both are keyless (`routes/api-external.php`; uploader `Uploader.cs`).
- Limits are per IP: 60 uploads/min and 20,000/day (`config/api.php` `uploader`). `source` is stored with the replay, and leaderboard eligibility depends on it (the web uploader uses `web`).
- CORS allows heroesprofile.com origins only (`config/cors.php`).

---

**Subject:** hpgg.win: uploading replays to Heroes Profile from our player search

Hi Zemill,

I run hpgg.win (https://hpgg.win/en/hots/), a Korean/English HotS stats site built on the Heroes Profile API v1 (Basic plan). Our tier tables come from `/heroes/stats`, and player search goes through our server to `/players`, credited to Heroes Profile on every page.

Our users' most common problem is "my BattleTag isn't found", because none of their games have been uploaded. We now explain this on the page and link to your Upload page and uploader. We'd also like to let people upload right from our player search, so their replays go into Heroes Profile rather than into a separate archive of our own.

I've read the open-source routes: the upload routes are keyless, limited per IP, and CORS-restricted to heroesprofile.com. Before building anything I wanted to ask:

1. Would you be willing to add `https://hpgg.win` to the CORS origins for `upload/heroesprofile/{source}` and `replays/fingerprints/{fp}`? Uploads would go straight from each visitor's browser to you with their own IP, tagged `source=hpgg`.
2. If not, would you rather we did not relay uploads through our server? Everything would reach you from one IP, and we won't do it without your OK.
3. How would a custom source like `hpgg` count for leaderboard eligibility? Either way, we'll point people to the desktop uploader as the best option.

Happy to follow whatever you prefer on attribution, rate limits, or anything else. Thanks for Heroes Profile and the open API.

Best,
blas1n — hpgg.win (contact@hpgg.win)

---

When a reply arrives, record the answer here, then:
- **CORS allowed:** upload straight from the player page with `source=hpgg`. Check for duplicates with the fingerprint route first.
- **Relay OK:** add a server upload route. The single-IP limits apply to all our users together.
- **Neither:** keep the guide (PR #35) and link out.

---

## Reply (Zemill, 2026-09-29) and what we did

- **No CORS — use the embeddable uploader instead.** An iframe of `https://www.heroesprofile.com/Upload/Embed?source=hpgg`
  (docs and snippet: https://www.heroesprofile.com/Upload/Widget). Replays go from the visitor's browser to HP under their
  own IP. The widget posts `heroesprofile:resize` (height), `heroesprofile:upload` (per replay) and
  `heroesprofile:upload-complete` (`uploaded`, `duplicates`, `failed`); check the origin. → `web/src/lib/hpUpload.ts`,
  the uploader sits in the 전적 검색 upload guide under "past games" and says when to search again.
- **Do not call `replays/fingerprints` from our site** (desktop uploader only). **Do not relay uploads through our server**
  (one IP's limits, wrong address recorded). Neither is built.
- **Leaderboards:** web uploads (the embed too) may not count; keep pointing people to the desktop uploader (we do).
- **Attribution (API terms §4):** the footer credit alone was not enough (small grey text, ~4,500 px down the tier list).
  "Data provided by Heroes Profile" with the link must be on the same screen as the data, no smaller than body text, not
  fine print. → `web/src/components/HpCredit.tsx` on every page, at the top in body text; the footer credit stays.

**Framing, fixed by HP (2026-10-01):** the embed was blank at first — HP's Cloudflare check answered the framed
`/Upload/Embed` request with 403, and that challenge page sets `X-Frame-Options: SAMEORIGIN`, so Chrome showed
"www.heroesprofile.com refused to connect". It only shows from another origin, which is why HP's own demo page looked
fine. HP changed it on their side the same day; the uploader now renders on hpgg.win. Our side is the documented
snippet — if it ever goes blank again, it is this, and it is HP's to fix.

Read with the terms (2026-10-01): §5 also requires polling HP's privacy change feed every 24 h and dropping a player who
went private within 24 h. Our player cache does not do this yet — issue #74.
