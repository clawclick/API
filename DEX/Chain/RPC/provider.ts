// DOCS: https://ethereum.org/en/developers/docs/apis/json-rpc/
//       https://solana.com/docs/rpc

import { getRequiredEnv } from "#config/env";
import { requestJson } from "#lib/http";

type JsonRpcResponse<T = unknown> = {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code?: number; message?: string };
};

type FeeHistoryResult = {
  oldestBlock?: string;
  baseFeePerGas?: string[];
  gasUsedRatio?: number[];
  reward?: string[][];
};

const rpcEnvKeys: Record<string, string> = {
  eth: "ETH_RPC_URL",
  base: "BASE_RPC_URL",
  bsc: "BSC_RPC_URL",
  sol: "SOL_RPC_URL",
};

function getRpcUrl(chain: string): string {
  const envKey = rpcEnvKeys[chain];
  if (!envKey) throw new Error(`No RPC env configured for chain: ${chain}`);
  return getRequiredEnv(envKey);
}

/** Generic JSON-RPC call to any supported chain's node. */
export async function rpcCall<T = unknown>(chain: string, method: string, params: unknown[] = []): Promise<JsonRpcResponse<T>> {
  return requestJson<JsonRpcResponse<T>>(getRpcUrl(chain), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/** Get latest block number (EVM chains). */
export async function getBlockNumber(chain: string): Promise<JsonRpcResponse<string>> {
  return rpcCall<string>(chain, "eth_blockNumber");
}

export async function getGasPrice(chain: string): Promise<JsonRpcResponse<string>> {
  return rpcCall<string>(chain, "eth_gasPrice");
}

export async function getFeeHistory(
  chain: string,
  blockCount = 4,
  newestBlock = "latest",
  rewardPercentiles: number[] = [10, 50, 90],
): Promise<JsonRpcResponse<FeeHistoryResult>> {
  return rpcCall<FeeHistoryResult>(chain, "eth_feeHistory", [toRpcQuantity(blockCount), newestBlock, rewardPercentiles]);
}

function toRpcQuantity(value: number): string {
  return `0x${value.toString(16)}`;
}

/** Solana health check. */
export async function getSolanaHealth(): Promise<JsonRpcResponse<string>> {
  return rpcCall<string>("sol", "getHealth");
}
