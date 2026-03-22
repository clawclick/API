/**
 * PancakeSwap V2 – BSC (chain 56)
 *
 * Builds unsigned swap txs against the PancakeSwap V2 Router on BNB Chain.
 * Same interface as UniswapV2Router02.
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
const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap V2 Router

/* ── getAmountsOut via RPC ────────────────────────────────── */

async function getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BSC_RPC_URL");

  const data = buildCalldata(
    selector("d06ca61f"),
    encodeUint256(amountIn),
    encodeUint256(64n),
    encodeUint256(BigInt(path.length)),
    ...path.map((a) => padAddress(a)),
  );

  const result = await requestJson<{ result?: string }>(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: ROUTER, data }, "latest"],
    }),
  });

  if (!result.result || result.result === "0x") {
    throw new Error("getAmountsOut returned empty – pair may not exist");
  }

  const hex = result.result.replace(/^0x/, "");
  return BigInt("0x" + hex.slice(-64));
}

/* ── Build unsigned swap TX ──────────────────────────────── */

export async function buildSwapTx(params: SwapParams): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const recipient = params.recipient ?? walletAddress;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualTokenOut = isNativeIn(tokenOut) ? wbnb : tokenOut;
  const path = nativeIn ? [wbnb, actualTokenOut] : [tokenIn, actualTokenOut];

  const amountOut = await getAmountsOut(amtIn, path);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  if (nativeIn) {
    // swapExactETHForTokens (payable)
    const calldata = buildCalldata(
      selector("7ff36ab5"),
      encodeUint256(amountOutMin),
      encodeUint256(128n),
      padAddress(walletAddress),
      encodeUint256(BigInt(dl)),
      encodeUint256(BigInt(path.length)),
      ...path.map((a) => padAddress(a)),
    );
    return {
      to: ROUTER,
      data: calldata,
      value: "0x" + amtIn.toString(16),
      chainId: CHAIN_ID,
      from: walletAddress,
      amountOutMin: amountOutMin.toString(),
    };
  }

  // swapExactTokensForTokensSupportingFeeOnTransferTokens
  const calldata = buildCalldata(
    selector("5c11d795"),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    encodeUint256(160n),
    padAddress(recipient),
    encodeUint256(BigInt(dl)),
    encodeUint256(BigInt(path.length)),
    ...path.map((a) => padAddress(a)),
  );

  return {
    to: ROUTER,
    data: calldata,
    value: "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
    amountOutMin: amountOutMin.toString(),
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualOut = isNativeIn(tokenOut) ? wbnb : tokenOut;
  const path = isNativeIn(tokenIn) ? [wbnb, actualOut] : [tokenIn, actualOut];
  const out = await getAmountsOut(BigInt(amountIn), path);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
  };
}
