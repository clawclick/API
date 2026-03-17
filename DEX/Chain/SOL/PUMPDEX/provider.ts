// DOCS: (PumpDex / pump.fun swap API)

import { getOptionalEnv } from "#config/env";
import { buildFeeAwareSwapTx, getQuoteWithProtocolFee, type JupiterQuoteResponse, type SolanaSwapParams, type UnsignedSolTx } from "#lib/solanaSwap";
import { requestJson } from "#lib/http";

type PumpDexHealthResponse = {
  status?: string;
  [key: string]: unknown;
};

function getBaseUrl(): string {
  return getOptionalEnv("PUMPDEX_API_BASE_URL", "https://api.pumpdex.io");
}

/** GET /health – basic health check. No auth required. */
export async function getHealth(): Promise<PumpDexHealthResponse> {
  return requestJson<PumpDexHealthResponse>(`${getBaseUrl()}/health`);
}

/* ── Swap via Jupiter (pump.fun tokens graduate to Raydium) ── */

/**
 * PumpDex tokens (pump.fun mints) trade on Raydium once bonded.
 * We route through Jupiter which aggregates Raydium + pump.fun AMM pools.
 */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const result = await getQuoteWithProtocolFee(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageBps: params.slippageBps,
    },
    { label: "PumpDex" },
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
 * Build a fee-aware unsigned versioned tx via Jupiter for pump.fun token swaps.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  return buildFeeAwareSwapTx(params, { label: "PumpDex" });
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  return getQuoteWithProtocolFee({ tokenIn, tokenOut, amountIn, slippageBps }, { label: "PumpDex" });
}
