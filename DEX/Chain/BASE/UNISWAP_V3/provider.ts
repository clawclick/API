/**
 * Uniswap V3 – BASE (chain 8453)
 *
 * Builds unsigned swap txs against the SwapRouter02 on Base.
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

const CHAIN_ID = EVM_CHAIN_IDS.base;
const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481"; // SwapRouter02 on Base

/* ── Quoter V2 for exact input ────────────────────────────── */

const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"; // QuoterV2 on Base

/**
 * quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96))
 * selector: 0xc6a5026a
 */
async function quoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BASE_RPC_URL");

  const data = buildCalldata(
    selector("c6a5026a"),
    padAddress(tokenIn),
    padAddress(tokenOut),
    encodeUint256(amountIn),
    encodeUint256(BigInt(fee)),
    encodeUint256(0n), // sqrtPriceLimitX96 = 0
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

  // First 32-byte word = amountOut
  const hex = result.result.replace(/^0x/, "");
  return BigInt("0x" + hex.slice(0, 64));
}

/* ── Build unsigned swap TX ──────────────────────────────── */

/**
 * exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient,
 *   uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))
 * selector: 0x04e45aaf
 */
export async function buildSwapTx(params: SwapParams, fee = 3000): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.base;
  const actualTokenIn = nativeIn ? weth : tokenIn;

  const amountOut = await quoteExactInputSingle(actualTokenIn, tokenOut, amtIn, fee);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  // Pack struct as sequential words (Solidity tuple encoding)
  const calldata = buildCalldata(
    selector("04e45aaf"),
    padAddress(actualTokenIn),        // tokenIn
    padAddress(tokenOut),             // tokenOut
    encodeUint256(BigInt(fee)),       // fee
    padAddress(walletAddress),        // recipient
    encodeUint256(amtIn),             // amountIn
    encodeUint256(amountOutMin),      // amountOutMinimum
    encodeUint256(0n),                // sqrtPriceLimitX96
  );

  return {
    to: ROUTER,
    data: calldata,
    value: nativeIn ? "0x" + amtIn.toString(16) : "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
  };
}

/** Quote: returns expected output and minimum after slippage for a V3 single-hop. */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
  fee = 3000,
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const weth = WRAPPED_NATIVE.base;
  const actualIn = isNativeIn(tokenIn) ? weth : tokenIn;
  const out = await quoteExactInputSingle(actualIn, tokenOut, BigInt(amountIn), fee);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
    fee,
  };
}
