import { requestJson } from "#lib/http";
import { toGeckoTerminalNetwork, type SupportedChain } from "#providers/shared/chains";

type GeckoTerminalTokenResponse = {
  data?: {
    attributes?: {
      address?: string;
      name?: string;
      symbol?: string;
      image_url?: string;
      price_usd?: string;
      market_cap_usd?: string;
      fdv_usd?: string;
      total_reserve_in_usd?: string;
      volume_usd?: {
        h24?: string;
      };
    };
  };
};

export async function getToken(chain: SupportedChain, tokenAddress: string): Promise<GeckoTerminalTokenResponse | null> {
  const network = toGeckoTerminalNetwork(chain);
  if (!network) {
    return null;
  }

  return requestJson<GeckoTerminalTokenResponse>(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}`);
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type GeckoTerminalPoolAttributes = {
  address?: string;
  name?: string;
  base_token_price_usd?: string;
  quote_token_price_usd?: string;
  reserve_in_usd?: string;
  pool_created_at?: string;
  fdv_usd?: string;
  market_cap_usd?: string;
  price_change_percentage?: { h1?: string; h24?: string };
  volume_usd?: { h24?: string };
  transactions?: {
    h24?: { buys?: number; sells?: number };
  };
};

type GeckoTerminalPoolResponse = {
  data?: { attributes?: GeckoTerminalPoolAttributes };
};

/** GET /networks/{network}/pools/{address} – detailed pool info (reserve, volume, txns). */
export async function getPool(chain: SupportedChain, poolAddress: string): Promise<GeckoTerminalPoolResponse | null> {
  const network = toGeckoTerminalNetwork(chain);
  if (!network) return null;
  return requestJson<GeckoTerminalPoolResponse>(
    `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}`,
  );
}

type GeckoTerminalPoolsResponse = {
  data?: Array<{ id?: string; attributes?: GeckoTerminalPoolAttributes }>;
};

/** GET /networks/{network}/tokens/{address}/pools – top pools for a given token, sorted by volume. */
export async function getTopPools(chain: SupportedChain, tokenAddress: string): Promise<GeckoTerminalPoolsResponse | null> {
  const network = toGeckoTerminalNetwork(chain);
  if (!network) return null;
  return requestJson<GeckoTerminalPoolsResponse>(
    `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}/pools?sort=h24_volume_usd_liquidity_desc`,
  );
}

type GeckoTerminalOhlcvItem = {
  dt?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
};

type GeckoTerminalOhlcvResponse = {
  data?: {
    attributes?: {
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
};

/** GET /networks/{network}/pools/{address}/ohlcv/{timeframe} – OHLCV candles for a pool. timeframe: "day"|"hour"|"minute" */
export async function getOhlcv(chain: SupportedChain, poolAddress: string, timeframe = "hour", aggregate = 1, limit = 100): Promise<GeckoTerminalOhlcvResponse | null> {
  const network = toGeckoTerminalNetwork(chain);
  if (!network) return null;
  return requestJson<GeckoTerminalOhlcvResponse>(
    `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
  );
}