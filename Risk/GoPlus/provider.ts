import { getOptionalEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import { toEvmChainId, type SupportedChain } from "#providers/shared/chains";

type GoPlusTokenSecurity = {
  buy_tax?: string;
  cannot_buy?: string;
  cannot_sell_all?: string;
  holder_count?: string;
  is_proxy?: string;
  is_mintable?: string;
};

type GoPlusResponse = {
  code?: number;
  message?: string;
  result?: Record<string, GoPlusTokenSecurity>;
};

export async function getTokenSecurity(chain: SupportedChain, tokenAddress: string): Promise<GoPlusTokenSecurity | null> {
  const chainId = toEvmChainId(chain);
  if (!chainId) {
    return null;
  }

  const accessToken = getOptionalEnv("GOPLUS_ACCESS_TOKEN");
  const response = await requestJson<GoPlusResponse>(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`,
    {
      headers: isConfigured(accessToken)
        ? {
            Authorization: `Bearer ${accessToken}`
          }
        : undefined
    }
  );

  return response.result?.[tokenAddress.toLowerCase()] ?? null;
}