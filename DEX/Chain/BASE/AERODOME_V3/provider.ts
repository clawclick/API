/**
 * Aerodrome Slipstream (CL / "V3") – BASE (chain 8453)
 *
 * Concentrated-liquidity pools using tick spacings instead of fee tiers.
 * Quotes via the MixedRouteQuoterV1, swaps via the Slipstream SwapRouter.
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
const ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";   // Slipstream SwapRouter
const QUOTER = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";   // MixedRouteQuoterV1
const COMMON_TICK_SPACINGS = [1, 100, 200] as const;

/* ── Quoter ───────────────────────────────────────────────── */

/**
 * quoteExactInputSingle((address,address,uint256,int24,uint160))
 * selector: 0x9e7defe6
 * Returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
 */
async function quoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  tickSpacing: number,
): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BASE_RPC_URL");

  // int24 tickSpacing – encode as signed 256-bit (two's complement for negatives, though spacings are positive)
  const tickWord = encodeUint256(BigInt(tickSpacing));

  const data = buildCalldata(
    selector("9e7defe6"),
    padAddress(tokenIn),
    padAddress(tokenOut),
    encodeUint256(amountIn),
    tickWord,
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
    throw new Error("Slipstream quoter returned empty – pool may not exist for this tick spacing");
  }

  const hex = result.result.replace(/^0x/, "");
  return BigInt("0x" + hex.slice(0, 64));
}

async function resolveBestTickSpacing(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  preferredTick?: number,
): Promise<{ tickSpacing: number; amountOut: bigint }> {
  const candidates = preferredTick
    ? [preferredTick, ...COMMON_TICK_SPACINGS.filter((t) => t !== preferredTick)]
    : [...COMMON_TICK_SPACINGS];

  let best: { tickSpacing: number; amountOut: bigint } | null = null;
  let lastError: Error | null = null;

  for (const ts of candidates) {
    try {
      const amountOut = await quoteExactInputSingle(tokenIn, tokenOut, amountIn, ts);
      if (!best || amountOut > best.amountOut) {
        best = { tickSpacing: ts, amountOut };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!best) {
    throw lastError ?? new Error("No Slipstream pool found for this token pair on any tick spacing");
  }

  return best;
}

/* ── Build unsigned swap TX ──────────────────────────────── */

/**
 * exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))
 * selector: 0xa026383e
 */
export async function buildSwapTx(params: SwapParams, tickSpacing?: number): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const recipient = params.recipient ?? walletAddress;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.base;
  const actualTokenIn = nativeIn ? weth : tokenIn;
  const actualTokenOut = isNativeIn(tokenOut) ? weth : tokenOut;

  const resolved = await resolveBestTickSpacing(actualTokenIn, actualTokenOut, amtIn, tickSpacing);
  const amountOutMin = applySlippage(resolved.amountOut, slippageBps);

  const calldata = buildCalldata(
    selector("a026383e"),
    padAddress(actualTokenIn),
    padAddress(actualTokenOut),
    encodeUint256(BigInt(resolved.tickSpacing)),
    padAddress(recipient),
    encodeUint256(BigInt(dl)),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    encodeUint256(0n), // sqrtPriceLimitX96
  );

  return {
    to: ROUTER,
    data: calldata,
    value: nativeIn ? "0x" + amtIn.toString(16) : "0x0",
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
  tickSpacing?: number,
): Promise<{ amountOut: string; amountOutMin: string; tickSpacing: number }> {
  const weth = WRAPPED_NATIVE.base;
  const actualIn = isNativeIn(tokenIn) ? weth : tokenIn;
  const actualOut = isNativeIn(tokenOut) ? weth : tokenOut;
  const resolved = await resolveBestTickSpacing(actualIn, actualOut, BigInt(amountIn), tickSpacing);
  return {
    amountOut: resolved.amountOut.toString(),
    amountOutMin: applySlippage(resolved.amountOut, slippageBps).toString(),
    tickSpacing: resolved.tickSpacing,
  };
}
