import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

export type EthplorerTopCriteria = "trade" | "cap" | "count";

export type EthplorerTokenPrice = {
  rate?: number;
  currency?: string;
  diff?: number;
  diff7d?: number;
  diff30d?: number;
  marketCapUsd?: number;
  availableSupply?: number;
  volume24h?: number;
  ts?: number;
};

export type EthplorerContractInfo = {
  creatorAddress?: string;
  creationTransactionHash?: string;
  creationTimestamp?: number;
};

export type EthplorerGetTopToken = {
  address?: string;
  totalSupply?: string;
  name?: string;
  symbol?: string;
  decimals?: string;
  price?: EthplorerTokenPrice | false;
  owner?: string;
  contractInfo?: EthplorerContractInfo;
  countOps?: number;
  txsCount?: number;
  totalIn?: string | number;
  totalOut?: string | number;
  transfersCount?: number;
  ethTransfersCount?: number;
  holdersCount?: number;
  image?: string;
  website?: string;
  lastUpdated?: number;
  [key: string]: unknown;
};

type EthplorerError = {
  code?: number;
  message?: string;
};

export type EthplorerGetTopResponse = {
  tokens?: EthplorerGetTopToken[];
  error?: EthplorerError;
};

export function isEthplorerConfigured(): boolean {
  return isConfigured(getOptionalEnv("ETHPLORER_API_KEY"));
}

export async function getTop(criteria: EthplorerTopCriteria = "trade", limit = 50): Promise<EthplorerGetTopResponse> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const response = await requestJson<EthplorerGetTopResponse>(
    `https://api.ethplorer.io/getTop?criteria=${criteria}&limit=${safeLimit}&apiKey=${encodeURIComponent(getRequiredEnv("ETHPLORER_API_KEY"))}`,
  );

  if (response.error?.message) {
    throw new Error(`Ethplorer error ${response.error.code ?? "unknown"}: ${response.error.message}`);
  }

  return response;
}