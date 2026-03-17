// DOCS: (PumpFun / pump.fun swap API)

import { getOptionalEnv } from "#config/env";
import {
  buildFeeAwareSwapTx,
  buildSwapTxWithoutProtocolFee,
  getQuoteWithProtocolFee,
  getQuoteWithoutProtocolFee,
  type JupiterQuoteResponse,
  type SolanaSwapParams,
  type UnsignedSolTx,
} from "#lib/solanaSwap";
import { requestJson } from "#lib/http";

type PumpFunHealthResponse = {
  status?: string;
  [key: string]: unknown;
};

function getBaseUrl(): string {
  return getOptionalEnv("PUMPFUN_API_BASE_URL", "https://api.pumpfun.io");
}

const NATIVE_SOL_ALIASES = new Set(["sol", "solana", "So11111111111111111111111111111111111111112"]);

function isPumpBuy(tokenIn: string, tokenOut: string): boolean {
  return NATIVE_SOL_ALIASES.has(tokenIn.trim().toLowerCase()) && !NATIVE_SOL_ALIASES.has(tokenOut.trim().toLowerCase());
}

/** GET /health – basic health check. No auth required. */
export async function getHealth(): Promise<PumpFunHealthResponse> {
  return requestJson<PumpFunHealthResponse>(`${getBaseUrl()}/health`);
}

/* ── Swap via Jupiter (pump.fun / PumpSwap routes) ── */

/**
 * Pump.fun / PumpSwap routes can be reached through Jupiter.
 * We keep the existing SOL buy fee path, but leave other directions as raw
 * Jupiter routes so sells keep working without output-side fee handling.
 */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const quoteParams = {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps,
  };

  const result = isPumpBuy(params.tokenIn, params.tokenOut)
    ? await getQuoteWithProtocolFee(quoteParams, { label: "PumpFun" })
    : await getQuoteWithoutProtocolFee(quoteParams, { label: "PumpFun" });

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
 * Build an unsigned versioned tx via Jupiter for pump.fun token swaps.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  if (isPumpBuy(params.tokenIn, params.tokenOut)) {
    return buildFeeAwareSwapTx(params, { label: "PumpFun" });
  }

  return buildSwapTxWithoutProtocolFee(params, { label: "PumpFun" });
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  if (isPumpBuy(tokenIn, tokenOut)) {
    return getQuoteWithProtocolFee({ tokenIn, tokenOut, amountIn, slippageBps }, { label: "PumpFun" });
  }

  return getQuoteWithoutProtocolFee({ tokenIn, tokenOut, amountIn, slippageBps }, { label: "PumpFun" });
}
