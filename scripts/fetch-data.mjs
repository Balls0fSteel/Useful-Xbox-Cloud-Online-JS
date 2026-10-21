#!/usr/bin/env node
// Builds data/games.json: every game playable on Xbox Cloud Gaming (xbox.com/play),
// with genres, inputs, modes, Microsoft Store user ratings, Steam ratings and Metacritic.
//
// Usage:
//   node scripts/fetch-data.mjs                 full run (Steam lookups are cached and resumable)
//   node scripts/fetch-data.mjs --skip-steam    catalog + store ratings only, reuse cached Steam data
//   node scripts/fetch-data.mjs --steam-limit 50
//   node scripts/fetch-data.mjs --steam-retry-nomatch   re-search titles that had no Steam match
//   node scripts/fetch-data.mjs --market GB --language en-GB

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeScore, scoreConfidence } from "../src/score.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const STEAM_CACHE = path.join(CACHE_DIR, "steam.json");
const OVERRIDES = path.join(DATA_DIR, "overrides.json");
const OUT = path.join(DATA_DIR, "games.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const MARKET = opt("--market", "US");
const LANGUAGE = opt("--language", "en-US");
const SKIP_STEAM = flag("--skip-steam");
const STEAM_LIMIT = Number(opt("--steam-limit", "0")) || Infinity;
const STEAM_RETRY_NOMATCH = flag("--steam-retry-nomatch");

const DAY = 24 * 3600 * 1000;
const STEAM_MATCH_TTL = 60 * DAY;
const STEAM_NOMATCH_TTL = 21 * DAY;
const STEAM_REVIEWS_TTL = 10 * DAY;

// Gallery ids used by xbox.com/play (from the site's client bundle).
const SIGLS = {
  all: "1bf84c2b-0643-4591-893f-d9edb703f692",
  popular: "6a589fa0-d493-472b-8e20-3813699d7056",
  byog: "e78d9a61-5ef4-43af-b400-edba1250b18e",
  gamePass: "af206485-e87d-4624-9007-cb7f6d0cc42e",
  recent: "06323672-b8c8-43cc-b0de-32d5a9834749",
  leaving: "31ff2361-2772-4622-849b-f4f1abb4ad1b",
  adsMain: "51f14e5d-bdcb-4e04-b9cb-76e5057702df",
  adsByog: "e4c1d680-2c70-45e4-a38d-8a292c68c700",
  adsF2p: "d8f4afcd-882a-49e3-86b3-f61fa0172b75",
};

// The Game Pass gallery returns only the games a subscription includes when asked with that
// subscription's product id (ids and names from the site's client bundle). Each tier is a subset
// of the next one up.
const GAME_PASS_TIERS = [
  ["essential", "CFQ7TTC0K5DJ"], // Game Pass Essential (formerly Core)
  ["premium", "CFQ7TTC0P85B"], // Game Pass Premium (formerly Standard)
  ["ultimate", "CFQ7TTC0KHS0"], // Game Pass Ultimate
];

const IMAGE_PREFIX = "//store-images.s-microsoft.com/image/";

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

function msCv() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `${s}.0`;
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function getJson(url, init = {}, { retries = 4, backoff = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": "Useful-Xbox-Cloud-Online-JS data builder", ...(init.headers || {}) },
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (e) {
      const retryable = !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
      if (!retryable || attempt >= retries) throw e;
      const wait = e.status === 429 ? 60000 : backoff * 2 ** attempt;
      log(`  retry in ${Math.round(wait / 1000)}s: ${e.message}`);
      await sleep(wait);
    }
  }
}

async function pool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function readJson(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return def;
  }
}

function writeJson(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0) + "\n");
}

// ---------------------------------------------------------------- catalog

async function fetchSigl(id, subscriptionContext = "none") {
  const q = new URLSearchParams({
    id,
    market: MARKET,
    language: LANGUAGE,
    subscriptionContext,
    platformContext: "Cloud:XGPUWEB",
  });
  const d = await getJson(`https://catalog.gamepass.com/sigls/v3?${q}`);
  return d.filter((x) => x.id).map((x) => x.id);
}

