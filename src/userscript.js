// Main userscript body. The build wraps it in an IIFE together with src/score.js and the
// bundled data (xcsData()), see scripts/build-userscript.mjs.

const DONATE_URL = "https://dukecorp1996.x35.in/";
const REPO_URL = "https://github.com/Balls0fSteel/Useful-Xbox-Cloud-Online-JS";
const IMG_BASE = "https://store-images.s-microsoft.com/image/";
const LIVE_TTL = 7 * 24 * 3600 * 1000;

const FLAG = { gamePass: 1, byog: 2, f2p: 4, ads: 8, recent: 16, leaving: 32, adsOwn: 64 };
const INPUT = { controller: 1, mkb: 2, touch: 4 };
const MODE = { single: 1, onlineMp: 2, localMp: 4, onlineCoop: 8, localCoop: 16, crossplay: 32 };

// Game Pass tiers, lowest first. A game's `tier` is the cheapest tier that includes it in the cloud.
const TIERS = [
  [1, "Essential"],
  [2, "Premium"],
  [3, "Ultimate"],
];
const TIER_NAME = Object.fromEntries(TIERS);

const AVAIL_CHIPS = [
  ["gamePass", "In my Game Pass"],
  ["byog", "Buy & stream"],
  ["f2p", "Free to play"],
  ["ads", "Free with ads"],
  ["adsOwn", "Own it: stream with ads"],
];
const SPECIAL_CHIPS = [
  ["recent", "Recently added"],
  ["leaving", "Leaving soon"],
];
const INPUT_CHIPS = [
  ["touch", "Touch"],
  ["mkb", "Mouse & keyboard"],
];
const MODE_CHIPS = [
  ["single", "Single player"],
  ["onlineCoop", "Online co-op"],
  ["localCoop", "Local co-op"],
  ["onlineMp", "Online multiplayer"],
  ["localMp", "Local multiplayer"],
  ["crossplay", "Cross-play"],
];
const SORTS = [
  ["score", "Score"],
  ["meta", "Metacritic"],
  ["steam", "Steam rating"],
  ["store", "Store rating"],
  ["votes", "Most rated"],
  ["popular", "Popular on Xbox"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["title", "Title A-Z"],
];
const CONF_LABELS = ["Any", "Some ratings", "Decent sample", "Critic + users"];

const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

// ---------------------------------------------------------------- storage

const store = {
  get(key, def) {
    try {
      if (typeof GM_getValue === "function") {
        const v = GM_getValue(key);
        return v === undefined ? def : v;
      }
      const v = localStorage.getItem("xcs." + key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, val) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, val);
      else localStorage.setItem("xcs." + key, JSON.stringify(val));
    } catch {
      /* storage full or blocked: settings just won't persist */
    }
  },
};

// tier: the viewer's Game Pass (1 Essential, 2 Premium, 3 Ultimate).
const DEFAULT_SETTINGS = { badges: true, genreLabels: true, dimBelow: 0, live: true, tier: 3 };
// Bump FILTERS_VERSION when a default changes that existing users should pick up once.
const FILTERS_VERSION = 2;
const DEFAULT_FILTERS = {
  v: FILTERS_VERSION,
  q: "",
  sort: "score",
  minScore: 0,
  minConf: 0,
  avail: ["gamePass"],
  special: [],
  genres: {},
  inputs: [],
  modes: [],
  yearFrom: "",
  yearTo: "",
  hasMeta: false,
  hasSteam: false,
};
const settings = { ...DEFAULT_SETTINGS, ...store.get("settings", {}) };
const storedFilters = store.get("filters", null);
let filters = { ...JSON.parse(JSON.stringify(DEFAULT_FILTERS)), ...(storedFilters || {}) };
if (storedFilters && (storedFilters.v || 1) < 2) {
  // v2: Game Pass-only became the default view.
  if (!filters.avail.includes("gamePass")) filters.avail.push("gamePass");
  filters.v = FILTERS_VERSION;
  store.set("filters", filters);
}

// ---------------------------------------------------------------- data

const RAW = xcsData();
const STR = RAW.strings;

function normSearch(s) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[™®©]/g, "");
}

const MAX_YEAR = new Date().getFullYear() + 2;

function finish(g) {
  g.year = g.release ? Math.floor(g.release / 10000) : null;
  // Placeholder dates like 9998-12-30 mean "not announced".
  if (g.year && g.year > MAX_YEAR) g.year = g.release = null;
  g.steamPct = g.steamTotal ? Math.round((g.steamPos / g.steamTotal) * 100) : null;
  g.votes = (g.steamTotal || 0) + (g.storeCount || 0);
  g.hay = normSearch(`${g.title} ${g.publisher} ${g.developer}`);
  return g;
}

const GAMES = RAW.rows.map((r) =>
  finish({
    id: r[0],
    title: r[1],
    publisher: STR[r[2]] || "",
    developer: STR[r[3]] || "",
    genres: r[4].map((i) => STR[i]),
    release: r[5] || null,
    age: r[6] < 0 ? null : r[6],
    inputs: r[7],
    modes: r[8],
    flags: r[9],
    popularity: r[10] || null,
    price: r[11] < 0 ? null : r[11] / 100,
    image: r[12],
    storeRating: r[13] ? r[13] / 10 : null,
    storeCount: r[13] ? r[14] || 0 : 0,
    steamId: r[15] || null,
    steamPos: r[16] || 0,
    steamTotal: r[17] || 0,
    meta: r[18] || null,
    score: r[19] < 0 ? null : r[19],
    conf: r[20] || 0,
    tier: r[21] || 0,
  })
);

