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

type BirdeyeHolderDistributionHolder = {
  wallet?: string;
  holding?: string;
  percent_of_supply?: number;
};

type BirdeyeHolderDistributionResponse = {
  success?: boolean;
  data?: {
    token_address?: string;
    mode?: string;
    summary?: {
      wallet_count?: number;
      total_holding?: string;
      percent_of_supply?: number;
    };
    holders?: BirdeyeHolderDistributionHolder[];
  };
};

/** GET /holder/v1/distribution – top holder concentration or supply-range distribution for Solana tokens. */
export async function getHolderDistribution(tokenAddress: string, topN = 10): Promise<BirdeyeHolderDistributionResponse> {
  const limit = Math.min(Math.max(topN, 1), 50);
  return requestJson<BirdeyeHolderDistributionResponse>(
    `https://public-api.birdeye.so/holder/v1/distribution?token_address=${tokenAddress}&address_type=wallet&mode=top&top_n=${topN}&include_list=true&offset=0&limit=${limit}`,
    { headers: getHeaders() },
  );
}

type BirdeyeWalletCurrentNetWorthItem = {
  address?: string;
  decimals?: number;
  price?: number;
  balance?: string;
  amount?: number;
  network?: string;
  name?: string;
  symbol?: string;
  logo_uri?: string;
  value?: string;
};

type BirdeyeWalletCurrentNetWorthResponse = {
  success?: boolean;
  data?: {
    wallet?: string;
    currency?: string;
    total_value?: string;
    current_timestamp?: string;
    items?: BirdeyeWalletCurrentNetWorthItem[];
  };
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
  };
};

type BirdeyeWalletPnlSummaryResponse = {
  success?: boolean;
  data?: {
    summary?: {
      unique_tokens?: number;
      counts?: {
        total_buy?: number;
        total_sell?: number;
        total_trade?: number;
        total_win?: number;
        total_loss?: number;
        win_rate?: number;
      };
      cashflow_usd?: {
        total_invested?: number;
        total_sold?: number;
      };
      pnl?: {
        realized_profit_usd?: number;
        realized_profit_percent?: number;
        unrealized_usd?: number;
        total_usd?: number;
        avg_profit_per_trade_usd?: number;
      };
    };
  };
};

type BirdeyeWalletTxItem = {
  txHash?: string;
  blockTime?: string;
  mainAction?: string;
  fee?: number;
};

type BirdeyeWalletTxListResponse = {
  success?: boolean;
  data?: {
    solana?: BirdeyeWalletTxItem[];
  };
};

export async function getWalletCurrentNetWorth(walletAddress: string, limit = 20): Promise<BirdeyeWalletCurrentNetWorthResponse> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return requestJson<BirdeyeWalletCurrentNetWorthResponse>(
    `https://public-api.birdeye.so/wallet/v2/current-net-worth?wallet=${walletAddress}&sort_by=value&sort_type=desc&limit=${safeLimit}&offset=0`,
    { headers: getHeaders() },
  );
}

export async function getWalletPnlSummary(walletAddress: string, duration = "30d"): Promise<BirdeyeWalletPnlSummaryResponse> {
  return requestJson<BirdeyeWalletPnlSummaryResponse>(
    `https://public-api.birdeye.so/wallet/v2/pnl/summary?wallet=${walletAddress}&duration=${duration}`,
    { headers: getHeaders() },
  );
}

export async function getWalletTxList(walletAddress: string, limit = 20): Promise<BirdeyeWalletTxListResponse> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return requestJson<BirdeyeWalletTxListResponse>(
    `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${walletAddress}&limit=${safeLimit}&ui_amount_mode=scaled`,
    { headers: getHeaders() },
  );
}