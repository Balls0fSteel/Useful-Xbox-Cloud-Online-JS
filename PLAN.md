# PLAN

Last updated: 2026-10-21_204856_1792608536

## Current state

- v0.3: Game Pass tiers (Essential / Premium / Ultimate) in data and Finder; Game Pass-only default view.
- License: PolyForm Noncommercial 1.0.0, `Required Notice: Copyright 2026 DukeCorp1996 (https://dukecorp1996.x35.in/)`, same as PaTorrent. Commercial use needs DukeCorp1996's permission.
- Published: https://github.com/Balls0fSteel/Useful-Xbox-Cloud-Online-JS (`main`); raw install/update URLs verified (HTTP 200).
- v0.1: Tampermonkey userscript with score badges, genre labels, game-page score card, Game Finder panel, optional dimming of low scorers, and live store-rating lookups for games newer than the bundle.
- Data pipeline (`scripts/fetch-data.mjs`) pulls the full cloud catalog (~3,900 games, US market), Microsoft Store ratings, Steam matches + Metacritic, and batched Steam rating summaries (% positive + count only; no review texts by design).
- Build (`scripts/build-userscript.mjs`) bundles code and compact data into `dist/xbox-cloud-scores.user.js` (~0.9 MB) plus a `.meta.js` for Tampermonkey update checks.
- Local harness (`test/serve.mjs`) to test against saved page snapshots.

## In progress

- Nothing beyond the next steps below. First full data build and store-score calibration are done (see CHANGELOG).

## Next steps

1. GitHub Actions workflow: weekly `npm run all`, commit `data/` + `dist/` when changed (gives automatic updates to every user).
2. Replace the README screenshots with higher-resolution ones once installed for real (current ones come from the local harness at 800 px).
3. Review the Steam no-match list for popular games and add `data/overrides.json` entries where the title differs (e.g. "Hellblade II" vs "Senua's Saga: Hellblade II").

## Future improvements

- Live per-market Game Pass tier lists in the userscript (three sigl calls per day for the page's market) instead of the bundled US lists.
- More critic sources: OpenCritic or IGDB (both need an API key; the build would read it from an env var, never bundle it).
- HowLongToBeat lengths ("short games under 10h" filter).
- "Hide played / not interested" list stored per user, plus a "played" checkmark on tiles.
- User-adjustable score weights in Settings (recompute client-side with `src/score.js`).
- Per-market bundles (GB, DE, ...) or a market switch, since catalogs and prices differ by region.
- Optional Chrome/Edge MV3 extension build reusing the same bundle (content script + bundled JSON).
- Show price / sale price for Buy & stream games, with a "on sale" filter.
- Keyboard and controller navigation inside the Finder (couch / TV use).

## Open questions

- Which market is the user in? If not US, the Game Pass catalog and tier counts differ (one user saw only 57 Game Pass games). Per-market bundles or a live per-market Game Pass list may be needed.
- Should the bundled data stay inline in the userscript (current: one-file install, ~0.9 MB), or move to an `@resource` JSON so code and data update separately?
- Which market(s) should the default build target? Currently US / en-US.

## Known TODOs

- Steam title matching is exact after normalization. Some games will be missed (different naming) and a few could be mismatched (same name, different game). The overrides file is the escape hatch.
- Metacritic coverage is limited to what Steam's search exposes (mostly PC releases on Steam).
- Site class names (`Header-module__gameInfoTextContainer`, `gameArtContainer`) are CSS-module hashes matched by prefix; a site redesign may need selector updates.
- Live lookups only provide the Microsoft Store rating (no Steam/Metacritic) until the next data build.
