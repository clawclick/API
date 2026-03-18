import { getFilteredTokens } from "#services/filterTokens";
import { getDetailedTokenStats, getTokenPriceHistory } from "#services/liveEndpoints";
import type { FilteredToken, TokenPricePoint } from "#types/api";

export type VolatilityScannerQuery = {
  chain: string;
  minVolume: number;
  minSwingPct: number;
  duration: string;
  maxResults: number;
};

export type SwingCandidate = {
  address: string;
  name: string | null;
  symbol: string | null;
  priceUsd: string | null;
  liquidity: string | null;
  volume24h: string | null;
  change24h: string | null;
  support: number | null;
  resistance: number | null;
  swingPct: number | null;
  avgSwingPct: number | null;
  swingCount: number;
  currentPosition: number | null;
  buyVsSellRatio: number | null;
  volumeTrend: "rising" | "falling" | "flat";
  volumeChangePct: number;
  swingScore: number;
};

export type VolatilityScannerResponse = {
  endpoint: "volatilityScanner";
  chain: string;
  duration: string;
  count: number;
  cached: boolean;
  scanned: number;
  passedPreFilter: number;
  passedStats: number;
  candidates: SwingCandidate[];
};

const NETWORK_MAP: Record<string, string> = { eth: "eth", base: "base", bsc: "bsc", sol: "sol" };

/* ── 5-minute cache ──────────────────────────────────────── */
type CacheEntry = { data: VolatilityScannerResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(q: VolatilityScannerQuery): string {
  return `${q.chain}:${q.minVolume}:${q.minSwingPct}:${q.duration}:${q.maxResults}`;
}

export async function scanVolatility(q: VolatilityScannerQuery): Promise<VolatilityScannerResponse> {
  const key = cacheKey(q);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const chain = NETWORK_MAP[q.chain] ?? q.chain;

  // Step 1: Get high-volume tokens via filterTokens
  const filtered = await getFilteredTokens({
    network: chain,
    minVolume24: q.minVolume,
    sortBy: "volume24",
    sortDirection: "DESC",
    limit: 50,
  });

  // Step 2: Quick pre-filter — only tokens with noticeable price movement
  // change24h from Codex is a fraction (0.05 = 5%), convert minSwingPct to fraction
  const minChangeFraction = (q.minSwingPct / 100) * 0.3;
  const movers = filtered.tokens.filter((t) => {
    const absChange = Math.abs(Number(t.change24h) || 0);
    return absChange >= minChangeFraction && t.address;
  });

  // Step 3: Fetch detailedTokenStats AND price history in parallel for top movers (capped at 20)
  const batch = movers.slice(0, 20);

  // Pick interval/limit for price history based on duration param
  const { interval: phInterval, limit: phLimit } = durationToHistoryParams(q.duration);

  const [statsResults, historyResults] = await Promise.all([
    Promise.allSettled(
      batch.map((t) =>
        getDetailedTokenStats({
          chain,
          tokenAddress: t.address!,
          durations: q.duration,
          bucketCount: 12,
          statsType: "UNFILTERED",
        })
      )
    ),
    Promise.allSettled(
      batch.map((t) =>
        getTokenPriceHistory({
          chain,
          tokenAddress: t.address!,
          interval: phInterval,
          limit: phLimit,
        })
      )
    ),
  ]);

  // Step 4: Compute swing metrics
  const candidates: SwingCandidate[] = [];

  for (let i = 0; i < batch.length; i++) {
    const token = batch[i];
    const statsResult = statsResults[i];
    const historyResult = historyResults[i];
    if (statsResult.status !== "fulfilled") continue;

    const stats = statsResult.value;
    const points = historyResult.status === "fulfilled" ? historyResult.value.points : [];
    const candidate = buildCandidate(token, stats, points, q.minSwingPct);
    if (candidate) candidates.push(candidate);
  }

  // Step 5: Sort by swing score descending
  candidates.sort((a, b) => b.swingScore - a.swingScore);

  const result = candidates.slice(0, q.maxResults);

  const response: VolatilityScannerResponse = {
    endpoint: "volatilityScanner",
    chain,
    duration: q.duration,
    count: result.length,
    cached: false,
    scanned: filtered.tokens.length,
    passedPreFilter: movers.length,
    passedStats: candidates.length,
    candidates: result,
  };

  cache.set(key, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });

  return response;
}

