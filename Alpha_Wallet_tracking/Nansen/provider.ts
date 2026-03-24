// DOCS: https://docs.nansen.ai/api/overview

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type NansenPaginationRequest = {
  page?: number;
  per_page?: number;
};

type NansenTimeframe = "5m" | "10m" | "1h" | "6h" | "24h" | "7d" | "30d";

type NansenSortDirection = "ASC" | "DESC";

type NansenPaginationResponse = {
  page?: number;
  per_page?: number;
  is_last_page?: boolean;
};

export type NansenDateRange = {
  from: string;
  to: string;
};

type NansenSortOrder = {
  field?: string;
  direction?: NansenSortDirection;
};

type NansenLabel = {
  address?: string;
  blockchain?: string;
  label?: string;
  label_type?: string;
  label_subtype?: string;
};

type NansenLabelsResponse = {
  labels?: NansenLabel[];
  total?: number;
};

function getBaseUrl(): string {
  return getOptionalEnv("NANSEN_API_BASE_URL", "https://api.nansen.ai");
}

function getHeaders(): Record<string, string> {
  return {
    apiKey: getRequiredEnv("NANSEN_API_KEY"),
  };
}

async function postNansen<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return requestJson<T>(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function isNansenConfigured(): boolean {
  return isConfigured(getOptionalEnv("NANSEN_API_KEY"));
}

/** GET /api/v1/labels?address={address} – get smart-money labels for an address. */
export async function getLabels(address: string): Promise<NansenLabelsResponse> {
  return requestJson<NansenLabelsResponse>(
    `${getBaseUrl()}/api/v1/labels?address=${address}`,
    { headers: getHeaders() },
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type NansenSmartMoneyHolding = {
  token_address?: string;
  token_name?: string;
  token_symbol?: string;
  value_usd?: number;
  balance?: string;
  net_flow_24h_usd?: number;
  balance_24h_percent_change?: number;
  smart_money_label?: string;
};

type NansenSmartMoneyHoldingsResponse = {
  data?: NansenSmartMoneyHolding[];
  total?: number;
};

/** POST /api/v1/smart-money/holdings – smart money token holdings with net-flow data. */
export async function getSmartMoneyHoldings(
  chains: string[] = ["ethereum"],
  filters?: { include_smart_money_labels?: string[]; value_usd?: { min?: number } },
  orderField = "value_usd",
  page = 1,
  perPage = 100,
): Promise<NansenSmartMoneyHoldingsResponse> {
  return requestJson<NansenSmartMoneyHoldingsResponse>(
    `${getBaseUrl()}/api/v1/smart-money/holdings`,
    {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        chains,
        filters: filters ?? {},
        pagination: { page, per_page: perPage },
        order_by: [{ field: orderField, direction: "DESC" }],
      }),
    },
  );
}

type NansenDexTrade = {
  tx_hash?: string;
  block_timestamp?: string;
  trader_address?: string;
  token_bought_symbol?: string;
  token_sold_symbol?: string;
  amount_bought_usd?: number;
  amount_sold_usd?: number;
  smart_money_label?: string;
  dex?: string;
};

type NansenDexTradesResponse = {
  data?: NansenDexTrade[];
  total?: number;
};

/** POST /api/v1/smart-money/dex-trades – recent DEX trades by smart money wallets. */
export async function getSmartMoneyDexTrades(
  chains: string[] = ["ethereum"],
  filters?: { include_smart_money_labels?: string[] },
  page = 1,
  perPage = 100,
): Promise<NansenDexTradesResponse> {
  return requestJson<NansenDexTradesResponse>(
    `${getBaseUrl()}/api/v1/smart-money/dex-trades`,
    {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        chains,
        filters: filters ?? {},
        pagination: { page, per_page: perPage },
        order_by: [{ field: "block_timestamp", direction: "DESC" }],
      }),
    },
  );
}

type NansenSearchResult = {
  address?: string;
  name?: string;
  symbol?: string;
  type?: string;
  blockchain?: string;
  labels?: string[];
};

type NansenSearchResponse = {
  data?: NansenSearchResult[];
  total?: number;
};

