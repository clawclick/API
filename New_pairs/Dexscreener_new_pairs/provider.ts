// DOCS: https://docs.dexscreener.com/api/reference

import { requestJson } from "#lib/http";

type NewPairProfile = {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: Array<{ label?: string; url?: string }>;
};

/** GET /token-profiles/latest/v1 – latest token profiles (new listings). No auth required. */
export async function getLatestTokenProfiles(): Promise<NewPairProfile[]> {
  return requestJson<NewPairProfile[]>(
    "https://api.dexscreener.com/token-profiles/latest/v1",
  );
}
