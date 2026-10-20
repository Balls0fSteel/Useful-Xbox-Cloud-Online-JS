# PLAN

Last updated: 2026-10-20_230228_1792530148

## Current state

- v0.1: Tampermonkey userscript with score badges, genre labels, game-page score card, Game Finder panel, optional dimming of low scorers, and live store-rating lookups for games newer than the bundle.
- Data pipeline (`scripts/fetch-data.mjs`) pulls the full cloud catalog (~3,900 games, US market), Microsoft Store ratings, Steam matches + Metacritic, and batched Steam rating summaries (% positive + count only; no review texts by design).
- Build (`scripts/build-userscript.mjs`) bundles code and compact data into `dist/xbox-cloud-scores.user.js` (~0.9 MB) plus a `.meta.js` for Tampermonkey update checks.
- Local harness (`test/serve.mjs`) to test against saved page snapshots.

## In progress

- Nothing beyond the next steps below. First full data build and store-score calibration are done (see CHANGELOG).

## Next steps

1. Push to GitHub (`main`) so the `@updateURL` / `@downloadURL` raw links work.
2. GitHub Actions workflow: weekly `npm run all`, commit `data/` + `dist/` when changed (gives automatic updates to every user).
3. Replace the README screenshots with higher-resolution ones once installed for real (current ones come from the local harness at 800 px).
4. Review the Steam no-match list for popular games and add `data/overrides.json` entries where the title differs (e.g. "Hellblade II" vs "Senua's Saga: Hellblade II").

## Future improvements

- More critic sources: OpenCritic or IGDB (both need an API key; the build would read it from an env var, never bundle it).
- HowLongToBeat lengths ("short games under 10h" filter).
- "Hide played / not interested" list stored per user, plus a "played" checkmark on tiles.
- User-adjustable score weights in Settings (recompute client-side with `src/score.js`).
- Per-market bundles (GB, DE, ...) or a market switch, since catalogs and prices differ by region.
- Optional Chrome/Edge MV3 extension build reusing the same bundle (content script + bundled JSON).
- Show price / sale price for Buy & stream games, with a "on sale" filter.
- Keyboard and controller navigation inside the Finder (couch / TV use).

## Open questions

- License for the repo (MIT? something else?). No license file is included yet, which means all rights reserved by default.
- Should the bundled data stay inline in the userscript (current: one-file install, ~0.9 MB), or move to an `@resource` JSON so code and data update separately?
- Which market(s) should the default build target? Currently US / en-US.

## Known TODOs

- Steam title matching is exact after normalization. Some games will be missed (different naming) and a few could be mismatched (same name, different game). The overrides file is the escape hatch.
- Metacritic coverage is limited to what Steam's search exposes (mostly PC releases on Steam).
- Site class names (`Header-module__gameInfoTextContainer`, `gameArtContainer`) are CSS-module hashes matched by prefix; a site redesign may need selector updates.
- Live lookups only provide the Microsoft Store rating (no Steam/Metacritic) until the next data build.