// Map duration param to price history interval + limit
function durationToHistoryParams(duration: string): { interval: string; limit: string } {
  // duration is like "hour4,day1" — pick the first one for interval mapping
  const first = duration.split(",")[0].trim();
  switch (first) {
    case "min5":   return { interval: "5m",  limit: "1d" };
    case "hour1":  return { interval: "15m", limit: "7d" };
    case "hour4":  return { interval: "1h",  limit: "7d" };
    case "hour12": return { interval: "1h",  limit: "7d" };
    case "day1":   return { interval: "4h",  limit: "1m" };
    default:       return { interval: "1h",  limit: "7d" };
  }
}

function buildCandidate(
  token: FilteredToken,
  stats: Awaited<ReturnType<typeof getDetailedTokenStats>>,
  points: TokenPricePoint[],
  minSwingPct: number,
): SwingCandidate | null {
  // Pick the best available duration window (prefer hour4 > day1 > hour1)
  const window = stats.durations.hour4 ?? stats.durations.day1 ?? stats.durations.hour1;
  if (!window) return null;

  const highest = window.statsUsd.highest?.currentValue ?? null;
  const lowest = window.statsUsd.lowest?.currentValue ?? null;
  const close = window.statsUsd.close?.currentValue ?? null;

  let support = lowest;
  let resistance = highest;
  let currentPosition: number | null = null;

  if (support != null && resistance != null && support > 0 && close != null) {
    currentPosition = Math.max(0, Math.min(1, (close - support) / (resistance - support)));
  }

  // Detect swing cycles from price history (uses 3% zigzag threshold)
  const { swingCount, avgSwingPct, medianSwingPct } = detectSwings(points, minSwingPct);

  // swingPct = median swing size (the "typical" swing you'd actually trade)
  // Require at least 2 swings — a single move isn't a pattern
  const swingPct = medianSwingPct;
  if (swingPct == null || swingPct < minSwingPct || swingCount < 2) return null;

  // Buy vs sell ratio from transactions
  const buys = window.statsNonCurrency.buys?.currentValue ?? 0;
  const sells = window.statsNonCurrency.sells?.currentValue ?? 0;
  const buyVsSellRatio = sells > 0 ? Math.round((buys / sells) * 100) / 100 : null;

  // Volume trend from OHLCV candles — compare recent half vs older half
  const { trend: volumeTrend, changePct: volumeChangePct } = analyzeVolumeTrend(points);

  // Compute composite swing score (0-100)
  let score = 0;

  // Swing range quality (10-30% is ideal, penalize extremes)
  if (swingPct != null) {
    if (swingPct >= 10 && swingPct <= 40) score += 20;
    else if (swingPct > 40 && swingPct <= 80) score += 10;
    else if (swingPct > 5) score += 5;
  }

  // Swing count bonus — proven repeating pattern is the best signal
  if (swingCount >= 5) score += 25;
  else if (swingCount >= 3) score += 20;
  else score += 10; // swingCount >= 2 (minimum to reach here)

  // Volume bonus (more volume = better)
  const vol = Number(token.volume24h) || 0;
  if (vol > 1_000_000) score += 20;
  else if (vol > 500_000) score += 15;
  else if (vol > 100_000) score += 10;
  else score += 5;

  // Balanced buy/sell (closer to 1.0 is better for swing)
  if (buyVsSellRatio != null) {
    if (buyVsSellRatio >= 0.5 && buyVsSellRatio <= 2.0) score += 15;
    else if (buyVsSellRatio >= 0.3 && buyVsSellRatio <= 3.0) score += 8;
  }

  // Position bonus: near support is a buy opportunity
  if (currentPosition != null) {
    if (currentPosition < 0.3) score += 20; // near support
    else if (currentPosition > 0.7) score += 8; // near resistance (sell signal)
    else score += 12; // middle of range
  }

  return {
    address: token.address!,
    name: token.name,
    symbol: token.symbol,
    priceUsd: token.priceUsd,
    liquidity: token.liquidity,
    volume24h: token.volume24h,
    change24h: token.change24h,
    support,
    resistance,
    swingPct: swingPct != null ? Math.round(swingPct * 100) / 100 : null,
    avgSwingPct: avgSwingPct != null ? Math.round(avgSwingPct * 100) / 100 : null,
    swingCount,
    currentPosition: currentPosition != null ? Math.round(currentPosition * 1000) / 1000 : null,
    buyVsSellRatio,
    volumeTrend,
    volumeChangePct: Math.round(volumeChangePct * 100) / 100,
    swingScore: score,
  };
}

