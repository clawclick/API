// DOCS: https://coinmarketcap.com/api/documentation/v1/

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type CmcMapEntry = {
  id?: number;
  name?: string;
  symbol?: string;
  slug?: string;
  platform?: {
    id?: number;
    name?: string;
    symbol?: string;
    token_address?: string;
  } | null;
};

type CmcMapResponse = {
  status?: { error_code?: number; error_message?: string | null };
  data?: CmcMapEntry[];
};

function getHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "X-CMC_PRO_API_KEY": getRequiredEnv("CMC_API_KEY"),
  };
}

export function isCmcConfigured(): boolean {
  return isConfigured(getOptionalEnv("CMC_API_KEY"));
}

/** GET /v1/cryptocurrency/map – list all active cryptocurrencies (paginated). */
export async function getCryptoMap(limit = 100): Promise<CmcMapResponse> {
  return requestJson<CmcMapResponse>(
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?limit=${limit}`,
    { headers: getHeaders() },
  );
}
