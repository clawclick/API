// DOCS: https://docs.bubblemaps.io (API access via partnership/key)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type BubblemapsMapData = {
  token?: string;
  chain?: string;
  nodes?: Array<{
    address?: string;
    percentage?: number;
    is_contract?: boolean;
  }>;
};

function getBaseUrl(): string {
  return getOptionalEnv("BUBBLEMAPS_API_BASE_URL", "https://api.bubblemaps.io");
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: getRequiredEnv("BUBBLEMAPS_API_KEY"),
  };
}

export function isBubblemapsConfigured(): boolean {
  return isConfigured(getOptionalEnv("BUBBLEMAPS_API_KEY"));
}

/** GET /map-data?token={address}&chain={chain} – holder cluster map for a token. */
export async function getMapData(chain: string, tokenAddress: string): Promise<BubblemapsMapData> {
  return requestJson<BubblemapsMapData>(
    `${getBaseUrl()}/map-data?token=${tokenAddress}&chain=${chain}`,
    { headers: getHeaders() },
  );
}
