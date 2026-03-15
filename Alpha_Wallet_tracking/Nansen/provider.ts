// DOCS: https://docs.nansen.ai/api/overview

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

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
