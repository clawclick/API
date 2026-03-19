import { runProvider, summarizeStatus } from "#lib/runProvider";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  CODEX_NETWORK_IDS,
  codexTop10HoldersPercent,
  isCodexConfigured,
} from "#providers/market/codex";
import { getRequiredEnv } from "#config/env";
import { getSimTokenHolders, isSimConfigured } from "#providers/defi/duneAnalytics";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
import type { TokenHoldersQuery } from "#routes/helpers";
import type { TokenHoldersResponse, TokenHolderItem, ProviderStatus } from "#types/api";

/* ── 2-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: TokenHoldersResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000;
let solConnection: Connection | null = null;

function getCacheKey(q: TokenHoldersQuery): string {
  return `${q.tokenAddress}:${q.network}:${q.cursor ?? ""}:${q.limit}`;
}

function getSolConnection(): Connection {
  if (!solConnection) {
    solConnection = new Connection(getRequiredEnv("SOL_RPC_URL"), "confirmed");
  }
  return solConnection;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = decimals > 0 ? padded.slice(0, -decimals) : padded;
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

async function getSolanaTokenHolders(tokenAddress: string, limit: number): Promise<{ holderCount: number; top10HoldersPercent: number | null; holders: TokenHolderItem[]; }> {
  const connection = getSolConnection();
  const mint = new PublicKey(tokenAddress);
  const mintInfo = await connection.getParsedAccountInfo(mint, "confirmed");
  const mintData = mintInfo.value?.data;
  if (!mintData || !("parsed" in mintData)) {
    throw new Error(`Unable to load parsed mint data for ${tokenAddress}.`);
  }

  const supplyRaw = String((mintData.parsed as { info?: { supply?: string } }).info?.supply ?? "0");
  const decimals = Number((mintData.parsed as { info?: { decimals?: number } }).info?.decimals ?? 0);
  const totalSupply = BigInt(supplyRaw);

  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: mint.toBase58() } },
    ],
  });

  const balancesByOwner = new Map<string, bigint>();
  for (const account of accounts) {
    const data = account.account.data;
    if (!("parsed" in data)) {
      continue;
    }

    const parsed = data.parsed as {
      info?: {
        owner?: string;
        tokenAmount?: { amount?: string };
      };
    };

    const owner = parsed.info?.owner;
    const amountRaw = parsed.info?.tokenAmount?.amount;
    if (!owner || !amountRaw) {
      continue;
    }

    const amount = BigInt(amountRaw);
    if (amount <= 0n) {
      continue;
    }

    balancesByOwner.set(owner, (balancesByOwner.get(owner) ?? 0n) + amount);
  }

  const sorted = [...balancesByOwner.entries()]
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1));

  const top10HoldersPercent = totalSupply > 0n
    ? Number(sorted.slice(0, 10).reduce((sum, [, balance]) => sum + ((balance * 1_000_000n) / totalSupply), 0n)) / 10_000
    : null;

  const holders: TokenHolderItem[] = sorted.slice(0, limit).map(([address, balance]) => ({
    address,
    balance: formatTokenAmount(balance, decimals),
    balanceUsd: null,
    firstHeldTimestamp: null,
    firstAcquired: null,
    hasInitiatedTransfer: null,
  }));

  return {
    holderCount: balancesByOwner.size,
    top10HoldersPercent,
    holders,
  };
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

  if (chain === "sol") {
    const result = await runProvider(
      statuses,
      "solRpc:tokenHolders",
      true,
      () => getSolanaTokenHolders(q.tokenAddress, q.limit),
    );

    const response: TokenHoldersResponse = {
      endpoint: "tokenHolders",
      status: summarizeStatus(statuses),
      cached: false,
      tokenAddress: q.tokenAddress,
      network: chain,
      holderCount: result?.holderCount ?? null,
      top10HoldersPercent: result?.top10HoldersPercent ?? null,
      nextOffset: null,
      holders: result?.holders ?? [],
      providers: statuses,
    };

    if (statuses.some((s) => s.status === "ok")) {
      cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return response;
  }

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
