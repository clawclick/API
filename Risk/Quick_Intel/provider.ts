// DOCS: https://docs.quickintel.io

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type QuickIntelResult = {
  is_honeypot?: boolean;
  buy_tax?: number;
  sell_tax?: number;
  is_proxy?: boolean;
  is_mintable?: boolean;
  is_blacklisted?: boolean;
  owner_address?: string;
  creator_address?: string;
};

function getBaseUrl(): string {
  return getOptionalEnv("QUICKINTEL_API_BASE_URL", "https://api.quickintel.io");
}

function getHeaders(): Record<string, string> {
  return {
    "x-api-key": getRequiredEnv("QUICKINTEL_API_KEY"),
  };
}

export function isQuickIntelConfigured(): boolean {
  return isConfigured(getOptionalEnv("QUICKINTEL_API_KEY"));
}

/** GET /v1/getquicki?chain={chain}&address={address} – quick contract intelligence report. */
export async function getQuickI(chain: string, tokenAddress: string): Promise<QuickIntelResult> {
  return requestJson<QuickIntelResult>(
    `${getBaseUrl()}/v1/getquicki?chain=${chain}&address=${tokenAddress}`,
    { headers: getHeaders() },
  );
}
