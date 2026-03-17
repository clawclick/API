// DOCS: https://docs.raydium.io/raydium/ (Raydium V3 API)

import { buildFeeAwareSwapTx, getQuoteWithProtocolFee, type JupiterQuoteResponse, type SolanaSwapParams, type UnsignedSolTx } from "#lib/solanaSwap";
import { requestJson } from "#lib/http";

type RaydiumPool = {
  id?: string;
  mintA?: { address?: string; symbol?: string };
  mintB?: { address?: string; symbol?: string };
  tvl?: number;
  day?: { volume?: number; apr?: number };
  type?: string;
  programId?: string;
};

type RaydiumPoolListResponse = {
  success?: boolean;
  data?: {
    count?: number;
    data?: RaydiumPool[];
  };
};

/** GET /pools/info/list – list pools with type filter. No auth required. */
export async function getPoolList(page = 1, pageSize = 10, poolType = "all"): Promise<RaydiumPoolListResponse> {
  return requestJson<RaydiumPoolListResponse>(
    `https://api-v3.raydium.io/pools/info/list?page=${page}&pageSize=${pageSize}&poolType=${poolType}`,
  );
}

/* ── Swap types ──────────────────────────────────────────── */

const RAYDIUM_DEXES = ["Raydium", "Raydium CLMM"];

/** GET /quote – get a quote from Jupiter restricted to Raydium liquidity. */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const result = await getQuoteWithProtocolFee(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageBps: params.slippageBps,
    },
    { dexes: RAYDIUM_DEXES, label: "Raydium" },
  );

  return {
    inputMint: params.tokenIn,
    outputMint: params.tokenOut,
    inAmount: params.amountIn,
    outAmount: result.amountOut,
    otherAmountThreshold: result.amountOutMin,
    slippageBps: params.slippageBps,
    swapMode: "ExactIn",
  };
}

/**
 * Build a fee-aware unsigned swap transaction using Jupiter instructions
 * restricted to Raydium liquidity.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  return buildFeeAwareSwapTx(params, { dexes: RAYDIUM_DEXES, label: "Raydium" });
}

/** Convenience: returns expected output amount and min after slippage. */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  return getQuoteWithProtocolFee({ tokenIn, tokenOut, amountIn, slippageBps }, { dexes: RAYDIUM_DEXES, label: "Raydium" });
}
