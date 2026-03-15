// DOCS: https://docs.meteora.ag (Meteora CLMM API)

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

type SolanaSwapParams = {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
};

type UnsignedSolTx = {
  serializedTx: string;
  chainId: "solana";
  from: string;
};

type JupiterQuoteResponse = {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: Array<{
    swapInfo?: {
      ammKey?: string;
      label?: string;
      inputMint?: string;
      outputMint?: string;
      inAmount?: string;
      outAmount?: string;
      feeAmount?: string;
      feeMint?: string;
    };
    percent?: number;
  }>;
};

type JupiterSwapResponse = {
  swapTransaction?: string;
};

/**
 * Meteora pools are routed through Jupiter aggregator for best execution.
 * We can force routes through Meteora pools by using Jupiter's dexes filter.
 *
 * GET /quote – get a quote from Jupiter routed through Meteora.
 */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const { tokenIn, tokenOut, amountIn, slippageBps } = params;
  return requestJson<JupiterQuoteResponse>(
    `https://quote-api.jup.ag/v6/quote?inputMint=${tokenIn}&outputMint=${tokenOut}&amount=${amountIn}&slippageBps=${slippageBps}&dexes=Meteora,Meteora+DLMM`,
  );
}

/**
 * POST /swap – get an unsigned swap transaction routed through Meteora via Jupiter.
 * Returns base64 versioned transaction.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  const { walletAddress } = params;

  const quote = await getSwapQuote(params);
  if (!quote.outAmount) {
    throw new Error("Meteora/Jupiter quote failed – no route found");
  }

  const txResp = await requestJson<JupiterSwapResponse>(
    "https://quote-api.jup.ag/v6/swap",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: walletAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    },
  );

  if (!txResp.swapTransaction) {
    throw new Error("Meteora/Jupiter swap tx build failed");
  }

  return {
    serializedTx: txResp.swapTransaction,
    chainId: "solana",
    from: walletAddress,
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const q = await getSwapQuote({ walletAddress: "", tokenIn, tokenOut, amountIn, slippageBps });
  return {
    amountOut: q.outAmount ?? "0",
    amountOutMin: q.otherAmountThreshold ?? "0",
  };
}
