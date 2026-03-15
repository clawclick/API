// DOCS: https://lunarcrush.com/developers/api/endpoints

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type LunarCrushCoin = {
  id?: number;
  symbol?: string;
  name?: string;
  price?: number;
  market_cap?: number;
  galaxy_score?: number;
  alt_rank?: number;
  social_volume?: number;
  social_score?: number;
};

type LunarCrushListResponse = {
  data?: LunarCrushCoin[];
};

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getRequiredEnv("LUNARCRUSH_API_KEY")}`,
  };
}

export function isLunarCrushConfigured(): boolean {
  return isConfigured(getOptionalEnv("LUNARCRUSH_API_KEY"));
}

/** GET /public/coins/list/v1 – ranked list of coins with social metrics. */
export async function getCoinsList(limit = 50): Promise<LunarCrushListResponse> {
  return requestJson<LunarCrushListResponse>(
    `https://lunarcrush.com/api4/public/coins/list/v1?limit=${limit}`,
    { headers: getHeaders() },
  );
}