/**
 * Analyze OHLCV volume trend by comparing the average volume of the
 * recent third of candles vs the older two-thirds.
 * Returns trend direction and percentage change.
 */
function analyzeVolumeTrend(
  points: TokenPricePoint[],
): { trend: "rising" | "falling" | "flat"; changePct: number } {
  const vols = points.map((p) => p.volume ?? 0).filter((v) => v > 0);
  if (vols.length < 6) return { trend: "flat", changePct: 0 };

  const split = Math.floor(vols.length * 2 / 3);
  const olderAvg = vols.slice(0, split).reduce((a, b) => a + b, 0) / split;
  const recentAvg = vols.slice(split).reduce((a, b) => a + b, 0) / (vols.length - split);

  if (olderAvg === 0) return { trend: recentAvg > 0 ? "rising" : "flat", changePct: 0 };

  const changePct = ((recentAvg - olderAvg) / olderAvg) * 100;

  let trend: "rising" | "falling" | "flat";
  if (changePct > 15) trend = "rising";
  else if (changePct < -15) trend = "falling";
  else trend = "flat";

  return { trend, changePct };
}

/**
 * Detect swing cycles from OHLCV price history.
 * Uses a zigzag detector with a low fixed threshold (3%) to catch all meaningful
 * reversals, then reports the median and average swing sizes.
 * A "swing" is a peak-to-trough or trough-to-peak reversal.
 */
function detectSwings(
  points: TokenPricePoint[],
  _minSwingPct: number,
): { swingCount: number; avgSwingPct: number | null; medianSwingPct: number | null } {
  if (points.length < 5) return { swingCount: 0, avgSwingPct: null, medianSwingPct: null };

  const closes = points.map((p) => p.close ?? p.priceUsd);
  // Fixed 5% detection threshold — catches real reversals without noise
  const threshold = 0.05;

  // Zigzag: find alternating peaks and troughs
  type Pivot = { price: number; type: "high" | "low" };
  const pivots: Pivot[] = [];

  let currentHigh = closes[0];
  let currentLow = closes[0];
  let direction: "up" | "down" | null = null;

  for (let i = 1; i < closes.length; i++) {
    const price = closes[i];

    if (direction === null) {
      // Determining initial direction
      if (price >= currentLow * (1 + threshold)) {
        // First significant move is up — mark the low as first pivot
        pivots.push({ price: currentLow, type: "low" });
        direction = "up";
        currentHigh = price;
      } else if (price <= currentHigh * (1 - threshold)) {
        // First significant move is down — mark the high as first pivot
        pivots.push({ price: currentHigh, type: "high" });
        direction = "down";
        currentLow = price;
      } else {
        // Still within noise range
        if (price > currentHigh) currentHigh = price;
        if (price < currentLow) currentLow = price;
      }
    } else if (direction === "up") {
      if (price > currentHigh) {
        currentHigh = price;
      } else if (price <= currentHigh * (1 - threshold)) {
        // Reversal down — mark the high as a pivot
        pivots.push({ price: currentHigh, type: "high" });
        direction = "down";
        currentLow = price;
      }
    } else {
      // direction === "down"
      if (price < currentLow) {
        currentLow = price;
      } else if (price >= currentLow * (1 + threshold)) {
        // Reversal up — mark the low as a pivot
        pivots.push({ price: currentLow, type: "low" });
        direction = "up";
        currentHigh = price;
      }
    }
  }

  // Each pair of consecutive pivots = one swing
  if (pivots.length < 2) return { swingCount: 0, avgSwingPct: null, medianSwingPct: null };

  const swings: number[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const prev = pivots[i - 1].price;
    const curr = pivots[i].price;
    const pct = Math.abs(curr - prev) / Math.min(prev, curr) * 100;
    swings.push(pct);
  }

  const swingCount = swings.length;
  const avgSwingPct = swings.reduce((a, b) => a + b, 0) / swings.length;
  const sorted = [...swings].sort((a, b) => a - b);
  const medianSwingPct = sorted[Math.floor(sorted.length / 2)];

  return { swingCount, avgSwingPct, medianSwingPct };
}
