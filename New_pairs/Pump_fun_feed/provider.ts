// DOCS: https://docs.pump.fun (Pump.fun public API)

import { requestJson } from "#lib/http";

type PumpFunCoin = {
  mint?: string;
  name?: string;
  symbol?: string;
  description?: string;
  image_uri?: string;
  market_cap?: number;
  usd_market_cap?: number;
  created_timestamp?: number;
  reply_count?: number;
};

/** GET /coins/currently-live – currently live coins on Pump.fun. No auth required. */
export async function getCurrentlyLive(): Promise<PumpFunCoin[]> {
  return requestJson<PumpFunCoin[]>(
    "https://frontend-api.pump.fun/coins/currently-live",
  );
}