async function hydrate(ids) {
  const out = {};
  const url = `https://catalog.gamepass.com/v3/products?market=${MARKET}&language=${LANGUAGE}&hydration=RemoteHighSapphire0`;
  await pool(chunk(ids, 100), 3, async (batch) => {
    const d = await getJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MS-CV": msCv(),
        "calling-app-name": "Xbox Cloud Gaming Web",
        "calling-app-version": "21.0.0",
      },
      body: JSON.stringify({ Products: batch }),
    });
    Object.assign(out, d.Products || {});
  });
  return out;
}

async function storeRatings(ids) {
  const out = {};
  let done = 0;
  await pool(chunk(ids, 20), 4, async (batch) => {
    const q = new URLSearchParams({
      bigIds: batch.join(","),
      market: MARKET,
      languages: LANGUAGE.toLowerCase(),
      fieldsTemplate: "browse",
    });
    const d = await getJson(`https://displaycatalog.mp.microsoft.com/v7.0/products?${q}`);
    for (const p of d.Products || []) {
      const usage = p.MarketProperties?.[0]?.UsageData || [];
      const all = usage.find((u) => u.AggregateTimeSpan === "AllTime");
      if (all) out[p.ProductId] = { avg: all.AverageRating, count: all.RatingCount };
    }
    done += batch.length;
    if (done % 400 < 20) log(`  store ratings ${done}/${ids.length}`);
  });
  return out;
}

// ---------------------------------------------------------------- normalisation

const MODE_BITS = {
  SinglePlayer: 1,
  XblOnlineMultiPlayer: 2,
  OnlineMultiplayerWithGold: 2,
  XblLocalMultiPlayer: 4,
  LocalMultiplayer: 4,
  XblOnlineCoop: 8,
  OnlineCoop: 8,
  XblLocalCoop: 16,
  LocalCoop: 16,
  XblCrossPlatformMultiPlayer: 32,
  XblCrossPlatformCoop: 32,
  CrossPlatformMultiplayer: 32,
};
const MODE_NAMES = { 1: "single", 2: "online-mp", 4: "local-mp", 8: "online-coop", 16: "local-coop", 32: "crossplay" };

function modesOf(p) {
  let bits = 0;
  for (const a of p.Attributes || []) bits |= MODE_BITS[a.Name] || 0;
  return Object.entries(MODE_NAMES)
    .filter(([b]) => bits & Number(b))
    .map(([, n]) => n);
}

function inputsOf(p) {
  const set = new Set();
  for (const off of Object.values(p.XCloudOfferings || {})) {
    for (const t of off.SupportedInputTypes || []) {
      if (t === "controller") set.add("controller");
      else if (t === "mkb") set.add("mkb");
      else if (/touch/i.test(t)) set.add("touch");
    }
  }
  if (!set.size) set.add("controller");
  return ["controller", "mkb", "touch"].filter((x) => set.has(x));
}

// The catalog uses placeholder dates such as 9998-12-30 and 2799-12-31 for "not announced".
function releaseDate(iso) {
  const d = (iso || "").slice(0, 10);
  const year = Number(d.slice(0, 4));
  return year >= 1970 && year <= new Date().getUTCFullYear() + 2 ? d : null;
}

function isF2P(p) {
  for (const off of Object.values(p.XCloudOfferings || {})) if ((off.Programs || []).includes("F2P")) return true;
  return p.AnonymousPrice?.MSRP?.value === 0;
}

export function slugify(title) {
  return (
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[™®©]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game"
  );
}

