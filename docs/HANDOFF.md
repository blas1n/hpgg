# HANDOFF (overwritten each time)

Last updated 2026-09-28. Current state is in `docs/STATUS.md`.

- Only the collector exists. `uv run python -m collector` takes about five minutes (group_by_map is limited to one request per minute). The first call often starts with a 429 and `Retry-After: 60`; that is normal and handled.
- In Test Data mode the API ignores `group_by_map` and answers a flat five-hero payload; the collector logs `normalize.flat_payload` and stores only `map: "all"` rows. In Live Data mode the per-map path runs — it has been exercised once against a real payload via the probe fixture and its unit test, but watch the first live run's log.
- Do not use the old API (`api.heroesprofile.com`, `?api_token=`) even though its docs site still ranks first in search; v1 at `www.heroesprofile.com/api/external/v1` with a Bearer key is the only one that works. Details: `docs/hp-api-v1-variables.md`.
- The workflow bot commits to `main`; rebase before pushing and never commit a local `data/latest`.
