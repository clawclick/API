import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type BirdeyeOverviewResponse = {
  success?: boolean;
  data?: {
    address?: string;
    name?: string;
    symbol?: string;
    price?: number;
    marketCap?: number;
    fdv?: number;
    liquidity?: number;
    v24hUSD?: number;
    priceChange24hPercent?: number;
    extensions?: {
      coingeckoId?: string;
      website?: string;
    };
  };
};

type BirdeyeHistoryResponse = {
  success?: boolean;
  data?: {
    items?: Array<{
      unixTime?: number;
      value?: number;
    }>;
  };
};

function getHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "x-chain": "solana",
    "X-API-KEY": getRequiredEnv("BIRDEYE_API_KEY")
  };
}

export function isBirdeyeConfigured(): boolean {
  return isConfigured(getOptionalEnv("BIRDEYE_API_KEY"));
}

export async function getTokenOverview(tokenAddress: string): Promise<BirdeyeOverviewResponse> {
  return requestJson<BirdeyeOverviewResponse>(
    `https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`,
    { headers: getHeaders() }
  );
}

export async function getTokenHistory(tokenAddress: string, type: string): Promise<BirdeyeHistoryResponse> {
  return requestJson<BirdeyeHistoryResponse>(
    `https://public-api.birdeye.so/defi/history_price?address=${tokenAddress}&address_type=token&type=${type}`,
    { headers: getHeaders() }
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type BirdeyeOhlcvItem = {
  unixTime?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
};

type BirdeyeOhlcvResponse = {
  success?: boolean;
  data?: { items?: BirdeyeOhlcvItem[] };
};

/** GET /defi/ohlcv – OHLCV candlestick data for a token. type: "1m"|"5m"|"15m"|"1H"|"4H"|"1D" */
export async function getOhlcv(tokenAddress: string, type = "1H", timeFrom?: number, timeTo?: number): Promise<BirdeyeOhlcvResponse> {
  let url = `https://public-api.birdeye.so/defi/ohlcv?address=${tokenAddress}&type=${type}`;
  if (timeFrom) url += `&time_from=${timeFrom}`;
  if (timeTo) url += `&time_to=${timeTo}`;
  return requestJson<BirdeyeOhlcvResponse>(url, { headers: getHeaders() });
}

type BirdeyeSecurityData = {
  ownerAddress?: string;
  creatorAddress?: string;
  creationTx?: string;
  top10HolderPercent?: number;
  top10UserPercent?: number;
  isTrueToken?: boolean;
  isToken2022?: boolean;
  totalSupply?: number;
  mutableMetadata?: boolean | null;
  freezeAuthority?: string | null;
  mintAuthority?: string | null;
};

type BirdeyeSecurityResponse = {
  success?: boolean;
  data?: BirdeyeSecurityData;
};

/** GET /defi/token_security – security audit data (top holder %, freeze/mint authority, etc.). */
export async function getTokenSecurity(tokenAddress: string): Promise<BirdeyeSecurityResponse> {
  return requestJson<BirdeyeSecurityResponse>(
    `https://public-api.birdeye.so/defi/token_security?address=${tokenAddress}`,
    { headers: getHeaders() },
  );
}

type BirdeyeTopTrader = {
  owner?: string;
  tradeCount?: number;
  volume?: number;
  buy?: number;
  sell?: number;
};

type BirdeyeTopTradersResponse = {
  success?: boolean;
  data?: { items?: BirdeyeTopTrader[] };
};

/** GET /defi/v3/token/top-traders – top traders for a given token by volume. */
export async function getTopTraders(tokenAddress: string, timeFrame = "24h", sortType = "volume"): Promise<BirdeyeTopTradersResponse> {
  return requestJson<BirdeyeTopTradersResponse>(
    `https://public-api.birdeye.so/defi/v3/token/top-traders?address=${tokenAddress}&time_frame=${timeFrame}&sort_type=${sortType}`,
    { headers: getHeaders() },
  );
}