// Cloud games each tier includes, counting the tiers below it.
const TIER_COUNTS = Object.fromEntries(TIERS.map(([v]) => [v, GAMES.filter((g) => g.tier && g.tier <= v).length]));

function inMyGamePass(g) {
  return !!g.tier && g.tier <= settings.tier;
}

function tierLabel(g) {
  return g.tier ? `Game Pass ${TIER_NAME[g.tier]}${g.tier < 3 ? " and up" : ""}` : "";
}
const BY_ID = new Map(GAMES.map((g) => [g.id, g]));
const ALL_GENRES = (() => {
  const counts = new Map();
  for (const g of GAMES) for (const x of g.genres) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
})();

// ---------------------------------------------------------------- live lookups for games newer than the bundle

const liveCache = store.get("live", {});
const liveQueue = new Set();
let liveTimer = null;

for (const [id, e] of Object.entries(liveCache)) {
  if (!e || Date.now() - e.ts > LIVE_TTL) delete liveCache[id];
  else if (e.game && !BY_ID.has(id)) BY_ID.set(id, finish(e.game));
}

function localeInfo() {
  const m = location.pathname.match(/^\/([a-z]{2})-([a-z]{2})\//i);
  const lang = m ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : "en-US";
  return { prefix: m ? `/${lang}` : "", lang, market: m ? m[2].toUpperCase() : RAW.market || "US" };
}

function gmJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== "function") return reject(new Error("GM_xmlhttpRequest unavailable"));
    GM_xmlhttpRequest({
      method,
      url,
      data: body,
      headers,
      timeout: 20000,
      onload: (r) => {
        if (r.status < 200 || r.status >= 300) return reject(new Error(`HTTP ${r.status}`));
        try {
          resolve(JSON.parse(r.responseText));
        } catch (e) {
          reject(e);
        }
      },
      onerror: () => reject(new Error("network error")),
      ontimeout: () => reject(new Error("timeout")),
    });
  });
}

function requestLive(id) {
  if (!settings.live || BY_ID.has(id) || liveCache[id]) return;
  liveQueue.add(id);
  clearTimeout(liveTimer);
  liveTimer = setTimeout(flushLive, 1200);
}

async function flushLive() {
  const ids = [...liveQueue].slice(0, 20);
  ids.forEach((id) => liveQueue.delete(id));
  if (!ids.length) return;
  const { lang, market } = localeInfo();
  const now = Date.now();
  try {
    const cv = Math.random().toString(36).slice(2, 18).padEnd(16, "x") + ".0";
    const [hyd, dc] = await Promise.all([
      gmJson(
        "POST",
        `https://catalog.gamepass.com/v3/products?market=${market}&language=${lang}&hydration=RemoteHighSapphire0`,
        JSON.stringify({ Products: ids }),
        { "Content-Type": "application/json", "MS-CV": cv, "calling-app-name": "Xbox Cloud Gaming Web", "calling-app-version": "21.0.0" }
      ),
      gmJson(
        "GET",
        `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.join(",")}&market=${market}&languages=${lang.toLowerCase()}&fieldsTemplate=browse`
      ).catch(() => ({ Products: [] })),
    ]);
    const ratings = {};
    for (const p of dc.Products || []) {
      const all = (p.MarketProperties?.[0]?.UsageData || []).find((u) => u.AggregateTimeSpan === "AllTime");
      if (all) ratings[p.ProductId] = all;
    }
    for (const id of ids) {
      const p = hyd.Products?.[id];
      if (!p || !p.ProductTitle) {
        liveCache[id] = { ts: now, game: null };
        continue;
      }
      const r = ratings[id];
      let inputs = 0;
      for (const off of Object.values(p.XCloudOfferings || {}))
        for (const t of off.SupportedInputTypes || []) {
          if (t === "controller") inputs |= INPUT.controller;
          else if (t === "mkb") inputs |= INPUT.mkb;
          else if (/touch/i.test(t)) inputs |= INPUT.touch;
        }
      const scoreIn = { storeAvg: r?.AverageRating, storeCount: r?.RatingCount };
      const game = {
        id,
        title: p.ProductTitle.trim(),
        publisher: p.PublisherName || "",
        developer: p.DeveloperName || "",
        genres: p.LocalizedCategories || p.Categories || [],
        release: p.OriginalReleaseDate ? Number(p.OriginalReleaseDate.slice(0, 10).replace(/-/g, "")) : null,
        age: p.ContentRating?.Age ?? null,
        inputs: inputs || INPUT.controller,
        modes: 0,
        flags: 0,
        popularity: null,
        price: p.AnonymousPrice?.MSRP?.value ?? null,
        image: (p.Image_Tile?.URL || p.Image_Poster?.URL || "").replace("//store-images.s-microsoft.com/image/", ""),
        storeRating: r?.RatingCount ? r.AverageRating : null,
        storeCount: r?.RatingCount || 0,
        steamId: null,
        steamPos: 0,
        steamTotal: 0,
        meta: null,
        score: computeScore(scoreIn),
        conf: scoreConfidence(scoreIn),
        live: true,
      };
      liveCache[id] = { ts: now, game };
      BY_ID.set(id, finish({ ...game }));
    }
    store.set("live", liveCache);
    scheduleScan(true);
    // Keep the viewer's place: a plain refresh would jump the results back to the top.
    if (panel.open) panel.refresh({ keep: true });
  } catch (e) {
    console.warn("[xcs] live lookup failed", e);
    for (const id of ids) liveCache[id] = { ts: now - LIVE_TTL + 3600 * 1000, game: null };
  }
  if (liveQueue.size) liveTimer = setTimeout(flushLive, 1500);
}

// ---------------------------------------------------------------- formatting

