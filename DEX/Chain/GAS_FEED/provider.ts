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

const CHAIN_IDS: Record<string, string> = {
  eth: "1",
  base: "8453",
  bsc: "56",
};

export function isEtherscanConfigured(chain: string): boolean {
  if (!CHAIN_IDS[chain]) return false;
  return isConfigured(getOptionalEnv("ETHERSCAN_API_KEY"));
}

/** GET /v2/api?chainid={id}&module=gastracker&action=gasoracle – gas prices for EVM chains.
 *  Etherscan V2 uses a single API key for all chains (eth, base, bsc) with chainid param. */
export async function getGasOracle(chain: string): Promise<EtherscanResponse> {
  const chainId = CHAIN_IDS[chain];
  if (!chainId) throw new Error(`Unsupported etherscan chain: ${chain}`);

  const apiKey = encodeURIComponent(getRequiredEnv("ETHERSCAN_API_KEY"));

  return requestJson<EtherscanResponse>(
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=gastracker&action=gasoracle&apikey=${apiKey}`,
  );
}
