import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  codexFilterWallets,
  isCodexConfigured,
  CODEX_NETWORK_IDS,
  type CodexWalletFilters,
  type CodexWalletTimeFrame,
} from "#providers/market/codex";
import type { FilterWalletsQuery } from "#routes/helpers";
import type { FilterWalletsResponse, FilteredWallet, ProviderStatus } from "#types/api";

/* ── 30-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: FilterWalletsResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(q: FilterWalletsQuery): string {
  return JSON.stringify(q);
}

/* ── Service ─────────────────────────────────────────────── */

export async function getFilteredWallets(q: FilterWalletsQuery): Promise<FilterWalletsResponse> {
  const cacheKey = getCacheKey(q);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];

  const filters: CodexWalletFilters = {};
  if (q.network) {
    const id = CODEX_NETWORK_IDS[q.network.trim()] ?? Number(q.network.trim());
    if (id) filters.networkId = id;
  }
  if (q.minPnl != null) filters.realizedProfitUsd = { gte: q.minPnl };
  if (q.minWinRate != null) filters.winRate = { gte: q.minWinRate };
  if (q.minSwaps != null) filters.swaps = { gte: q.minSwaps };
  if (q.minVolume != null) filters.volumeUsd = { gte: q.minVolume };
  if (q.labels) filters.includeLabels = q.labels.split(",").map((s) => s.trim());
  if (q.excludeLabels) filters.excludeLabels = q.excludeLabels.split(",").map((s) => s.trim());

  const result = await runProvider(
    statuses,
    "codex:filterWallets",
    isCodexConfigured(),
    () => codexFilterWallets(filters, q.sortBy, q.sortDirection, q.limit, q.offset, q.timeFrame as CodexWalletTimeFrame),
    "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io",
  );

  const wallets: FilteredWallet[] = (result?.data?.filterWallets?.results ?? []).map((r) => ({
    address: r.address ?? null,
    labels: r.labels ?? [],
    lastTransactionAt: r.lastTransactionAt ?? null,
    firstTransactionAt: r.firstTransactionAt ?? null,
    volumeUsd: r.volumeUsd ?? null,
    realizedProfitUsd: r.realizedProfitUsd ?? null,
    realizedProfitPct: r.realizedProfitPercentage ?? null,
    winRate: r.winRate ?? null,
    swaps: r.swaps ?? null,
    uniqueTokens: r.uniqueTokens ?? null,
  }));

  const response: FilterWalletsResponse = {
    endpoint: "filterWallets",
    status: summarizeStatus(statuses),
    cached: false,
    timeFrame: q.timeFrame,
    count: result?.data?.filterWallets?.count ?? wallets.length,
    wallets,
    providers: statuses,
  };

  if (statuses.some((s) => s.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
