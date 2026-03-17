import { requestJson } from "#lib/http";
import { toDexScreenerChain, type SupportedChain } from "#providers/shared/chains";

export type DexPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  pairCreatedAt?: number;
  labels?: string[];
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceUsd?: string;
  volume?: {
    h24?: number;
  };
  liquidity?: {
    usd?: number;
  };
  fdv?: number;
  marketCap?: number;
  priceChange?: {
    h24?: number;
  };
};

export async function getTokenPairs(chain: SupportedChain, tokenAddress: string): Promise<DexPair[]> {
  const dexChain = toDexScreenerChain(chain);
  if (!dexChain) {
    return [];
  }

  return requestJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/${dexChain}/${tokenAddress}`);
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type DexSearchResponse = {
  pairs?: DexPair[];
};

/** GET /latest/dex/search?q={query} – search pairs by token name, symbol, or address. */
export async function searchPairs(query: string): Promise<DexPair[]> {
  const res = await requestJson<DexSearchResponse>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  return res.pairs ?? [];
}

/** GET /latest/dex/pairs/{chainId}/{pairAddress} – get pair data by chain + pair address. */
export async function getPairByAddress(chain: SupportedChain, pairAddress: string): Promise<DexPair | null> {
  const dexChain = toDexScreenerChain(chain);
  if (!dexChain) return null;

  const res = await requestJson<{ pairs?: DexPair[] }>(
    `https://api.dexscreener.com/latest/dex/pairs/${dexChain}/${pairAddress}`,
  );
  return res.pairs?.[0] ?? null;
}

type DexBoost = {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  description?: string;
  totalAmount?: number;
};

/** GET /token-boosts/latest/v1 – latest boosted tokens (promoted on DexScreener). */
export async function getLatestBoosts(): Promise<DexBoost[]> {
  return requestJson<DexBoost[]>("https://api.dexscreener.com/token-boosts/latest/v1");
}