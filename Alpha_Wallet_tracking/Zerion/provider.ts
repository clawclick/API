// DOCS: https://developers.zerion.io/reference/getwalletpnl
// Auth: Basic Authentication (API key + colon, base64 encoded)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

/* ── Types ────────────────────────────────────────────────── */

export type ZerionPnlAttributes = {
  total_gain?: number;
  realized_gain?: number;
  unrealized_gain?: number;
  relative_total_gain_percentage?: number;
  relative_realized_gain_percentage?: number;
  relative_unrealized_gain_percentage?: number;
  total_fee?: number;
  total_invested?: number;
  realized_cost_basis?: number;
  received_external?: number;
  sent_external?: number;
  sent_for_nfts?: number;
  received_for_nfts?: number;
  changes_absolute?: number;
  changes_percent?: number;
  realized_absolute?: number;
  unrealized_absolute?: number;
  net_invested?: number;
};

export type ZerionPnlResponse = {
  data?: {
    type?: string;
    id?: string;
    attributes?: ZerionPnlAttributes;
  };
};

export type ZerionWalletChartResponse = {
  data?: unknown;
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/* ── Helpers ──────────────────────────────────────────────── */

export function isZerionConfigured(): boolean {
  return isConfigured(getOptionalEnv("ZERION_API_KEY"));
}

function getAuthHeader(): Record<string, string> {
  const apiKey = getRequiredEnv("ZERION_API_KEY");
  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  return {
    accept: "application/json",
    Authorization: `Basic ${encoded}`,
  };
}

/* ── Chain ID mapping ────────────────────────────────────── */

const ZERION_CHAIN_IDS: Record<string, string> = {
  eth: "ethereum",
  base: "base",
  bsc: "binance-smart-chain",
  sol: "solana",
};

/* ── Wallet PnL ──────────────────────────────────────────── */

export async function getWalletPnl(
  walletAddress: string,
  chain?: string,
  currency = "usd",
): Promise<ZerionPnlResponse> {
  const params = new URLSearchParams({ currency });

  if (chain) {
    const zerionChain = ZERION_CHAIN_IDS[chain];
    if (zerionChain) {
      params.set("filter[chain_ids]", zerionChain);
    }
  }

  return requestJson<ZerionPnlResponse>(
    `https://api.zerion.io/v1/wallets/${encodeURIComponent(walletAddress)}/pnl?${params.toString()}`,
    { headers: getAuthHeader() },
  );
}

export function getZerionChainId(chain: string): string | null {
  return ZERION_CHAIN_IDS[chain] ?? null;
}

export async function getWalletChart(walletAddress: string, chainIds?: string[]): Promise<ZerionWalletChartResponse> {
  const params = new URLSearchParams({
    currency: "usd",
  });

  if (chainIds?.length) {
    params.set("filter[chain_ids]", chainIds.join(","));
  }

  return requestJson<ZerionWalletChartResponse>(
    `https://api.zerion.io/v1/wallets/${encodeURIComponent(walletAddress)}/charts/max?${params.toString()}`,
    { headers: getAuthHeader() },
  );
}
