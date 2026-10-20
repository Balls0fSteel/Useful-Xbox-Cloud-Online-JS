# CHANGELOG

## 2026-10-20_233432_1792532072 — v0.2 license, branding, donations

### Added
- `LICENSE.md`: PolyForm Noncommercial License 1.0.0 with `Required Notice: Copyright 2026 DukeCorp1996 (https://dukecorp1996.x35.in/)`, the same license file as PaTorrent ("no commercial use"; commercial use needs separate permission).
- DukeCorp1996 branding: userscript `@author`, `@copyright` and `@license` (shown on Tampermonkey's install page) plus the Required Notice line in the script header; package.json `author`, `license`, `funding`.
- README: "A DukeCorp1996 project" tagline, a License section in the PaTorrent style, a Donate section, and a trademark line for Xbox / Game Pass / Steam / Metacritic in the disclaimer.
- Finder: header button is now "♥ Donate"; the footer shows "© 2026 DukeCorp1996" and a highlighted "♥ Donate" link, both pointing to https://dukecorp1996.x35.in/.

### Changed
- Version 0.1 → 0.2, so existing installs update even though the data snapshot is unchanged (the userscript version is `<major>.<minor>.<data date>.<data time>`).
- `docs/finder.jpg` re-shot to show the Donate button and footer.

## 2026-10-20_233222_1792531942 — published

- Pushed `main` to https://github.com/Balls0fSteel/Useful-Xbox-Cloud-Online-JS. Verified the raw `dist/xbox-cloud-scores.user.js` (install) and `.meta.js` (update check) URLs return HTTP 200.

## 2026-10-20_230228_1792530148 — v0.1 initial release

### Added
- **Userscript** `dist/xbox-cloud-scores.user.js` for Tampermonkey on `xbox.com/play`:
  - color-coded score badge plus genre/year label on every game tile (home, galleries, search);
  - score card on game pages with Metacritic / Steam / Microsoft Store breakdown and links;
  - Game Finder panel (Alt+G or the bottom-right button) in a Shadow DOM: search, availability (Game Pass, Buy & stream, Free to play, Free with ads, Own it & stream with ads), recently added / leaving soon, minimum score, confidence, include/exclude genres, touch / mouse & keyboard, co-op / multiplayer modes, release year range, 9 sort orders, "Surprise me";
  - optional dimming of low-scoring tiles on the normal Xbox pages;
  - live Microsoft Store lookups (cached 7 days) for games newer than the bundled data;
  - hidden while a game stream is running; filters and settings persisted.
- **Data pipeline** `scripts/fetch-data.mjs` (Node, no dependencies), covering about 3,900 cloud games in the US market.
- **Build** `scripts/build-userscript.mjs`: compact columnar data with a shared string table, inlined into the script; also writes `.meta.js` for Tampermonkey update checks. Version = `<major>.<minor>.<data date>.<data time>`.
- **Scoring** `src/score.js` (shared by build and browser): Metacritic 40%, Steam 35% (SteamDB formula), Microsoft Store 25% (Bayesian average), with confidence levels 0–3.
- **Test harness** `test/serve.mjs`: serves saved page snapshots with the live site's CSS and the built script.
- README (goals, install, scoring, pipeline, privacy, support link), PLAN, `data/overrides.json` for manual Steam/Metacritic fixes.

### Findings / decisions
- xbox.com/play's "All games" gallery is SIGL `1bf84c2b-…` on `catalog.gamepass.com/sigls/v3` and needs `subscriptionContext=none&platformContext=Cloud:XGPUWEB`. Product hydration (`/v3/products`) needs an `MS-CV` header. Gallery IDs were taken from the site's client bundle.
- The site ignores the slug in `/play/games/<slug>/<ProductId>` and redirects by product ID, so links can use a locally generated slug.
- In-app navigation works with `history.pushState` + a synthetic `popstate` (no full reload).
- The virtualized grid creates new tile elements while scrolling rather than reusing them, so a MutationObserver plus an idempotent decorate pass is enough.
- The "stream with ads" galleries mean two different things: *free with ads* (free-to-play, no subscription) versus *stream your own games with ads*. They are separate flags.
- Saved page snapshots contain account details (gamerpic), so they are git-ignored.
- **Only aggregate ratings are used**: Metacritic score, Steam % positive + count, store stars + count. No individual review texts are fetched or shown (decided with the user: review texts are often misleading). UI labels say "Steam rating", not "reviews".
- **Store score calibration**: a plain linear 1–5 → 0–100 mapping turned out to be *below* Steam at every percentile (median store 4.0★ → 75 vs Steam 82), not inflated as assumed. Percentile matching across ~1,800 games with both sources gives ≈ `stars × 20 + 1.5`, flattening above 4.5★ (slope 12.5). The Bayesian prior is 3.9★ (the catalog mean), weighted as 30 votes.
- Steam matching: exact normalized title first, then a "loose" pass that ignores trailing Remastered/HD/Definitive/Classic/Enhanced, with a second search query if the first finds nothing. Multi-word editions ("Digital Deluxe Edition") and ™/® between words ("Borderlands®4") are handled.

### Issues hit and fixes
- Steam `appreviews` (one request per game) returned HTTP 429 after about 300 games. Switched to batched `IStoreBrowseService/GetItems` (50 apps per call) and a single throttled search worker.
- Finder result cards collapsed to 2 px rows: `overflow:hidden` cards inside a fixed-height grid shrink to their 0 minimum. Fixed with `grid-auto-rows:max-content`.
- Panel header overflowed at phone width. The header now wraps, the search box goes on its own row, and labels are shortened.
- Escape didn't close the Finder after clicking ⚙ (the re-render dropped focus out of the panel). The Escape handler now sits on the document in the capture phase.
- `̀-ͯ` escapes were written to disk as literal combining characters. Replaced them with `\p{M}` (unicode flag).
