// DOCS: https://docs.raydium.io/raydium/ (Raydium V3 API)

import { getRequiredEnv } from "#config/env";
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

type SolanaSwapParams = {
  walletAddress: string;
  tokenIn: string;   // mint address
  tokenOut: string;  // mint address
  amountIn: string;  // lamports / smallest unit
  slippageBps: number;
};

type UnsignedSolTx = {
  /** Base64-encoded serialized transaction (versioned, no signatures). */
  serializedTx: string;
  chainId: "solana";
  from: string;
};

type RaydiumQuoteResponse = {
  id?: string;
  success?: boolean;
  data?: {
    swapType?: string;
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
    slippageBps?: number;
    priceImpactPct?: number;
    routePlan?: Array<{
      poolId?: string;
      inputMint?: string;
      outputMint?: string;
    }>;
  };
};

type RaydiumSwapTxResponse = {
  id?: string;
  success?: boolean;
  data?: Array<{ transaction?: string }>;
};

/** GET /compute/swap-base-in – get a swap quote from Raydium. */
export async function getSwapQuote(params: SolanaSwapParams): Promise<RaydiumQuoteResponse> {
  const { tokenIn, tokenOut, amountIn, slippageBps } = params;
  return requestJson<RaydiumQuoteResponse>(
    `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${tokenIn}&outputMint=${tokenOut}&amount=${amountIn}&slippageBps=${slippageBps}&txVersion=V0`,
  );
}

/**
 * POST /transaction/swap-base-in – get an unsigned swap transaction.
 * Returns base64-encoded versioned transactions for the user to sign.
 */
export async function buildSwapTx(params: SolanaSwapParams): Promise<UnsignedSolTx> {
  const { walletAddress } = params;

  // Step 1: get quote
  const quote = await getSwapQuote(params);
  if (!quote.success || !quote.id) {
    throw new Error("Raydium quote failed: " + JSON.stringify(quote));
  }

  // Step 2: request unsigned tx
  const txResp = await requestJson<RaydiumSwapTxResponse>(
    "https://transaction-v1.raydium.io/transaction/swap-base-in",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: "auto",
        swapResponse: quote,
        txVersion: "V0",
        wallet: walletAddress,
        wrapSol: true,
        unwrapSol: true,
      }),
    },
  );

  if (!txResp.success || !txResp.data?.[0]?.transaction) {
    throw new Error("Raydium swap tx build failed: " + JSON.stringify(txResp));
  }

  return {
    serializedTx: txResp.data[0].transaction,
    chainId: "solana",
    from: walletAddress,
  };
}

/** Convenience: returns expected output amount and min after slippage. */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const q = await getSwapQuote({ walletAddress: "", tokenIn, tokenOut, amountIn, slippageBps });
  return {
    amountOut: q.data?.outAmount ?? "0",
    amountOutMin: q.data?.otherAmountThreshold ?? "0",
  };
}
