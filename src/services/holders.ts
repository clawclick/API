import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

import { getRequiredEnv } from "#config/env";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import { getTokenHolderStats as getMoralisTokenHolderStats, getTokenOwners as getMoralisTokenOwners, isMoralisConfigured } from "#providers/walletTracking/moralis";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
import type { HoldersQuery } from "#routes/helpers";
import type { HoldersResponse, HolderListItem, ProviderStatus } from "#types/api";

type CacheEntry = { data: HoldersResponse; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000;

let solConnection: Connection | null = null;

function getSolConnection(): Connection {
  if (!solConnection) {
    solConnection = new Connection(getRequiredEnv("SOL_RPC_URL"), "confirmed");
  }
  return solConnection;
}

function getCacheKey(query: HoldersQuery): string {
  return `${query.chain}:${query.tokenAddress}:${query.limit}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = decimals > 0 ? padded.slice(0, -decimals) : padded;
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function percentOfSupply(balance: bigint, totalSupply: bigint): number | null {
  if (totalSupply <= 0n) return null;
  return Number((balance * 1_000_000n) / totalSupply) / 10_000;
}

async function getSolanaTopHolders(tokenAddress: string, limit: number): Promise<{ holders: HolderListItem[]; holderCount: number; totalSupplyRaw: string | null; totalSupplyFormatted: string | null; }> {
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

  const holders = [...balancesByOwner.entries()]
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .slice(0, limit)
    .map(([address, balance]) => ({
      address,
      label: null,
      entity: null,
      isContract: null,
      balance: balance.toString(),
      balanceFormatted: formatTokenAmount(balance, decimals),
      percentOfSupply: percentOfSupply(balance, totalSupply),
    }));

  return {
    holders,
    holderCount: balancesByOwner.size,
    totalSupplyRaw: totalSupply.toString(),
    totalSupplyFormatted: formatTokenAmount(totalSupply, decimals),
  };
}

export async function getHolders(query: HoldersQuery): Promise<HoldersResponse> {
  const cacheKey = getCacheKey(query);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  let holders: HolderListItem[] = [];
  let holderCount: number | null = null;
  let totalSupplyRaw: string | null = null;
  let totalSupplyFormatted: string | null = null;

  if (isEvmChain(chain)) {
    const [owners, holderStats] = await Promise.all([
      runProvider(
        providers,
        "moralisOwners",
        isMoralisConfigured(),
        () => getMoralisTokenOwners(query.tokenAddress, chain, query.limit),
        "Moralis API key not configured.",
      ),
      runProvider(
        providers,
        "moralisHolderStats",
        isMoralisConfigured(),
        () => getMoralisTokenHolderStats(query.tokenAddress, chain),
        "Moralis API key not configured.",
      ),
    ]);

    holders = (owners?.result ?? []).flatMap((owner) => {
      if (!owner.owner_address) {
        return [];
      }

      return [{
        address: owner.owner_address,
        label: owner.owner_address_label ?? null,
        entity: owner.entity ?? null,
        isContract: owner.is_contract ?? null,
        balance: owner.balance ?? null,
        balanceFormatted: owner.balance_formatted ?? null,
        percentOfSupply: owner.percentage_relative_to_total_supply ?? null,
      }];
    });

    holderCount = holderStats?.totalHolders ?? null;
    totalSupplyRaw = owners?.total_supply ?? null;
    totalSupplyFormatted = owners?.total_supply ?? null;
  } else {
    const solana = await runProvider(
      providers,
      "solRpc:holders",
      true,
      () => getSolanaTopHolders(query.tokenAddress, query.limit),
    );

    holders = solana?.holders ?? [];
    holderCount = solana?.holderCount ?? null;
    totalSupplyRaw = solana?.totalSupplyRaw ?? null;
    totalSupplyFormatted = solana?.totalSupplyFormatted ?? null;
  }

  const response: HoldersResponse = {
    endpoint: "holders",
    status: summarizeStatus(providers),
    cached: false,
    chain,
    tokenAddress: query.tokenAddress,
    limit: query.limit,
    holderCount,
    totalSupplyRaw,
    totalSupplyFormatted,
    holders,
    providers,
  };

  if (providers.some((provider) => provider.status === "ok")) {
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}