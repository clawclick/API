import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  codexHolders,
  isCodexConfigured,
  CODEX_NETWORK_IDS,
} from "#providers/market/codex";
import type { TokenHoldersQuery } from "#routes/helpers";
import type { TokenHoldersResponse, TokenHolderItem, ProviderStatus } from "#types/api";

/* ── 2-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: TokenHoldersResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000;

function getCacheKey(q: TokenHoldersQuery): string {
  return `${q.tokenAddress}:${q.network}:${q.cursor ?? ""}:${q.limit}`;
}

/* ── Service ─────────────────────────────────────────────── */

export async function getTokenHolders(q: TokenHoldersQuery): Promise<TokenHoldersResponse> {
  const cacheKey = getCacheKey(q);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];
  const networkId = CODEX_NETWORK_IDS[q.network.trim()] ?? Number(q.network.trim());

  const result = await runProvider(
    statuses,
    "codex:holders",
    isCodexConfigured() && !!networkId,
    () => codexHolders(q.tokenAddress, networkId, q.cursor, q.limit),
    networkId ? "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io" : `Unknown network: ${q.network}`,
  );

  const h = result?.data?.holders;
  const holders: TokenHolderItem[] = (h?.items ?? []).map((item) => ({
    address: item.address ?? null,
    balance: item.shiftedBalance ?? null,
    balanceUsd: item.balanceUsd ?? null,
    firstHeldTimestamp: item.firstHeldTimestamp ?? null,
  }));

  const response: TokenHoldersResponse = {
    endpoint: "tokenHolders",
    status: summarizeStatus(statuses),
    cached: false,
    tokenAddress: q.tokenAddress,
    network: q.network,
    holderCount: h?.count ?? null,
    top10HoldersPercent: h?.top10HoldersPercent ?? null,
    holders,
    providers: statuses,
  };

  if (statuses.some((s) => s.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
