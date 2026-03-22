import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  codexFilterTokenWallets,
  isCodexConfigured,
  CODEX_NETWORK_IDS,
  type CodexWalletTimeFrame,
} from "#providers/market/codex";
import type { TokenWalletsQuery } from "#routes/helpers";
import type { TokenWalletsResponse, TokenWalletItem, ProviderStatus } from "#types/api";

/* ── 30-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: TokenWalletsResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(q: TokenWalletsQuery): string {
  return JSON.stringify(q);
}

/* ── Service ─────────────────────────────────────────────── */

export async function getTokenWallets(q: TokenWalletsQuery): Promise<TokenWalletsResponse> {
  const cacheKey = getCacheKey(q);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];
  const networkId = CODEX_NETWORK_IDS[q.network.trim()] ?? Number(q.network.trim());

  const result = await runProvider(
    statuses,
    "codex:filterTokenWallets",
    isCodexConfigured() && !!networkId,
    () => codexFilterTokenWallets(q.tokenAddress, networkId, q.sortBy, q.sortDirection, q.limit, q.offset, q.timeFrame as CodexWalletTimeFrame),
    networkId ? "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io" : `Unknown network: ${q.network}`,
  );

  const wallets: TokenWalletItem[] = (result?.data?.filterTokenWallets?.results ?? []).map((r) => ({
    address: r.address ?? null,
    tokenAddress: r.tokenAddress ?? null,
    networkId: r.networkId ?? null,
    tokenName: r.token?.name ?? null,
    tokenSymbol: r.token?.symbol ?? null,
    lastTransactionAt: r.lastTransactionAt ?? null,
    tokenBalance: r.tokenBalance ?? null,
    tokenBalanceLive: r.tokenBalanceLive ?? null,
    tokenBalanceLiveUsd: r.tokenBalanceLiveUsd ?? null,
    realizedProfitUsd: r.realizedProfitUsd ?? null,
    realizedProfitPct: r.realizedProfitPercentage ?? null,
    buys: r.buys ?? null,
    sells: r.sells ?? null,
    amountBoughtUsd: r.amountBoughtUsd ?? null,
    amountSoldUsd: r.amountSoldUsd ?? null,
  }));

  const response: TokenWalletsResponse = {
    endpoint: "tokenWallets",
    status: summarizeStatus(statuses),
    cached: false,
    timeFrame: q.timeFrame,
    tokenAddress: q.tokenAddress,
    network: q.network,
    count: result?.data?.filterTokenWallets?.count ?? wallets.length,
    wallets,
    providers: statuses,
  };

  if (statuses.some((s) => s.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