// Title normalisation for Steam matching. Strips trademark signs, platform tags and edition words
// so "Forza Horizon 5 Standard Edition (Xbox Series X|S)" and "Forza Horizon 5" compare equal.
const EDITION_WORDS =
  "standard|classic|deluxe|ultimate|gold|premium|complete|definitive|enhanced|anniversary|digital|special|launch|cross-gen|legendary|collector'?s|director'?s cut|game of the year|goty|xbox series x\\|s|xbox one|windows|windows 10|pc|console|console and pc|base|full game|super deluxe|royal|platinum|year \\d+";
// One or more edition words before "Edition", e.g. "Digital Deluxe Edition".
const EDITION_SRC = `\\b(?:(?:${EDITION_WORDS})\\s+)+(edition|version|bundle)\\b`;
const EDITION_RE = new RegExp(EDITION_SRC, "g");
// Trailing " - Launcher", ": 2026 Edition", " - Free Trial & Friend's Pass", " - Beta" and similar.
const SUFFIX_RE =
  /(?:\s+[-–—]|:)\s+(launcher|free access|free trial.*|friend'?s pass|[\w' ]*edition|[\w' ]*beta|demo|game preview|early access|pc|xbox series x\|s|xbox one)\s*$/i;

function stripSuffixes(t) {
  let prev;
  do {
    prev = t;
    t = t.replace(SUFFIX_RE, "");
  } while (t !== prev);
  return t;
}

export function normTitle(t) {
  return stripSuffixes(t.replace(/[™®©]/g, " "))
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(EDITION_RE, " ")
    .replace(/\b(for|on)\s+(xbox series x\|s|xbox one|windows 10|windows|pc)\b/g, " ")
    .replace(/\bxbox series x\|s\b|\bxbox one\b|\bwindows 10\b/g, " ")
    .replace(/\b(game preview|early access)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Second-chance comparison: also drops trailing "Remastered", "HD", "Definitive" and similar, because
// Steam often lists the original release while Xbox sells the remaster (same game, same reviews).
const LOOSE_TAIL_RE = /(\s+(remastered|remaster|hd|definitive|classic|enhanced))+$/;

export function looseTitle(t) {
  return normTitle(t).replace(LOOSE_TAIL_RE, "").trim();
}

function searchTerm(t) {
  return stripSuffixes(t.replace(/[™®©]/g, " "))
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(new RegExp(EDITION_SRC, "gi"), " ")
    .replace(/\bXbox Series X\|S\b|\bXbox One\b|\bWindows 10\b/gi, " ")
    .replace(/\s*[-–—:]\s*$/, "")
    .replace(/\s+([:,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- steam

async function steamSearch(term) {
  const q = new URLSearchParams({ term, l: "english", cc: MARKET });
  const d = await getJson(`https://store.steampowered.com/api/storesearch/?${q}`, {}, { retries: 8 });
  return (d.items || []).filter((i) => i.type === "app");
}

// Review summaries for up to 50 apps per call. Much gentler on Steam's rate limits than one
// appreviews request per game.
async function steamReviewBatch(appids) {
  const input = {
    ids: appids.map((appid) => ({ appid })),
    context: { language: "english", country_code: MARKET },
    data_request: { include_reviews: true },
  };
  const q = new URLSearchParams({ input_json: JSON.stringify(input) });
  const d = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?${q}`, {}, { retries: 8 });
  const out = {};
  for (const it of d.response?.store_items || []) {
    const s = it.reviews?.summary_filtered;
    if (!it.appid || !s) continue;
    const total = s.review_count || 0;
    out[it.appid] = { positive: Math.round((total * (s.percent_positive || 0)) / 100), total, desc: s.review_score_label || "" };
  }
  return out;
}

async function steamEnrich(games, cache, overrides) {
  const now = Date.now();

  // 1) Title search: finds the Steam app (and its Metacritic score) for each Xbox title.
  const searches = [];
  for (const g of games) {
    const ov = overrides[g.id];
    const c = cache[g.id];
    const norm = normTitle(g.title);
    if (ov && "steam" in ov) {
      const appid = ov.steam || null;
      if (!c || !c.manual || c.appid !== appid || c.norm !== norm) cache[g.id] = { norm, manual: true, searchedAt: now, appid, name: null, meta: null };
      continue;
    }
    const stale =
      !c ||
      c.manual ||
      c.norm !== norm ||
      !c.searchedAt ||
      (!c.appid && STEAM_RETRY_NOMATCH) ||
      now - c.searchedAt > (c.appid ? STEAM_MATCH_TTL : STEAM_NOMATCH_TTL);
    if (stale) searches.push({ g, norm });
  }
  const work = searches.slice(0, STEAM_LIMIT);
  log(`steam search: ${work.length} titles to look up (${games.length - searches.length} cached)`);
  let done = 0;
  let lastSave = Date.now();
  await pool(work, 1, async ({ g, norm }) => {
    try {
      const loose = looseTitle(g.title);
      const pick = (items) => items.find((i) => normTitle(i.name) === norm) || items.find((i) => looseTitle(i.name) === loose);
      let hit = pick(await steamSearch(searchTerm(g.title)));
      // Steam's search often misses the original listing when queried with "... Remastered".
      if (!hit && loose && loose !== norm) {
        await sleep(200);
        hit = pick(await steamSearch(loose));
      }
      const prev = cache[g.id];
      const keep = prev && hit && prev.appid === hit.id && !prev.manual;
      cache[g.id] = {
        norm,
        searchedAt: Date.now(),
        appid: hit ? hit.id : null,
        name: hit ? hit.name : null,
        meta: hit && hit.metascore ? Number(hit.metascore) : null,
        ...(keep ? { positive: prev.positive, total: prev.total, desc: prev.desc, reviewsAt: prev.reviewsAt } : {}),
      };
    } catch (e) {
      log(`  steam search failed for ${g.id} ${g.title}: ${e.message}`);
    }
    if (++done % 200 === 0) log(`  steam search ${done}/${work.length}`);
    if (Date.now() - lastSave > 30000) {
      writeJson(STEAM_CACHE, cache, false);
      lastSave = Date.now();
    }
    await sleep(200);
  });
  writeJson(STEAM_CACHE, cache, false);

  // 2) Review summaries, batched.
  const appids = [
    ...new Set(
      games
        .map((g) => cache[g.id])
        .filter((c) => c && c.appid && (!c.reviewsAt || now - c.reviewsAt > STEAM_REVIEWS_TTL))
        .map((c) => c.appid)
    ),
  ];
  log(`steam reviews: ${appids.length} apps to refresh`);
  const reviews = {};
  await pool(chunk(appids, 50), 1, async (batch) => {
    try {
      Object.assign(reviews, await steamReviewBatch(batch));
    } catch (e) {
      log(`  steam review batch failed: ${e.message}`);
    }
    await sleep(500);
  });
  const at = Date.now();
  for (const c of Object.values(cache)) {
    if (c.appid && reviews[c.appid]) Object.assign(c, reviews[c.appid], { reviewsAt: at });
  }
  writeJson(STEAM_CACHE, cache, false);
  log(`steam reviews: got ${Object.keys(reviews).length}`);
}

// ---------------------------------------------------------------- main

async function main() {
  log(`market ${MARKET} / ${LANGUAGE}`);
  const lists = {};
  for (const [k, id] of Object.entries(SIGLS)) {
    lists[k] = await fetchSigl(id);
    log(`sigl ${k}: ${lists[k].length}`);
  }
  for (const [tier, sub] of GAME_PASS_TIERS) {
    lists[`gp_${tier}`] = await fetchSigl(SIGLS.gamePass, sub);
    log(`sigl gamePass (${tier}): ${lists[`gp_${tier}`].length}`);
  }
  lists.gamePass = [...new Set([...lists.gamePass, ...lists.gp_ultimate])];
  const sets = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, new Set(v)]));
  // Lowest tier that includes the game in the cloud.
  const gamePassTier = (id) => GAME_PASS_TIERS.find(([tier]) => sets[`gp_${tier}`].has(id))?.[0] ?? (sets.gamePass.has(id) ? "ultimate" : null);
  const popRank = new Map(lists.popular.map((id, i) => [id, i + 1]));
  const ids = [...new Set([...lists.all, ...lists.byog, ...lists.gamePass, ...lists.adsMain, ...lists.adsByog, ...lists.adsF2p])];
  log(`unique games: ${ids.length}`);

  const products = await hydrate(ids);
  log(`hydrated: ${Object.keys(products).length}`);

  const ratings = await storeRatings(ids);
  log(`store ratings: ${Object.keys(ratings).length}`);

  const games = [];
  for (const id of ids) {
    const p = products[id];
    if (!p || !p.ProductTitle) continue;
    const r = ratings[id];
    games.push({
      id,
      title: p.ProductTitle.trim(),
      publisher: (p.PublisherName || "").trim(),
      developer: (p.DeveloperName || "").trim(),
      genres: [...new Set(p.LocalizedCategories || p.Categories || [])],
      release: releaseDate(p.OriginalReleaseDate),
      age: p.ContentRating?.Age ?? null,
      inputs: inputsOf(p),
      modes: modesOf(p),
      gamePass: sets.gamePass.has(id),
      gamePassTier: gamePassTier(id),
      byog: sets.byog.has(id),
      f2p: isF2P(p),
      // "Stream for free with ads": free-to-play games that need no subscription.
      ads: sets.adsMain.has(id) || sets.adsF2p.has(id),
      // "Stream your own games": owned games stream with ads, no subscription needed.
      adsOwn: sets.adsByog.has(id),
      recent: sets.recent.has(id),
      leaving: sets.leaving.has(id),
      popularity: popRank.get(id) ?? null,
      price: p.AnonymousPrice?.MSRP?.value ?? null,
      image: (p.Image_Tile?.URL || p.Image_Poster?.URL || "").replace(IMAGE_PREFIX, ""),
      store: r && r.count ? { rating: r.avg, count: r.count } : null,
      steam: null,
      metacritic: null,
      score: null,
      confidence: 0,
    });
  }

  const cache = readJson(STEAM_CACHE, {});
  const overrides = readJson(OVERRIDES, {});
  if (!SKIP_STEAM) await steamEnrich(games, cache, overrides);

  for (const g of games) {
    const c = cache[g.id];
    const ov = overrides[g.id] || {};
    const forced = "steam" in ov;
    const matchValid = c && c.norm === normTitle(g.title) && (forced ? c.manual && c.appid === (ov.steam || null) : !c.manual);
    if (matchValid && c.appid && c.total != null) {
      g.steam = { appid: c.appid, name: c.name || null, positive: c.positive, total: c.total, desc: c.desc };
      g.metacritic = c.meta || null;
    }
    if ("metacritic" in ov) g.metacritic = ov.metacritic;
    const input = {
      meta: g.metacritic,
      steamPos: g.steam?.positive,
      steamTotal: g.steam?.total,
      storeAvg: g.store?.rating,
      storeCount: g.store?.count,
    };
    g.score = computeScore(input);
    g.confidence = scoreConfidence(input);
  }

  games.sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9) || a.title.localeCompare(b.title));
  const meta = {
    builtAt: new Date().toISOString(),
    market: MARKET,
    language: LANGUAGE,
    count: games.length,
    withStore: games.filter((g) => g.store).length,
    withSteam: games.filter((g) => g.steam).length,
    withMetacritic: games.filter((g) => g.metacritic).length,
    // Cloud games each tier includes (cumulative, a tier includes the ones below it).
    gamePassTiers: Object.fromEntries(
      GAME_PASS_TIERS.map(([tier], i) => [tier, games.filter((g) => g.gamePassTier && GAME_PASS_TIERS.findIndex(([t]) => t === g.gamePassTier) <= i).length])
    ),
  };
  writeJson(OUT, { meta, games });
  log(`wrote ${path.relative(ROOT, OUT)}:`, JSON.stringify(meta));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
