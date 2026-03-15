/**
 * Uniswap V3 – Ethereum (chain 1)
 *
 * Builds unsigned swap txs against SwapRouter02 on mainnet.
 * Uses exactInputSingle for single-hop swaps.
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

const CHAIN_ID = EVM_CHAIN_IDS.eth;
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"; // SwapRouter02 on ETH mainnet
const QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // QuoterV2 on ETH mainnet

/* ── QuoterV2 ─────────────────────────────────────────────── */

async function quoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<bigint> {
  const rpcUrl = getRequiredEnv("ETH_RPC_URL");
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

export async function buildSwapTx(params: SwapParams, fee = 3000): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.eth;
  const actualTokenIn = nativeIn ? weth : tokenIn;

  const amountOut = await quoteExactInputSingle(actualTokenIn, tokenOut, amtIn, fee);
  const amountOutMin = applySlippage(amountOut, slippageBps);

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
  fee = 3000,
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const weth = WRAPPED_NATIVE.eth;
  const actualIn = isNativeIn(tokenIn) ? weth : tokenIn;
  const out = await quoteExactInputSingle(actualIn, tokenOut, BigInt(amountIn), fee);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
    fee,
  };
}
