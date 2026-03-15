import { requestJson } from "#lib/http";
import { toEvmChainId, type SupportedChain } from "#providers/shared/chains";

type HoneypotResponse = {
  summary?: {
    risk?: string;
    riskLevel?: number;
    flags?: Array<{
      flag?: string;
      description?: string;
    }>;
  };
  honeypotResult?: {
    isHoneypot?: boolean;
    honeypotReason?: string;
  };
  simulationResult?: {
    buyTax?: number;
    sellTax?: number;
    transferTax?: number;
    buyGas?: string;
    sellGas?: string;
  };
  contractCode?: {
    openSource?: boolean;
    hasProxyCalls?: boolean;
  };
  token?: {
    totalHolders?: number;
  };
  holderAnalysis?: {
    holders?: string;
    successful?: string;
    failed?: string;
    siphoned?: string;
    averageTax?: number;
    highestTax?: number;
    averageGas?: number;
  };
};

export async function getHoneypotCheck(chain: SupportedChain, tokenAddress: string): Promise<HoneypotResponse | null> {
  const chainId = toEvmChainId(chain);
  if (!chainId) {
    return null;
  }

  return requestJson<HoneypotResponse>(`https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainId}`);
}