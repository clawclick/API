/**
 * PancakeSwap V3 – BSC (chain 56)
 *
 * Builds unsigned swap txs against PancakeSwap's V3-style SmartRouter on BNB Chain.
 * Uses exactInputSingle for single-hop concentrated-liquidity swaps.
 */

import { getRequiredEnv } from "#config/env";
import { requestJson } from "#lib/http";
import {
  type UnsignedSwapTx,
  type SwapParams,
  EVM_CHAIN_IDS,
  WRAPPED_NATIVE,
  isNativeIn,
  padAddress,
  encodeUint256,
  buildCalldata,
  selector,
  applySlippage,
  defaultDeadline,
} from "#lib/evm";

const CHAIN_ID = EVM_CHAIN_IDS.bsc;
const ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"; // PancakeSwap V3 SmartRouter on BSC
const QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"; // PancakeSwap QuoterV2 on BSC

/* ── QuoterV2 ─────────────────────────────────────────────── */

async function quoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BSC_RPC_URL");

  const data = buildCalldata(
    selector("c6a5026a"),
    padAddress(tokenIn),
    padAddress(tokenOut),
    encodeUint256(amountIn),
    encodeUint256(BigInt(fee)),
    encodeUint256(0n),
  );

  const result = await requestJson<{ result?: string }>(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: QUOTER, data }, "latest"],
    }),
  });

  if (!result.result || result.result === "0x") {
    throw new Error("QuoterV2 returned empty – pool may not exist for this fee tier");
  }

  return BigInt("0x" + result.result.replace(/^0x/, "").slice(0, 64));
}

/* ── Build unsigned swap TX ──────────────────────────────── */

export async function buildSwapTx(params: SwapParams, fee = 2500): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualTokenIn = nativeIn ? wbnb : tokenIn;

  const amountOut = await quoteExactInputSingle(actualTokenIn, tokenOut, amtIn, fee);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
  const calldata = buildCalldata(
    selector("04e45aaf"),
    padAddress(actualTokenIn),
    padAddress(tokenOut),
    encodeUint256(BigInt(fee)),
    padAddress(walletAddress),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    encodeUint256(0n),
  );

  return {
    to: ROUTER,
    data: calldata,
    value: nativeIn ? "0x" + amtIn.toString(16) : "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
  fee = 2500,
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualIn = isNativeIn(tokenIn) ? wbnb : tokenIn;
  const out = await quoteExactInputSingle(actualIn, tokenOut, BigInt(amountIn), fee);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
    fee,
  };
}
