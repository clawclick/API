/**
 * Uniswap V2 – BASE (chain 8453)
 *
 * Builds unsigned swap txs against the UniswapV2Router02 deployed on Base.
 * The caller signs & submits. No private keys handled here.
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
const ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24"; // Uniswap V2 Router on Base

/* ── Get amounts out via RPC ──────────────────────────────── */

async function getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BASE_RPC_URL");

  // Encode getAmountsOut(uint256,address[]) — selector 0xd06ca61f
  const offsetWord = encodeUint256(64n); // offset to dynamic array
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

  // Last 32-byte word is final amount out
  const hex = result.result.replace(/^0x/, "");
  const lastWord = hex.slice(-64);
  return BigInt("0x" + lastWord);
}

/* ── Build unsigned swap TX ──────────────────────────────── */

/**
 * swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * selector: 0x38ed1739
 *
 * swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * selector: 0x7ff36ab5
 */
export async function buildSwapTx(params: SwapParams): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);

  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.base;
  const actualTokenOut = isNativeIn(tokenOut) ? weth : tokenOut;
  const path = nativeIn ? [weth, actualTokenOut] : [tokenIn, actualTokenOut];

  const amountOut = await getAmountsOut(amtIn, path);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  if (nativeIn) {
    // swapExactETHForTokens — value = amountIn
    const offsetWord = encodeUint256(128n);
    const data = buildCalldata(
      selector("7ff36ab5"),
      encodeUint256(amountOutMin),
      encodeUint256(BigInt(path.length)),
      ...path.map((a) => padAddress(a)),
      padAddress(walletAddress),
      encodeUint256(BigInt(dl)),
    );

    // Re-encode with proper dynamic array layout
    const calldata = buildCalldata(
      selector("7ff36ab5"),
      encodeUint256(amountOutMin),        // amountOutMin
      offsetWord,                          // offset to path[]
      padAddress(walletAddress),            // to
      encodeUint256(BigInt(dl)),           // deadline
      encodeUint256(BigInt(path.length)),  // path length
      ...path.map((a) => padAddress(a)),  // path elements
    );

    return {
      to: ROUTER,
      data: calldata,
      value: "0x" + amtIn.toString(16),
      chainId: CHAIN_ID,
      from: walletAddress,
    };
  }

  // swapExactTokensForTokensSupportingFeeOnTransferTokens
  const offsetWord = encodeUint256(160n);
  const calldata = buildCalldata(
    selector("5c11d795"),
    encodeUint256(amtIn),               // amountIn
    encodeUint256(amountOutMin),        // amountOutMin
    offsetWord,                          // offset to path[]
    padAddress(walletAddress),           // to
    encodeUint256(BigInt(dl)),          // deadline
    encodeUint256(BigInt(path.length)), // path length
    ...path.map((a) => padAddress(a)), // path elements
  );

  return {
    to: ROUTER,
    data: calldata,
    value: "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
  };
}

/** Returns expected output amount and minimum after slippage. */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const weth = WRAPPED_NATIVE.base;
  const actualOut = isNativeIn(tokenOut) ? weth : tokenOut;
  const path = isNativeIn(tokenIn) ? [weth, actualOut] : [tokenIn, actualOut];
  const out = await getAmountsOut(BigInt(amountIn), path);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
  };
}
