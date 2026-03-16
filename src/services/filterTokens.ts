import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  filterTokens,
  isCodexConfigured,
  CODEX_NETWORK_IDS,
  type CodexTokenFilters,
  type CodexRanking,
  type CodexFilterTokensResponse,
  type CodexStatsType,
} from "#providers/market/codex";
import type { FilterTokensQuery } from "#routes/helpers";
import type { FilterTokensResponse, FilteredToken, ProviderStatus } from "#types/api";

/* ── 5-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: FilterTokensResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(q: FilterTokensQuery): string {
  return JSON.stringify({
    network: q.network,
    phrase: q.phrase,
    minLiquidity: q.minLiquidity,
    minVolume24: q.minVolume24,
    minMarketCap: q.minMarketCap,
    maxMarketCap: q.maxMarketCap,
    minHolders: q.minHolders,
    minWalletAgeAvg: q.minWalletAgeAvg,
    sortBy: q.sortBy,
    sortDirection: q.sortDirection,
    limit: q.limit,
    offset: q.offset,
    includeScams: q.includeScams,
    launchpadName: q.launchpadName,
    launchpadCompleted: q.launchpadCompleted,
    statsType: q.statsType,
  });
}

/* ── Service ─────────────────────────────────────────────── */

export async function getFilteredTokens(q: FilterTokensQuery): Promise<FilterTokensResponse> {
  const cacheKey = getCacheKey(q);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];

  // Build Codex filters from query params
  const filters: CodexTokenFilters = {};

  if (q.network) {
    const ids = q.network.split(",").map((n) => CODEX_NETWORK_IDS[n.trim()] ?? Number(n.trim())).filter(Boolean);
    if (ids.length === 1) {
      filters.network = ids[0];
    } else if (ids.length > 1) {
      filters.network = ids;
    }
  }

  if (q.minLiquidity != null) filters.liquidity = { gt: q.minLiquidity };
  if (q.minVolume24 != null) filters.volume24 = { gt: q.minVolume24 };
  if (q.minHolders != null) filters.holders = { gt: q.minHolders };
  if (q.minMarketCap != null || q.maxMarketCap != null) {
    filters.circulatingMarketCap = {};
    if (q.minMarketCap != null) filters.circulatingMarketCap.gt = q.minMarketCap;
    if (q.maxMarketCap != null) filters.circulatingMarketCap.lt = q.maxMarketCap;
  }
  if (q.includeScams != null) filters.includeScams = q.includeScams;
  if (q.launchpadName) {
    filters.launchpadName = q.launchpadName.split(",").map((s) => s.trim());
  }
  if (q.launchpadCompleted != null) filters.launchpadCompleted = q.launchpadCompleted;
  if (q.minWalletAgeAvg != null) filters.walletAgeAvg = { gt: q.minWalletAgeAvg };

  const rankings: CodexRanking[] | undefined = q.sortBy
    ? [{ attribute: q.sortBy, direction: q.sortDirection ?? "DESC" }]
    : [{ attribute: "trendingScore24", direction: "DESC" }];

  const result = await runProvider(
    statuses,
    "codex:filterTokens",
    isCodexConfigured(),
    () => filterTokens(filters, rankings, q.limit, q.offset, q.phrase, q.statsType as CodexStatsType | undefined),
    "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io",
  );

  const tokens: FilteredToken[] = (result?.data?.filterTokens?.results ?? []).map((r) => ({
    address: r.token?.info?.address ?? null,
    name: r.token?.info?.name ?? null,
    symbol: r.token?.info?.symbol ?? null,
    imageUrl: r.token?.info?.imageThumbUrl ?? null,
    description: r.token?.info?.description ?? null,
    totalSupply: r.token?.info?.totalSupply ?? null,
    circulatingSupply: r.token?.info?.circulatingSupply ?? null,
    createdAt: r.createdAt ?? r.token?.createdAt ?? null,
    creatorAddress: r.token?.creatorAddress ?? null,
    priceUsd: r.priceUSD ?? null,
    liquidity: r.liquidity ?? null,
    marketCap: r.circulatingMarketCap ?? null,
    volume24h: r.volume24 ?? null,
    buyVolume24h: r.buyVolume24 ?? null,
    sellVolume24h: r.sellVolume24 ?? null,
    change24h: r.change24 ?? null,
    change1h: r.change1 ?? null,
    change5m: r.change5m ?? null,
    txnCount24h: r.txnCount24 ?? null,
    buyCount24h: r.buyCount24 ?? null,
    sellCount24h: r.sellCount24 ?? null,
    holders: r.holders ?? null,
    walletAgeAvg: r.walletAgeAvg ?? null,
    sniperCount: r.sniperCount ?? null,
    sniperHeldPct: r.sniperHeldPercentage ?? null,
    bundlerCount: r.bundlerCount ?? null,
    bundlerHeldPct: r.bundlerHeldPercentage ?? null,
    insiderCount: r.insiderCount ?? null,
    insiderHeldPct: r.insiderHeldPercentage ?? null,
    devHeldPct: r.devHeldPercentage ?? null,
    top10HoldersPct: r.top10HoldersPercent ?? null,
    launchpad: r.token?.launchpad ? {
      name: r.token.launchpad.launchpadName ?? null,
      protocol: r.token.launchpad.launchpadProtocol ?? null,
      completed: r.token.launchpad.completed ?? null,
      migrated: r.token.launchpad.migrated ?? null,
      migratedAt: r.token.launchpad.migratedAt ?? null,
      poolAddress: r.token.launchpad.poolAddress ?? null,
      migratedPoolAddress: r.token.launchpad.migratedPoolAddress ?? null,
      graduationPercent: r.token.launchpad.graduationPercent ?? null,
    } : null,
    socialLinks: r.token?.socialLinks ? {
      twitter: r.token.socialLinks.twitter ?? null,
      telegram: r.token.socialLinks.telegram ?? null,
      discord: r.token.socialLinks.discord ?? null,
      website: r.token.socialLinks.website ?? null,
    } : null,
    pairAddress: r.pair?.address ?? null,
  }));

  const response: FilterTokensResponse = {
    endpoint: "filterTokens",
    status: summarizeStatus(statuses),
    cached: false,
    count: result?.data?.filterTokens?.count ?? tokens.length,
    page: result?.data?.filterTokens?.page ?? 0,
    tokens,
    providers: statuses,
  };

  // Only cache successful results
  if (statuses.some((s) => s.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