function scoreTier(score) {
  if (score == null) return 0;
  if (score >= 85) return 5;
  if (score >= 75) return 4;
  if (score >= 65) return 3;
  if (score >= 50) return 2;
  return 1;
}

function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(n);
}

function breakdown(g) {
  const parts = [];
  if (g.meta) parts.push(`Metacritic ${g.meta}`);
  if (g.steamTotal) parts.push(`Steam ${g.steamPct}% (${fmtCount(g.steamTotal)})`);
  if (g.storeCount) parts.push(`Store ${g.storeRating.toFixed(1)}★ (${fmtCount(g.storeCount)})`);
  return parts;
}

function tooltip(g) {
  const lines = [`${g.title}`, `Score: ${g.score ?? "n/a"}${g.conf <= 1 && g.score != null ? " (thin data)" : ""}`];
  lines.push(...breakdown(g));
  if (g.tier) lines.push(`${tierLabel(g)}${inMyGamePass(g) ? "" : " (not in your tier)"}`);
  if (g.genres.length) lines.push(g.genres.join(", "));
  return lines.join("\n");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function slugify(title) {
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

function gamePath(g) {
  return `${localeInfo().prefix}/play/games/${slugify(g.title)}/${g.id}`;
}

function navigate(path) {
  try {
    W.history.pushState({}, "", path);
    W.dispatchEvent(new W.PopStateEvent("popstate", { state: {} }));
  } catch {
    location.assign(path);
  }
}

// ---------------------------------------------------------------- page styles (tile badges, detail card)

const PAGE_CSS = `
.xcs-badge{position:absolute;top:6px;left:6px;z-index:6;min-width:28px;height:22px;padding:0 7px;box-sizing:border-box;border-radius:11px;
  font:700 12px/22px "Segoe UI",system-ui,sans-serif;text-align:center;letter-spacing:.2px;box-shadow:0 1px 5px rgba(0,0,0,.55);cursor:help}
.xcs-badge.xcs-low{opacity:.85;box-shadow:0 0 0 1.5px rgba(255,255,255,.55) inset,0 1px 5px rgba(0,0,0,.55)}
.xcs-genre{position:absolute;left:0;right:0;top:0;z-index:5;padding:6px 8px 14px 44px;box-sizing:border-box;pointer-events:none;
  font:600 10.5px/1.25 "Segoe UI",system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;background:linear-gradient(rgba(0,0,0,.75),transparent);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xcs-t0{background:#3f3f46;color:#e4e4e7}.xcs-t1{background:#ef4444;color:#fff}.xcs-t2{background:#f97316;color:#1a0a00}
.xcs-t3{background:#eab308;color:#1a1300}.xcs-t4{background:#84cc16;color:#0d1402}.xcs-t5{background:#22c55e;color:#03140a}
.xcs-dim{opacity:.2!important;filter:grayscale(1)!important;transition:opacity .15s,filter .15s}
.xcs-dim:hover,.xcs-dim:focus-within{opacity:1!important;filter:none!important}
.xcs-detail{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:12px 0 4px;font:500 14px/1.3 "Segoe UI",system-ui,sans-serif;color:#e4e4e7}
.xcs-detail .xcs-big{min-width:52px;height:40px;padding:0 10px;box-sizing:border-box;border-radius:10px;font:800 22px/40px "Segoe UI",system-ui,sans-serif;text-align:center}
.xcs-detail .xcs-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:15px;background:rgba(255,255,255,.1);
  color:#f4f4f5;text-decoration:none;font-weight:600;white-space:nowrap}
.xcs-detail a.xcs-chip:hover{background:rgba(255,255,255,.2)}
.xcs-detail .xcs-chip.xcs-gp{background:#107c10;color:#fff}
.xcs-detail .xcs-note{font-size:12px;color:#a1a1aa;flex-basis:100%}
#xcs-fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;height:44px;padding:0 18px 0 14px;border:0;border-radius:22px;
  background:#107c10;color:#fff;font:700 14px/44px "Segoe UI",system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer}
#xcs-fab:hover{background:#138a13}
#xcs-fab:focus-visible{outline:3px solid #9bf00b;outline-offset:2px}
#xcs-fab svg{width:18px;height:18px}
`;

function injectPageCss() {
  if (document.getElementById("xcs-page-css")) return;
  const st = document.createElement("style");
  st.id = "xcs-page-css";
  st.textContent = PAGE_CSS;
  (document.head || document.documentElement).appendChild(st);
}

// ---------------------------------------------------------------- tile badges

const ID_RE = /\/play\/games\/[^/]+\/([0-9A-Z]{12})(?:[/?#]|$)/i;

function idFromHref(href) {
  const m = href && href.match(ID_RE);
  return m ? m[1].toUpperCase() : null;
}

function isStreaming() {
  return /\/play\/(launch|consoles\/launch)\//.test(location.pathname);
}

function decorateTile(a, id) {
  const g = BY_ID.get(id);
  const host = a.querySelector('[class*="gameArtContainer"]') || a;
  let badge = host.querySelector(":scope > .xcs-badge");
  let genre = host.querySelector(":scope > .xcs-genre");
  if (!settings.badges) {
    badge?.remove();
    genre?.remove();
    a.classList.remove("xcs-dim");
    a.dataset.xcsId = id;
    return;
  }
  if (!g) requestLive(id);
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  if (!badge) {
    badge = document.createElement("span");
    host.appendChild(badge);
  }
  const score = g ? g.score : null;
  badge.className = `xcs-badge xcs-t${scoreTier(score)}${g && g.conf <= 1 ? " xcs-low" : ""}`;
  badge.textContent = score == null ? "–" : String(score);
  badge.title = g ? tooltip(g) : "No score data yet";
  if (settings.genreLabels && g && g.genres.length) {
    if (!genre) {
      genre = document.createElement("span");
      genre.className = "xcs-genre";
      host.appendChild(genre);
    }
    genre.textContent = g.genres.slice(0, 2).join(" · ") + (g.year ? ` · ${g.year}` : "");
  } else genre?.remove();
  a.classList.toggle("xcs-dim", !!settings.dimBelow && (score == null || score < settings.dimBelow));
  a.dataset.xcsId = id;
}

function scanTiles(force) {
  if (isStreaming()) return;
  for (const a of document.querySelectorAll('a[href*="/play/games/"]')) {
    if (a.closest("#xcs-root")) continue;
    const id = idFromHref(a.getAttribute("href"));
    if (!id) continue;
    if (!force && a.dataset.xcsId === id && (!settings.badges || a.querySelector(".xcs-badge"))) continue;
    decorateTile(a, id);
  }
}

// ---------------------------------------------------------------- detail page card

function decorateDetail() {
  const id = idFromHref(location.pathname);
  const old = document.querySelector(".xcs-detail");
  if (!id) {
    old?.remove();
    return;
  }
  const container = document.querySelector('[class*="Header-module__gameInfoTextContainer"]');
  if (!container) return;
  if (old && old.dataset.id === id && container.contains(old)) return;
  old?.remove();
  const g = BY_ID.get(id);
  if (!g) requestLive(id);
  const box = document.createElement("div");
  box.className = "xcs-detail";
  box.dataset.id = id;
  const t = scoreTier(g?.score ?? null);
  const parts = [`<span class="xcs-big xcs-t${t}" title="${esc(g ? tooltip(g) : "No score data yet")}">${g?.score ?? "–"}</span>`];
  if (g) {
    const mcUrl = `https://www.metacritic.com/search/${encodeURIComponent(g.title)}/?category=13`;
    parts.push(
      g.meta
        ? `<a class="xcs-chip" href="${mcUrl}" target="_blank" rel="noopener">Metacritic ${g.meta}</a>`
        : `<a class="xcs-chip" href="${mcUrl}" target="_blank" rel="noopener" title="Search Metacritic">Metacritic ?</a>`
    );
    if (g.steamId)
      parts.push(
        `<a class="xcs-chip" href="https://store.steampowered.com/app/${g.steamId}/" target="_blank" rel="noopener">Steam ${g.steamPct}% · ${fmtCount(g.steamTotal)}</a>`
      );
    if (g.storeCount) parts.push(`<span class="xcs-chip">Store ${g.storeRating.toFixed(1)}★ · ${fmtCount(g.storeCount)}</span>`);
    if (g.tier)
      parts.push(
        `<span class="xcs-chip${inMyGamePass(g) ? " xcs-gp" : ""}" title="Lowest Game Pass tier that includes this game in the cloud">${esc(tierLabel(g))}</span>`
      );
    if (g.conf <= 1) parts.push(`<span class="xcs-note">Thin data: this score is based on few ratings.</span>`);
    if (g.live) parts.push(`<span class="xcs-note">New game: live store rating only, no critic or Steam data yet.</span>`);
  }
  box.innerHTML = parts.join("");
  container.appendChild(box);
}

// ---------------------------------------------------------------- finder panel (shadow DOM keeps site CSS out)

const PANEL_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;
  font:400 14px/1.4 "Segoe UI",system-ui,-apple-system,sans-serif;color:#e4e4e7}
.pn{width:min(1400px,96vw);height:min(940px,94vh);background:#121214;border:1px solid #27272a;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.6)}
.hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #27272a;background:#18181b}
.hd h2{margin:0;font:700 17px/1.2 inherit;color:#fff;white-space:nowrap}
.hd .logo{width:26px;height:26px;border-radius:7px;background:#107c10;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}
.hd .count{color:#a1a1aa;font-size:13px;white-space:nowrap}
.hd .sp{flex:1}
.q{flex:1 1 280px;max-width:420px;height:36px;border-radius:9px;border:1px solid #3f3f46;background:#09090b;color:#fff;padding:0 12px;font:inherit;outline:none}
.q:focus{border-color:#107c10;box-shadow:0 0 0 2px rgba(16,124,16,.35)}
select,.num{height:36px;border-radius:9px;border:1px solid #3f3f46;background:#09090b;color:#fff;padding:0 8px;font:inherit}
.btn{height:36px;padding:0 12px;border-radius:9px;border:1px solid #3f3f46;background:#27272a;color:#f4f4f5;font:600 13px/1 inherit;cursor:pointer;white-space:nowrap;
  display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.btn:hover{background:#3f3f46}
.btn.green{background:#107c10;border-color:#107c10;color:#fff}.btn.green:hover{background:#138a13}
.btn.heart{color:#fda4af;border-color:#4c1d24;background:#2a1215}.btn.heart:hover{background:#3b1a1f}
.icon{width:36px;padding:0;justify-content:center;font-size:18px}
.bd{flex:1;display:flex;min-height:0}
.sd{width:290px;flex:none;overflow:auto;padding:14px 16px 24px;border-right:1px solid #27272a;background:#141416}
.sd h3{margin:16px 0 8px;font:700 11px/1 inherit;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa}
.sd h3:first-child{margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{height:28px;padding:0 10px;border-radius:14px;border:1px solid #3f3f46;background:transparent;color:#d4d4d8;font:500 12.5px/26px inherit;cursor:pointer;white-space:nowrap}
.chip:hover{border-color:#71717a;color:#fff}
.chip.on{background:#107c10;border-color:#107c10;color:#fff}
.chip.ex{background:#3b1113;border-color:#7f1d1d;color:#fca5a5;text-decoration:line-through}
.chip small{opacity:.6;margin-left:4px}
.hint{font-size:11.5px;color:#71717a;margin-top:6px}
.row{display:flex;align-items:center;gap:8px}
.row label{font-size:13px;color:#d4d4d8}
input[type=range]{flex:1;accent-color:#107c10}
.val{min-width:30px;text-align:right;font-weight:700;color:#fff}
.num{width:84px}
.cb{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;color:#d4d4d8;cursor:pointer}
.cb input{accent-color:#107c10;width:16px;height:16px}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #27272a;flex-wrap:wrap}
.res{flex:1;overflow:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));grid-auto-rows:max-content;gap:14px;align-content:start}
.card{display:flex;flex-direction:column;border-radius:10px;overflow:hidden;background:#1c1c1f;border:1px solid #27272a;color:inherit;text-decoration:none;
  transition:transform .12s,border-color .12s}
.card:hover,.card:focus-visible{transform:translateY(-2px);border-color:#107c10;outline:none}
.art{position:relative;aspect-ratio:2/3;background:#27272a}
.art img{width:100%;height:100%;object-fit:cover;display:block}
.pill{position:absolute;top:6px;left:6px;min-width:30px;height:24px;padding:0 7px;border-radius:12px;font:800 13px/24px inherit;text-align:center;box-shadow:0 1px 5px rgba(0,0,0,.6)}
.pill.low{box-shadow:0 0 0 1.5px rgba(255,255,255,.55) inset,0 1px 5px rgba(0,0,0,.6)}
.tags{position:absolute;right:6px;top:6px;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.tag{height:18px;padding:0 6px;border-radius:5px;background:rgba(0,0,0,.75);color:#fff;font:700 10px/18px inherit;letter-spacing:.03em}
.tag.gp{background:#107c10}.tag.up{background:rgba(0,0,0,.78);color:#9bf00b;box-shadow:inset 0 0 0 1px #107c10}.tag.free{background:#2563eb}.tag.leave{background:#b91c1c}.tag.new{background:#7c3aed}
.info{padding:8px 9px 10px;display:flex;flex-direction:column;gap:3px;min-height:86px}
.t{font-weight:700;color:#fff;font-size:13.5px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sub{font-size:11.5px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.subs{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto;padding-top:4px}
.subs span{font-size:10.5px;font-weight:600;color:#d4d4d8;background:#27272a;border-radius:4px;padding:1px 5px}
.empty{grid-column:1/-1;text-align:center;color:#a1a1aa;padding:60px 0}
.more{grid-column:1/-1;height:1px}
.t0{background:#3f3f46;color:#e4e4e7}.t1{background:#ef4444;color:#fff}.t2{background:#f97316;color:#1a0a00}
.t3{background:#eab308;color:#1a1300}.t4{background:#84cc16;color:#0d1402}.t5{background:#22c55e;color:#03140a}
.ft{display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid #27272a;background:#18181b;color:#71717a;font-size:12px;flex-wrap:wrap}
.ft a{color:#a1a1aa}
.ft a.don{color:#fda4af;font-weight:700}
.ft .sp{flex:1}
.settings{padding:4px 0}
.filtbtn{display:none}
@media (max-width:820px){
  .pn{width:100vw;height:100vh;border-radius:0;border:0}
  .sd{position:absolute;z-index:2;top:0;bottom:0;left:0;width:min(320px,88vw);transform:translateX(-105%);transition:transform .18s;box-shadow:8px 0 30px rgba(0,0,0,.6)}
  .bd{position:relative}
  .bd.showf .sd{transform:none}
  .filtbtn{display:inline-flex}
  .hd h2,.hd .count,.hd .sp,.heart .lbl,.ft .note{display:none}
  .hd{flex-wrap:wrap;gap:8px;padding:10px 12px}
  .heart{margin-left:auto}
  .q{order:10;flex:1 1 100%;max-width:none}
  .res{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;padding:12px}
}
`;

const panel = {
  open: false,
  host: null,
  root: null,
  results: [],
  shown: 0,
  io: null,
  showSettings: false,

  ensure() {
    if (this.host) return;
    this.host = document.createElement("div");
    this.host.id = "xcs-root";
    this.root = this.host.attachShadow({ mode: "open" });
    document.body.appendChild(this.host);
  },

  toggle(force) {
    const want = force ?? !this.open;
    if (want) this.show();
    else this.hide();
  },

  show() {
    this.ensure();
    this.open = true;
    this.render();
    this.root.querySelector(".q")?.focus();
  },

  hide() {
    this.open = false;
    if (this.root) this.root.innerHTML = "";
    this.io?.disconnect();
  },

  saveFilters() {
    store.set("filters", filters);
  },

  render() {
    const s = filters;
    const chip = (group, key, label, on) => `<button class="chip${on ? " on" : ""}" data-g="${group}" data-k="${key}">${esc(label)}</button>`;
    const genreChips = ALL_GENRES.map(([name, n]) => {
      const st = s.genres[name] || 0;
      return `<button class="chip${st === 1 ? " on" : st === -1 ? " ex" : ""}" data-g="genre" data-k="${esc(name)}">${esc(name)}<small>${n}</small></button>`;
    }).join("");
    this.root.innerHTML = `<style>${PANEL_CSS}</style>
<div class="ov" part="overlay">
 <div class="pn" role="dialog" aria-modal="true" aria-label="Xbox Cloud Gaming game finder">
  <div class="hd">
   <div class="logo">★</div><h2>Cloud Game Finder</h2><span class="count"></span>
   <button class="btn filtbtn" data-act="filters">Filters</button>
   <input class="q" type="search" placeholder="Search title, publisher, developer…" value="${esc(s.q)}" aria-label="Search games">
   <span class="sp"></span>
   <a class="btn heart" href="${DONATE_URL}" target="_blank" rel="noopener" title="Donate to DukeCorp1996, the author of this script">♥<span class="lbl"> Donate</span></a>
   <button class="btn icon" data-act="settings" title="Settings" aria-label="Settings">⚙</button>
   <button class="btn icon" data-act="close" title="Close (Esc)" aria-label="Close">✕</button>
  </div>
  <div class="bd">
   <aside class="sd">
    ${this.showSettings ? this.settingsHtml() : ""}
    <h3>Your Game Pass</h3>
    <select data-s="tier" aria-label="Your Game Pass tier">${TIERS.map(
      ([v, name]) => `<option value="${v}"${settings.tier === v ? " selected" : ""}>${name} (${TIER_COUNTS[v]} cloud games)</option>`
    ).join("")}</select>
    <h3>Availability</h3><div class="chips">${AVAIL_CHIPS.map(([k, l]) => chip("avail", k, l, s.avail.includes(k))).join("")}</div>
    <div class="chips" style="margin-top:6px">${SPECIAL_CHIPS.map(([k, l]) => chip("special", k, l, s.special.includes(k))).join("")}</div>
    <h3>Minimum score</h3>
    <div class="row"><input type="range" min="0" max="95" step="5" value="${s.minScore}" data-f="minScore" aria-label="Minimum score"><span class="val" data-v="minScore">${s.minScore || "Any"}</span></div>
    <h3>Score confidence</h3>
    <select data-f="minConf" aria-label="Score confidence">${CONF_LABELS.map((l, i) => `<option value="${i}"${s.minConf == i ? " selected" : ""}>${l}</option>`).join("")}</select>
    <label class="cb"><input type="checkbox" data-f="hasMeta"${s.hasMeta ? " checked" : ""}> Has Metacritic score</label>
    <label class="cb"><input type="checkbox" data-f="hasSteam"${s.hasSteam ? " checked" : ""}> Has Steam rating</label>
    <h3>Genres</h3><div class="chips">${genreChips}</div>
    <div class="hint">Click to include, click again to exclude, third click clears.</div>
    <h3>Play with</h3><div class="chips">${INPUT_CHIPS.map(([k, l]) => chip("inputs", k, l, s.inputs.includes(k))).join("")}</div>
    <h3>Modes</h3><div class="chips">${MODE_CHIPS.map(([k, l]) => chip("modes", k, l, s.modes.includes(k))).join("")}</div>
    <h3>Release year</h3>
    <div class="row"><input class="num" type="number" min="1980" max="2100" placeholder="from" value="${esc(s.yearFrom)}" data-f="yearFrom" aria-label="Release year from"><span>–</span><input class="num" type="number" min="1980" max="2100" placeholder="to" value="${esc(s.yearTo)}" data-f="yearTo" aria-label="Release year to"></div>
    <div style="margin-top:18px"><button class="btn" data-act="reset">Reset filters</button></div>
   </aside>
   <section class="main">
    <div class="bar">
     <label class="row"><span style="color:#a1a1aa;font-size:13px">Sort</span>
      <select data-f="sort" aria-label="Sort by">${SORTS.map(([k, l]) => `<option value="${k}"${s.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
     <button class="btn" data-act="random" title="Open a random game from the current results">🎲 Surprise me</button>
     <span class="sp" style="flex:1"></span>
     <span class="count2" style="color:#a1a1aa;font-size:13px"></span>
    </div>
    <div class="res" tabindex="-1"></div>
   </section>
  </div>
  <div class="ft">
   <span class="note">Score = Metacritic 40% + Steam rating 35% + Microsoft Store rating 25% (missing sources are skipped). Data from ${esc(RAW.builtAt.slice(0, 10))} (${esc(RAW.market)}).</span>
   <span class="sp"></span>
   <a href="${DONATE_URL}" target="_blank" rel="noopener">© 2026 DukeCorp1996</a>
   <a class="don" href="${DONATE_URL}" target="_blank" rel="noopener">♥ Donate</a>
   <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
   <span>Alt+G toggles this panel</span>
  </div>
 </div>
</div>`;
    this.bind();
    this.refresh();
  },

  settingsHtml() {
    const st = settings;
    return `<div class="settings"><h3>Settings</h3>
    <label class="cb"><input type="checkbox" data-s="badges"${st.badges ? " checked" : ""}> Score badges on game tiles</label>
    <label class="cb"><input type="checkbox" data-s="genreLabels"${st.genreLabels ? " checked" : ""}> Genre + year on tiles</label>
    <label class="cb"><input type="checkbox" data-s="live"${st.live ? " checked" : ""}> Look up games newer than the bundled data</label>
    <div class="row" style="margin-top:6px"><label>Dim tiles below</label><input type="range" min="0" max="90" step="5" value="${st.dimBelow}" data-s="dimBelow"><span class="val" data-v="dimBelow">${st.dimBelow || "Off"}</span></div>
    <div class="hint">Dimming fades low-scoring games on the normal Xbox pages so the good ones stand out.</div>
    <hr style="border:0;border-top:1px solid #27272a;margin:14px 0 0"></div>`;
  },

  bind() {
    const r = this.root;
    const ov = r.querySelector(".ov");
    ov.addEventListener("mousedown", (e) => {
      if (e.target === ov) this.hide();
    });
    let qTimer;
    r.querySelector(".q").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        filters.q = e.target.value;
        this.saveFilters();
        this.refresh();
      }, 120);
    });
    r.querySelectorAll("[data-f]").forEach((el) => {
      const ev = el.type === "range" ? "input" : "change";
      el.addEventListener(ev, () => {
        const k = el.dataset.f;
        filters[k] = el.type === "checkbox" ? el.checked : el.type === "range" || k === "minConf" ? Number(el.value) : el.value;
        const v = r.querySelector(`[data-v="${k}"]`);
        if (v) v.textContent = filters[k] || "Any";
        this.saveFilters();
        this.refresh();
      });
    });
    r.querySelectorAll("[data-s]").forEach((el) => {
      const ev = el.type === "range" ? "input" : "change";
      el.addEventListener(ev, () => {
        const k = el.dataset.s;
        settings[k] = el.type === "checkbox" ? el.checked : Number(el.value);
        const v = r.querySelector(`[data-v="${k}"]`);
        if (v) v.textContent = settings[k] || "Off";
        store.set("settings", settings);
        scheduleScan(true);
        if (k === "tier") this.refresh();
      });
    });
    r.querySelector(".sd").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const { g, k } = b.dataset;
      if (g === "genre") {
        const cur = filters.genres[k] || 0;
        const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
        if (next) filters.genres[k] = next;
        else delete filters.genres[k];
        b.classList.toggle("on", next === 1);
        b.classList.toggle("ex", next === -1);
      } else {
        const arr = filters[g];
        const i = arr.indexOf(k);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(k);
        b.classList.toggle("on", i < 0);
      }
      this.saveFilters();
      this.refresh();
    });
    r.querySelectorAll("[data-act]").forEach((el) =>
      el.addEventListener("click", () => {
        const act = el.dataset.act;
        if (act === "close") this.hide();
        else if (act === "reset") {
          filters = JSON.parse(JSON.stringify(DEFAULT_FILTERS));
          this.saveFilters();
          this.render();
        } else if (act === "settings") {
          this.showSettings = !this.showSettings;
          this.render();
          r.querySelector(".bd")?.classList.add("showf");
        } else if (act === "filters") r.querySelector(".bd").classList.toggle("showf");
        else if (act === "random") {
          if (!this.results.length) return;
          const g = this.results[Math.floor(Math.random() * this.results.length)];
          this.hide();
          navigate(gamePath(g));
        }
      })
    );
    const res = r.querySelector(".res");
    res.addEventListener("click", (e) => {
      const a = e.target.closest("a.card");
      if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.hide();
      navigate(a.getAttribute("href"));
    });
  },

  filter() {
    const s = filters;
    const q = normSearch(s.q.trim());
    const terms = q ? q.split(/\s+/) : [];
    const inc = Object.keys(s.genres).filter((k) => s.genres[k] === 1);
    const exc = Object.keys(s.genres).filter((k) => s.genres[k] === -1);
    // Availability chips are OR-ed. "In my Game Pass" depends on the chosen tier, the rest are flags.
    const wantGamePass = s.avail.includes("gamePass");
    const availMask = s.avail.reduce((m, k) => (k === "gamePass" ? m : m | FLAG[k]), 0);
    const anyAvail = wantGamePass || !!availMask;
    const specialMask = s.special.reduce((m, k) => m | FLAG[k], 0);
    const inputMask = s.inputs.reduce((m, k) => m | INPUT[k], 0);
    const modeMask = s.modes.reduce((m, k) => m | MODE[k], 0);
    const yf = Number(s.yearFrom) || 0;
    const yt = Number(s.yearTo) || 0;
    const out = [];
    for (const g of BY_ID.values()) {
      if (terms.length && !terms.every((t) => g.hay.includes(t))) continue;
      if (anyAvail && !((wantGamePass && inMyGamePass(g)) || g.flags & availMask)) continue;
      if (specialMask && !(g.flags & specialMask)) continue;
      if (inputMask && (g.inputs & inputMask) !== inputMask) continue;
      if (modeMask && !(g.modes & modeMask)) continue;
      if (s.minScore && (g.score == null || g.score < s.minScore)) continue;
      if (s.minConf && g.conf < s.minConf) continue;
      if (s.hasMeta && !g.meta) continue;
      if (s.hasSteam && !g.steamTotal) continue;
      if (inc.length && !inc.some((x) => g.genres.includes(x))) continue;
      if (exc.length && exc.some((x) => g.genres.includes(x))) continue;
      if (yf && (!g.year || g.year < yf)) continue;
      if (yt && (!g.year || g.year > yt)) continue;
      out.push(g);
    }
    const num = (v) => (v == null ? -1 : v);
    const by = {
      score: (a, b) => num(b.score) - num(a.score) || b.conf - a.conf || b.votes - a.votes,
      meta: (a, b) => num(b.meta) - num(a.meta) || num(b.score) - num(a.score),
      steam: (a, b) => num(b.steamTotal ? steamScore(b.steamPos, b.steamTotal) : null) - num(a.steamTotal ? steamScore(a.steamPos, a.steamTotal) : null),
      store: (a, b) => num(b.storeCount ? storeScore(b.storeRating, b.storeCount) : null) - num(a.storeCount ? storeScore(a.storeRating, a.storeCount) : null),
      votes: (a, b) => b.votes - a.votes,
      popular: (a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9),
      newest: (a, b) => num(b.release) - num(a.release),
      oldest: (a, b) => (a.release ?? 1e9) - (b.release ?? 1e9),
      title: (a, b) => a.title.localeCompare(b.title),
    }[s.sort] || ((a, b) => num(b.score) - num(a.score));
    out.sort((a, b) => by(a, b) || a.title.localeCompare(b.title));
    return out;
  },

  // keep: re-filter but stay where the viewer is (same number of cards, same scroll position).
  refresh({ keep = false } = {}) {
    if (!this.open || !this.root) return;
    const prevRes = this.root.querySelector(".res");
    const keepShown = keep ? this.shown : 0;
    const keepTop = keep && prevRes ? prevRes.scrollTop : 0;
    this.results = this.filter();
    const total = BY_ID.size;
    const txt = `${this.results.length.toLocaleString()} of ${total.toLocaleString()} games`;
    const c = this.root.querySelector(".count");
    const c2 = this.root.querySelector(".count2");
    if (c) c.textContent = txt;
    if (c2) c2.textContent = txt;
    const res = this.root.querySelector(".res");
    res.innerHTML = "";
    res.scrollTop = 0;
    this.shown = 0;
    this.io?.disconnect();
    this.io = null;
    if (!this.results.length) {
      res.innerHTML = `<div class="empty">No games match these filters.</div>`;
      return;
    }
    do this.renderMore();
    while (this.shown < keepShown && this.shown < this.results.length);
    res.scrollTop = keepTop;
    this.io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) this.renderMore();
      },
      { root: res, rootMargin: "600px" }
    );
    const s = res.querySelector(".more");
    if (s) this.io.observe(s);
  },

  renderMore() {
    const res = this.root.querySelector(".res");
    const next = this.results.slice(this.shown, this.shown + 90);
    if (!next.length) return;
    this.shown += next.length;
    res.querySelector(".more")?.remove();
    res.insertAdjacentHTML("beforeend", next.map((g) => this.card(g)).join("") + (this.shown < this.results.length ? `<div class="more"></div>` : ""));
    const s = res.querySelector(".more");
    if (s && this.io) this.io.observe(s);
  },

  card(g) {
    const tags = [];
    if (g.tier) {
      const mine = inMyGamePass(g);
      const name = TIER_NAME[g.tier].toUpperCase();
      tags.push(`<span class="tag ${mine ? "gp" : "up"}" title="${esc(tierLabel(g))}${mine ? "" : ": not in your tier"}">${name}</span>`);
    }
    if (g.flags & FLAG.f2p) tags.push(`<span class="tag free">FREE</span>`);
    else if (g.flags & FLAG.ads) tags.push(`<span class="tag free">ADS</span>`);
    if (g.flags & FLAG.leaving) tags.push(`<span class="tag leave">LEAVING</span>`);
    if (g.flags & FLAG.recent) tags.push(`<span class="tag new">NEW</span>`);
    const subs = [];
    if (g.meta) subs.push(`<span title="Metacritic">MC ${g.meta}</span>`);
    if (g.steamTotal) subs.push(`<span title="Steam: ${g.steamPct}% positive of ${g.steamTotal.toLocaleString()} ratings">Steam ${g.steamPct}%</span>`);
    if (g.storeCount) subs.push(`<span title="Microsoft Store: ${g.storeCount.toLocaleString()} ratings">★${g.storeRating.toFixed(1)}</span>`);
    if (g.inputs & INPUT.touch) subs.push(`<span title="Touch controls">Touch</span>`);
    if (g.modes & (MODE.onlineCoop | MODE.localCoop)) subs.push(`<span>Co-op</span>`);
    const sub = [g.year, g.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
    const img = g.image ? `<img loading="lazy" decoding="async" alt="" src="${IMG_BASE}${esc(g.image)}?w=220&format=jpg">` : "";
    return `<a class="card" href="${esc(gamePath(g))}" title="${esc(tooltip(g))}">
<div class="art">${img}<span class="pill t${scoreTier(g.score)}${g.conf <= 1 && g.score != null ? " low" : ""}">${g.score ?? "–"}</span><div class="tags">${tags.join("")}</div></div>
<div class="info"><div class="t">${esc(g.title)}</div><div class="sub">${esc(sub)}</div><div class="sub">${esc(g.publisher)}</div><div class="subs">${subs.join("")}</div></div></a>`;
  },
};

// ---------------------------------------------------------------- launcher button, keyboard, routing

function ensureFab() {
  let fab = document.getElementById("xcs-fab");
  if (isStreaming()) {
    fab?.remove();
    return;
  }
  if (fab) return;
  fab = document.createElement("button");
  fab.id = "xcs-fab";
  fab.type = "button";
  fab.title = "Find good games (Alt+G)";
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg>Game Finder`;
  fab.addEventListener("click", () => panel.toggle());
  document.body.appendChild(fab);
}

document.addEventListener(
  "keydown",
  (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "g" || e.key === "G") && !isStreaming()) {
      e.preventDefault();
      panel.toggle();
    } else if (e.key === "Escape" && panel.open) {
      e.preventDefault();
      e.stopPropagation();
      panel.hide();
    }
  },
  true
);

let scanQueued = false;
let forceNext = false;
function scheduleScan(force) {
  forceNext = forceNext || !!force;
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    const f = forceNext;
    forceNext = false;
    ensureFab();
    scanTiles(f);
    decorateDetail();
  });
}

let lastPath = location.pathname;
function onRoute() {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  if (isStreaming()) {
    panel.hide();
    document.getElementById("xcs-fab")?.remove();
  }
  scheduleScan(true);
}

function start() {
  injectPageCss();
  const mo = new MutationObserver((muts) => {
    if (isStreaming()) return;
    for (const m of muts) {
      if (m.target.closest && m.target.closest("#xcs-root")) continue;
      scheduleScan(m.type === "attributes");
      return;
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  W.addEventListener("popstate", onRoute);
  setInterval(onRoute, 700);
  scheduleScan(true);
  console.info(`[xcs] Xbox Cloud Gaming Scores loaded: ${GAMES.length} games, data ${RAW.builtAt}`);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);
