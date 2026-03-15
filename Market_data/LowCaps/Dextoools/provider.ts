// DOCS: https://developer.dextools.io/products/http-api/documentation

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type DexToolsToken = {
  address?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  creationBlock?: number;
};

type DexToolsTokenResponse = {
  statusCode?: number;
  data?: DexToolsToken;
};

function getHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "X-API-Key": getRequiredEnv("DEXTOOLS_API_KEY"),
  };
}

export function isDexToolsConfigured(): boolean {
  return isConfigured(getOptionalEnv("DEXTOOLS_API_KEY"));
}

/** GET /v2/token/{chain}/{address} – get token info. */
export async function getTokenInfo(chain: string, tokenAddress: string): Promise<DexToolsTokenResponse> {
  return requestJson<DexToolsTokenResponse>(
    `https://public-api.dextools.io/standard/v2/token/${chain}/${tokenAddress}`,
    { headers: getHeaders() },
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type DexToolsTokenPrice = {
  price?: number;
  priceChain?: number;
  price5m?: number;
  price1h?: number;
  price6h?: number;
  price24h?: number;
  variation5m?: number;
  variation1h?: number;
  variation6h?: number;
  variation24h?: number;
};

type DexToolsTokenPriceResponse = {
  statusCode?: number;
  data?: DexToolsTokenPrice;
};

/** GET /v2/token/{chain}/{address}/price – latest price with short-term change %. */
export async function getTokenPrice(chain: string, tokenAddress: string): Promise<DexToolsTokenPriceResponse> {
  return requestJson<DexToolsTokenPriceResponse>(
    `https://public-api.dextools.io/standard/v2/token/${chain}/${tokenAddress}/price`,
    { headers: getHeaders() },
  );
}

type DexToolsPool = {
  address?: string;
  name?: string;
  exchange?: { name?: string; factory?: string };
  mainToken?: { address?: string; name?: string; symbol?: string };
  sideToken?: { address?: string; name?: string; symbol?: string };
  price?: number;
  volume24h?: number;
  liquidity?: number;
  creationTime?: string;
};

type DexToolsPoolsResponse = {
  statusCode?: number;
  data?: { results?: DexToolsPool[] };
};

/** GET /v2/token/{chain}/{address}/pools – list liquidity pools for a token. */
export async function getTokenPools(chain: string, tokenAddress: string, sort = "volume24h", order = "desc"): Promise<DexToolsPoolsResponse> {
  return requestJson<DexToolsPoolsResponse>(
    `https://public-api.dextools.io/standard/v2/token/${chain}/${tokenAddress}/pools?sort=${sort}&order=${order}`,
    { headers: getHeaders() },
  );
}

type DexToolsHotPair = {
  address?: string;
  mainToken?: { address?: string; name?: string; symbol?: string };
  price?: number;
  volume24h?: number;
  liquidity?: number;
};

type DexToolsHotPairsResponse = {
  statusCode?: number;
  data?: DexToolsHotPair[];
};

/** GET /v2/ranking/{chain}/hotpools – trending/hot pools on a given chain. */
export async function getHotPools(chain: string): Promise<DexToolsHotPairsResponse> {
  return requestJson<DexToolsHotPairsResponse>(
    `https://public-api.dextools.io/standard/v2/ranking/${chain}/hotpools`,
    { headers: getHeaders() },
  );
}
