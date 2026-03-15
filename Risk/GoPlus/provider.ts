import { getOptionalEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import { toEvmChainId, type SupportedChain } from "#providers/shared/chains";

type GoPlusTokenSecurity = {
  buy_tax?: string;
  sell_tax?: string;
  cannot_buy?: string;
  cannot_sell_all?: string;
  holder_count?: string;
  total_supply?: string;
  is_proxy?: string;
  is_mintable?: string;
  is_honeypot?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  is_open_source?: string;
  is_in_dex?: string;
  is_anti_whale?: string;
  can_take_back_ownership?: string;
  owner_change_balance?: string;
  hidden_owner?: string;
  selfdestruct?: string;
  external_call?: string;
  personal_slippage_modifiable?: string;
  trading_cooldown?: string;
  transfer_pausable?: string;
  lp_holder_count?: string;
  lp_total_supply?: string;
  creator_address?: string;
  owner_address?: string;
  creator_percent?: string;
  owner_percent?: string;
  owner_balance?: string;
  token_name?: string;
  token_symbol?: string;
  note?: string;
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