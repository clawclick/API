// DOCS: https://docs.etherscan.io/etherscan-v2 (unified API for ETH, BASE, BSC)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type GasOracleResult = {
  LastBlock?: string;
  SafeGasPrice?: string;
  ProposeGasPrice?: string;
  FastGasPrice?: string;
  suggestBaseFee?: string;
};

type EtherscanResponse = {
  status?: string;
  message?: string;
  result?: GasOracleResult;
};

type ChainConfig = {
  chainId: string;
  envKey: string;
};

const chains: Record<string, ChainConfig> = {
  eth: { chainId: "1", envKey: "ETHERSCAN_API_KEY" },
  base: { chainId: "8453", envKey: "BASESCAN_API_KEY" },
  bsc: { chainId: "56", envKey: "BSCSCAN_API_KEY" },
};

export function isEtherscanConfigured(chain: string): boolean {
  const cfg = chains[chain];
  if (!cfg) return false;
  return isConfigured(getOptionalEnv(cfg.envKey));
}

/** GET /v2/api?chainid={id}&module=gastracker&action=gasoracle – gas prices for EVM chains. */
export async function getGasOracle(chain: string): Promise<EtherscanResponse> {
  const cfg = chains[chain];
  if (!cfg) throw new Error(`Unsupported etherscan chain: ${chain}`);

  const apiKey = encodeURIComponent(getRequiredEnv(cfg.envKey));

  return requestJson<EtherscanResponse>(
    `https://api.etherscan.io/v2/api?chainid=${cfg.chainId}&module=gastracker&action=gasoracle&apikey=${apiKey}`,
  );
}
