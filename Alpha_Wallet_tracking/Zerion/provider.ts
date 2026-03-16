// DOCS: https://developers.zerion.io/reference/getwalletpnl
// Auth: Basic Authentication (API key + colon, base64 encoded)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

/* ── Types ────────────────────────────────────────────────── */

export type ZerionPnlAttributes = {
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
