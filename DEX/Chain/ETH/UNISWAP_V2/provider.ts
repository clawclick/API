/**
 * Uniswap V2 – Ethereum (chain 1)
 *
 * Builds unsigned swap txs against the UniswapV2Router02 on mainnet.
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
const ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 Router02

/* ── getAmountsOut via RPC ────────────────────────────────── */

async function getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint> {
  const rpcUrl = getRequiredEnv("ETH_RPC_URL");

  const offsetWord = encodeUint256(64n);
  const amountWord = encodeUint256(amountIn);
  const lengthWord = encodeUint256(BigInt(path.length));
  const addressWords = path.map((a) => padAddress(a)).join("");
  const data = buildCalldata(
    selector("d06ca61f"),
    amountWord,
    offsetWord,
    lengthWord,
    addressWords,
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
  const weth = WRAPPED_NATIVE.eth;
  const actualTokenOut = isNativeIn(tokenOut) ? weth : tokenOut;
  const path = nativeIn ? [weth, actualTokenOut] : [tokenIn, actualTokenOut];

  const amountOut = await getAmountsOut(amtIn, path);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  if (nativeIn) {
    const offsetWord = encodeUint256(128n);
    const calldata = buildCalldata(
      selector("7ff36ab5"),
      encodeUint256(amountOutMin),
      offsetWord,
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
    };
  }

  const offsetWord = encodeUint256(160n);
  const calldata = buildCalldata(
    selector("5c11d795"),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    offsetWord,
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
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const weth = WRAPPED_NATIVE.eth;
  const actualOut = isNativeIn(tokenOut) ? weth : tokenOut;
  const path = isNativeIn(tokenIn) ? [weth, actualOut] : [tokenIn, actualOut];
  const out = await getAmountsOut(BigInt(amountIn), path);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
  };
}
