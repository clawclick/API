/**
 * Uniswap V4 – Ethereum (chain 1)
 *
 * Builds unsigned swap txs via the Universal Router on ETH mainnet.
 * V4 swaps are routed through the Universal Router's execute() with
 * V3_SWAP_EXACT_IN command (which also covers V4 pool routing).
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
const UNIVERSAL_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

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
      params: [{ to: QUOTER_V2, data }, "latest"],
    }),
  });

  if (!result.result || result.result === "0x") {
    throw new Error("QuoterV2 returned empty – V4 pool may not exist for this fee tier");
  }

  return BigInt("0x" + result.result.replace(/^0x/, "").slice(0, 64));
}

/* ── Build unsigned swap TX via Universal Router ──────────── */

export async function buildSwapTx(params: SwapParams, fee = 3000): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.eth;
  const actualTokenIn = nativeIn ? weth : tokenIn;

  const amountOut = await quoteExactInputSingle(actualTokenIn, tokenOut, amtIn, fee);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  // Path: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
  const pathHex =
    actualTokenIn.replace(/^0x/, "").toLowerCase() +
    fee.toString(16).padStart(6, "0") +
    tokenOut.replace(/^0x/, "").toLowerCase();
  const pathLen = pathHex.length / 2;
  const pathPadded = pathHex.padEnd(Math.ceil(pathHex.length / 64) * 64, "0");

  const inputBytesRaw =
    padAddress(walletAddress) +
    encodeUint256(amtIn) +
    encodeUint256(amountOutMin) +
    encodeUint256(160n) +
    encodeUint256(nativeIn ? 1n : 0n) +
    encodeUint256(BigInt(pathLen)) +
    pathPadded;
  const inputBytesLen = inputBytesRaw.length / 2;

  const commands = "00"; // V3_SWAP_EXACT_IN

  const calldata = buildCalldata(
    selector("3593564c"),
    encodeUint256(96n),
    encodeUint256(160n),
    encodeUint256(BigInt(dl)),
    encodeUint256(1n),
    commands.padEnd(64, "0"),
    encodeUint256(1n),
    encodeUint256(32n),
    encodeUint256(BigInt(inputBytesLen)),
    inputBytesRaw.padEnd(Math.ceil(inputBytesRaw.length / 64) * 64, "0"),
  );

  return {
    to: UNIVERSAL_ROUTER,
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
