// DOCS: (PumpDex / pump.fun swap API)

import { getOptionalEnv } from "#config/env";
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
    };
    percent?: number;
  }>;
};

type JupiterSwapResponse = {
  swapTransaction?: string;
};

/**
 * PumpDex tokens (pump.fun mints) trade on Raydium once bonded.
 * We route through Jupiter which aggregates Raydium + pump.fun AMM pools.
 */
export async function getSwapQuote(params: SolanaSwapParams): Promise<JupiterQuoteResponse> {
  const { tokenIn, tokenOut, amountIn, slippageBps } = params;
  return requestJson<JupiterQuoteResponse>(
    `https://quote-api.jup.ag/v6/quote?inputMint=${tokenIn}&outputMint=${tokenOut}&amount=${amountIn}&slippageBps=${slippageBps}`,
  );
}

/**
 * POST /swap – get unsigned versioned tx via Jupiter for pump.fun token swaps.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  const { walletAddress } = params;

  const quote = await getSwapQuote(params);
  if (!quote.outAmount) {
    throw new Error("PumpDex/Jupiter quote failed – no route found");
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
    throw new Error("PumpDex/Jupiter swap tx build failed");
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
