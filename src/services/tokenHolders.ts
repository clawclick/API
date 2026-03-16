import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  CODEX_NETWORK_IDS,
  codexTop10HoldersPercent,
  isCodexConfigured,
} from "#providers/market/codex";
import { getSimTokenHolders, isSimConfigured } from "#providers/defi/duneAnalytics";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
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
  const chain = normalizeChain(q.network);
  const networkId = CODEX_NETWORK_IDS[chain] ?? Number(q.network.trim());

  const result = await runProvider(
    statuses,
    "simDune:tokenHolders",
    isEvmChain(chain) && isSimConfigured() && !!networkId,
    () => getSimTokenHolders(networkId, q.tokenAddress, q.limit, q.cursor),
    !isEvmChain(chain)
      ? "tokenHolders via Sim is only supported on EVM chains."
      : networkId
        ? "SIM_API_KEY not configured."
        : `Unknown network: ${q.network}`,
  );

  const top10 = await runProvider(
    statuses,
    "codex:top10HoldersPercent",
    isEvmChain(chain) && isCodexConfigured() && !!networkId,
    () => codexTop10HoldersPercent(q.tokenAddress, networkId),
    !isEvmChain(chain)
      ? "top10HoldersPercent via Codex is only supported on EVM chains in this endpoint."
      : networkId
        ? "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io"
        : `Unknown network: ${q.network}`,
  );

  const holders: TokenHolderItem[] = (result?.holders ?? []).map((item) => ({
    address: item.wallet_address ?? null,
    balance: item.balance ?? null,
    balanceUsd: null,
    firstHeldTimestamp: item.first_acquired ? Math.floor(Date.parse(item.first_acquired) / 1000) : null,
    firstAcquired: item.first_acquired ?? null,
    hasInitiatedTransfer: item.has_initiated_transfer ?? null,
  }));

  const response: TokenHoldersResponse = {
    endpoint: "tokenHolders",
    status: summarizeStatus(statuses),
    cached: false,
    tokenAddress: q.tokenAddress,
    network: chain,
    holderCount: null,
    top10HoldersPercent: top10?.data?.top10HoldersPercent ?? null,
    nextOffset: result?.next_offset ?? null,
    holders,
    providers: statuses,
  };

  if (statuses.some((s) => s.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
