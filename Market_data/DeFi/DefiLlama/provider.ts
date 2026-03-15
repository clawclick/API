// DOCS: https://defillama.com/docs/api

import { requestJson } from "#lib/http";

type DefiLlamaProtocol = {
  id?: string;
  name?: string;
  symbol?: string;
  chain?: string;
  tvl?: number;
  chainTvls?: Record<string, number>;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
};

/** GET /protocols – list all tracked DeFi protocols with TVL. No auth required. */
export async function getProtocols(): Promise<DefiLlamaProtocol[]> {
  return requestJson<DefiLlamaProtocol[]>("https://api.llama.fi/protocols");
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type DefiLlamaProtocolDetail = {
  id?: string;
  name?: string;
  symbol?: string;
  tvl?: Array<{ date?: number; totalLiquidityUSD?: number }>;
  chainTvls?: Record<string, { tvl?: Array<{ date?: number; totalLiquidityUSD?: number }> }>;
  currentChainTvls?: Record<string, number>;
  mcap?: number;
};

/** GET /protocol/{slug} – historical TVL and chain breakdown for a single protocol. */
export async function getProtocolTvl(slug: string): Promise<DefiLlamaProtocolDetail> {
  return requestJson<DefiLlamaProtocolDetail>(`https://api.llama.fi/protocol/${slug}`);
}

type DefiLlamaCoinPrice = {
  decimals?: number;
  price?: number;
  symbol?: string;
  timestamp?: number;
  confidence?: number;
};

type DefiLlamaPricesResponse = {
  coins?: Record<string, DefiLlamaCoinPrice>;
};

/** GET /prices/current/{coins} – current USD prices for tokens (format: "chain:address"). */
export async function getCurrentPrices(coins: string[]): Promise<DefiLlamaPricesResponse> {
  return requestJson<DefiLlamaPricesResponse>(
    `https://coins.llama.fi/prices/current/${coins.join(",")}`,
  );
}

type DefiLlamaChain = {
  gecko_id?: string | null;
  tvl?: number;
  tokenSymbol?: string;
  cmcId?: string;
  name?: string;
  chainId?: number;
};

/** GET /v2/chains – list all chains with their current TVL. */
export async function getChains(): Promise<DefiLlamaChain[]> {
  return requestJson<DefiLlamaChain[]>("https://api.llama.fi/v2/chains");
}
