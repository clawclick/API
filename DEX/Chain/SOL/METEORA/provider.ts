// DOCS: https://docs.meteora.ag (Meteora CLMM API)

import { buildFeeAwareSwapTx, getQuoteWithProtocolFee, type JupiterQuoteResponse, type SolanaSwapParams, type UnsignedSolTx } from "#lib/solanaSwap";
import { requestJson } from "#lib/http";

type MeteoraPair = {
  address?: string;
  name?: string;
  mint_x?: string;
  mint_y?: string;
  current_price?: number;
  liquidity?: number;
  trade_volume_24h?: number;
  fees_24h?: number;
  apr?: number;
};

/** GET /clmm-api/pair/all – list all Meteora CLMM pairs. No auth required. */
export async function getAllPairs(): Promise<MeteoraPair[]> {
  return requestJson<MeteoraPair[]>(
    "https://app.meteora.ag/clmm-api/pair/all",
  );
}

/* ── Swap types ──────────────────────────────────────────── */

const METEORA_DEXES = ["Meteora", "Meteora DLMM"];

/**
 * Meteora pools are routed through Jupiter aggregator for best execution.
 * We can force routes through Meteora pools by using Jupiter's dexes filter.
 *
 * GET /quote – get a quote from Jupiter routed through Meteora.
 */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const result = await getQuoteWithProtocolFee(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageBps: params.slippageBps,
    },
    { dexes: METEORA_DEXES, label: "Meteora" },
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
 * Build a fee-aware unsigned swap transaction routed through Meteora via Jupiter.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  return buildFeeAwareSwapTx(params, { dexes: METEORA_DEXES, label: "Meteora" });
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  return getQuoteWithProtocolFee({ tokenIn, tokenOut, amountIn, slippageBps }, { dexes: METEORA_DEXES, label: "Meteora" });
}