/** POST /api/v1/search/general – search for tokens, wallets, or entities by name/symbol/address. */
export async function searchGeneral(query: string): Promise<NansenSearchResponse> {
  return requestJson<NansenSearchResponse>(
    `${getBaseUrl()}/api/v1/search/general`,
    {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
}

export type NansenTokenScreenerRequest = {
  chains: string[];
  timeframe?: NansenTimeframe;
  date?: {
    from: string;
    to: string;
  };
  pagination?: NansenPaginationRequest;
  filters?: Record<string, unknown>;
  order_by?: NansenSortOrder[];
};

export type NansenTokenScreenerRow = {
  chain?: string;
  token_address?: string;
  token_symbol?: string;
  token_age_days?: number;
  market_cap_usd?: number;
  liquidity?: number;
  price_usd?: number;
  price_change?: number;
  fdv?: number;
  fdv_mc_ratio?: number;
  buy_volume?: number;
  inflow_fdv_ratio?: number;
  outflow_fdv_ratio?: number;
  sell_volume?: number;
  volume?: number;
  netflow?: number;
};

export type NansenTokenScreenerResponse = {
  data?: NansenTokenScreenerRow[];
  pagination?: NansenPaginationResponse;
};

export async function getTokenScreener(body: NansenTokenScreenerRequest): Promise<NansenTokenScreenerResponse> {
  return postNansen<NansenTokenScreenerResponse>("/api/v1/token-screener", body as Record<string, unknown>);
}

export type NansenAddressRelatedWalletsRequest = {
  address: string;
  chain: string;
  pagination?: NansenPaginationRequest;
  order_by?: NansenSortOrder[];
};

export type NansenAddressRelatedWalletRow = {
  address?: string;
  address_label?: string;
  relation?: string;
  transaction_hash?: string;
  block_timestamp?: string;
  order?: number;
  chain?: string;
};

export type NansenAddressRelatedWalletsResponse = {
  data?: NansenAddressRelatedWalletRow[];
  pagination?: NansenPaginationResponse;
};

export async function getAddressRelatedWallets(
  body: NansenAddressRelatedWalletsRequest,
): Promise<NansenAddressRelatedWalletsResponse> {
  return postNansen<NansenAddressRelatedWalletsResponse>("/api/v1/profiler/address/related-wallets", body as Record<string, unknown>);
}

export type NansenAddressPnlSummaryRequest = {
  address?: string;
  entity_name?: string;
  chain: string;
  date: NansenDateRange;
};

export type NansenAddressPnlSummaryTopToken = {
  realized_pnl?: number;
  realized_roi?: number;
  token_address?: string;
  token_symbol?: string;
  chain?: string;
};

export type NansenAddressPnlSummaryResponse = {
  pagination?: NansenPaginationResponse;
  top5_tokens?: NansenAddressPnlSummaryTopToken[];
  traded_token_count?: number;
  traded_times?: number;
  realized_pnl_usd?: number;
  realized_pnl_percent?: number;
  win_rate?: number;
};

export async function getAddressPnlSummary(
  body: NansenAddressPnlSummaryRequest,
): Promise<NansenAddressPnlSummaryResponse> {
  return postNansen<NansenAddressPnlSummaryResponse>("/api/v1/profiler/address/pnl-summary", body as Record<string, unknown>);
}

export type NansenAddressPnlRequest = {
  address?: string;
  entity_name?: string;
  chain: string;
  date?: NansenDateRange;
  filters?: Record<string, unknown>;
  pagination?: NansenPaginationRequest;
  order_by?: NansenSortOrder[];
};

export type NansenAddressPnlRow = {
  token_address?: string;
  token_symbol?: string;
  token_name?: string;
  chain?: string;
  realized_pnl?: number;
  realized_roi?: number;
  unrealized_pnl?: number;
  unrealized_roi?: number;
  pnl_usd_realised?: number;
  pnl_usd_unrealised?: number;
  pnl_percent_realised?: number;
  pnl_percent_unrealised?: number;
  average_buy_price?: number;
  average_sell_price?: number;
  amount_bought?: number;
  amount_sold?: number;
  amount_held?: number;
  cost_basis?: number;
  last_trade_at?: string;
};

export type NansenAddressPnlResponse = {
  data?: NansenAddressPnlRow[];
  pagination?: NansenPaginationResponse;
};

export async function getAddressPnl(
  body: NansenAddressPnlRequest,
): Promise<NansenAddressPnlResponse> {
  return postNansen<NansenAddressPnlResponse>("/api/v1/profiler/address/pnl", body as Record<string, unknown>);
}

export type NansenJupiterDcasRequest = {
  token_address: string;
  pagination?: NansenPaginationRequest;
  filters?: Record<string, unknown>;
};

export type NansenJupiterDcaRow = {
  since_timestamp?: string;
  last_timestamp?: string;
  trader_address?: string;
  creation_hash?: string;
  trader_label?: string;
  dca_vault_address?: string;
  input_mint_address?: string;
  output_mint_address?: string;
  deposit_amount?: number;
  deposit_spent?: number;
  other_token_redeemed?: number;
  status?: string;
  token_input?: string;
  token_output?: string;
  deposit_usd_value?: number;
};

export type NansenJupiterDcasResponse = {
  data?: NansenJupiterDcaRow[];
  pagination?: NansenPaginationResponse;
};

export async function getJupiterDcas(body: NansenJupiterDcasRequest): Promise<NansenJupiterDcasResponse> {
  return postNansen<NansenJupiterDcasResponse>("/api/v1/tgm/jup-dca", body as Record<string, unknown>);
}

export type NansenSmartMoneyNetflowRequest = {
  chains: string[];
  filters?: Record<string, unknown>;
  premium_labels?: boolean;
  pagination?: NansenPaginationRequest;
  order_by?: NansenSortOrder[];
};

export type NansenSmartMoneyNetflowRow = {
  token_address?: string;
  token_symbol?: string;
  net_flow_1h_usd?: number;
  net_flow_24h_usd?: number;
  net_flow_7d_usd?: number;
  net_flow_30d_usd?: number;
  chain?: string;
  token_sectors?: string[];
  trader_count?: number;
  token_age_days?: number;
  market_cap_usd?: number;
};

export type NansenSmartMoneyNetflowResponse = {
  data?: NansenSmartMoneyNetflowRow[];
  pagination?: NansenPaginationResponse;
};

export async function getSmartMoneyNetflow(
  body: NansenSmartMoneyNetflowRequest,
): Promise<NansenSmartMoneyNetflowResponse> {
  return postNansen<NansenSmartMoneyNetflowResponse>("/api/v1/smart-money/netflow", body as Record<string, unknown>);
}
