// DOCS: https://codex.io/docs/API (Arkham Intelligence — API access via enterprise key)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type ArkhamEntity = {
  name?: string;
  type?: string;
  addresses?: Array<{
    address?: string;
    chain?: string;
  }>;
};

type ArkhamMeResponse = {
  email?: string;
  name?: string;
  role?: string;
};

function getBaseUrl(): string {
  return getOptionalEnv("ARKHAM_API_BASE_URL", "https://api.arkhamintelligence.com");
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getRequiredEnv("ARKHAM_API_KEY")}`,
  };
}

export function isArkhamConfigured(): boolean {
  return isConfigured(getOptionalEnv("ARKHAM_API_KEY"));
}

/** GET /api/v1/me – verify API key and return account info. */
export async function getMe(): Promise<ArkhamMeResponse> {
  return requestJson<ArkhamMeResponse>(`${getBaseUrl()}/api/v1/me`, {
    headers: getHeaders(),
  });
}
