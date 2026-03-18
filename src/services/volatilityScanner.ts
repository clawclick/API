import { getFilteredTokens } from "#services/filterTokens";
import { getDetailedTokenStats } from "#services/liveEndpoints";
import type { FilteredToken } from "#types/api";

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
  currentPosition: number | null;
  buyVsSellRatio: number | null;
  swingScore: number;
};

export type VolatilityScannerResponse = {
  endpoint: "volatilityScanner";
  chain: string;
  duration: string;
  count: number;
  scanned: number;
  passedPreFilter: number;
  passedStats: number;
  candidates: SwingCandidate[];
};

const NETWORK_MAP: Record<string, string> = { eth: "eth", base: "base", bsc: "bsc", sol: "sol" };

export async function scanVolatility(q: VolatilityScannerQuery): Promise<VolatilityScannerResponse> {
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

  // Step 3: Fetch detailedTokenStats in parallel for top movers (capped at 20)
  const batch = movers.slice(0, 20);
  const statsResults = await Promise.allSettled(
    batch.map((t) =>
      getDetailedTokenStats({
        chain,
        tokenAddress: t.address!,
        durations: q.duration,
        bucketCount: 12,
        statsType: "UNFILTERED",
      })
    )
  );

  // Step 4: Compute swing metrics
  const candidates: SwingCandidate[] = [];

  for (let i = 0; i < batch.length; i++) {
    const token = batch[i];
    const statsResult = statsResults[i];
    if (statsResult.status !== "fulfilled") continue;

    const stats = statsResult.value;
    const candidate = buildCandidate(token, stats, q.minSwingPct);
    if (candidate) candidates.push(candidate);
  }

  // Step 5: Sort by swing score descending
  candidates.sort((a, b) => b.swingScore - a.swingScore);

  const result = candidates.slice(0, q.maxResults);

  return {
    endpoint: "volatilityScanner",
    chain,
    duration: q.duration,
    count: result.length,
    scanned: filtered.tokens.length,
    passedPreFilter: movers.length,
    passedStats: candidates.length,
    candidates: result,
  };
}

function buildCandidate(
  token: FilteredToken,
  stats: Awaited<ReturnType<typeof getDetailedTokenStats>>,
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
  let swingPct: number | null = null;
  let currentPosition: number | null = null;

  if (support != null && resistance != null && support > 0) {
    swingPct = ((resistance - support) / support) * 100;
    if (swingPct < minSwingPct) return null;
    if (close != null) {
      currentPosition = Math.max(0, Math.min(1, (close - support) / (resistance - support)));
    }
  }

  // Buy vs sell ratio from transactions
  const buys = window.statsNonCurrency.buys?.currentValue ?? 0;
  const sells = window.statsNonCurrency.sells?.currentValue ?? 0;
  const buyVsSellRatio = sells > 0 ? Math.round((buys / sells) * 100) / 100 : null;

  // Compute composite swing score (0-100)
  let score = 0;

  // Swing range quality (10-30% is ideal, penalize extremes)
  if (swingPct != null) {
    if (swingPct >= 10 && swingPct <= 40) score += 30;
    else if (swingPct > 40 && swingPct <= 80) score += 15;
    else if (swingPct > 5) score += 10;
  }

  // Volume bonus (more volume = better)
  const vol = Number(token.volume24h) || 0;
  if (vol > 1_000_000) score += 25;
  else if (vol > 500_000) score += 20;
  else if (vol > 100_000) score += 15;
  else score += 5;

  // Balanced buy/sell (closer to 1.0 is better for swing)
  if (buyVsSellRatio != null) {
    if (buyVsSellRatio >= 0.5 && buyVsSellRatio <= 2.0) score += 20;
    else if (buyVsSellRatio >= 0.3 && buyVsSellRatio <= 3.0) score += 10;
  }

  // Position bonus: near support is a buy opportunity
  if (currentPosition != null) {
    if (currentPosition < 0.3) score += 25; // near support
    else if (currentPosition > 0.7) score += 10; // near resistance (sell signal)
    else score += 15; // middle of range
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
    currentPosition: currentPosition != null ? Math.round(currentPosition * 1000) / 1000 : null,
    buyVsSellRatio,
    swingScore: score,
  };
}
