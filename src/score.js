// Scoring helpers shared by the data build (Node) and the userscript (browser).
// The userscript build strips the `export` keywords and inlines this file.

export const SCORE_WEIGHTS = { meta: 0.4, steam: 0.35, store: 0.25 };

// Microsoft Store ratings are 1-5 stars and small samples are noisy, so a Bayesian average pulls
// low-vote games toward the catalog mean first.
export const STORE_PRIOR = 3.9;
export const STORE_PRIOR_VOTES = 30;
// Stars -> 0..100 on the same scale as the Steam score. Calibrated 2026-10-20 by percentile
// matching ~1,800 cloud games that have both (store 3.1 -> 63, 4.0 -> 82, 4.56 -> 93, 4.64 -> 94).
// Above 4.5 stars the Steam side flattens out, so the slope drops there too.
const STORE_SLOPE = 20;
const STORE_OFFSET = 1.5;
const STORE_KNEE = 4.5;
const STORE_TOP_SLOPE = 12.5;

function clamp100(x) {
  return Math.max(0, Math.min(100, x));
}

export function storeScore(avg, count) {
  if (!count || !avg) return null;
  const bayes = (STORE_PRIOR_VOTES * STORE_PRIOR + count * avg) / (STORE_PRIOR_VOTES + count);
  const low = Math.min(bayes, STORE_KNEE) * STORE_SLOPE + STORE_OFFSET;
  return clamp100(low + Math.max(0, bayes - STORE_KNEE) * STORE_TOP_SLOPE);
}

// SteamDB rating formula: shrinks the positive ratio toward 50% when there are few reviews.
export function steamScore(positive, total) {
  if (!total) return null;
  const ratio = positive / total;
  return clamp100((ratio - (ratio - 0.5) * Math.pow(2, -Math.log10(total + 1))) * 100);
}

// g = { meta, steamPos, steamTotal, storeAvg, storeCount }
export function computeScore(g) {
  const parts = [];
  if (g.meta) parts.push([g.meta, SCORE_WEIGHTS.meta]);
  const st = steamScore(g.steamPos, g.steamTotal);
  if (st != null) parts.push([st, SCORE_WEIGHTS.steam]);
  const ms = storeScore(g.storeAvg, g.storeCount);
  if (ms != null) parts.push([ms, SCORE_WEIGHTS.store]);
  if (!parts.length) return null;
  let sum = 0;
  let w = 0;
  for (const [v, wt] of parts) {
    sum += v * wt;
    w += wt;
  }
  return Math.round(sum / w);
}

// 3 = critic score plus a sizeable user sample, 2 = a decent user sample, 1 = thin data, 0 = nothing.
export function scoreConfidence(g) {
  const users = (g.steamTotal || 0) + (g.storeCount || 0);
  if (g.meta && users >= 200) return 3;
  if (g.meta || users >= 300) return 2;
  if (users > 0) return 1;
  return 0;
}
