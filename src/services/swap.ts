import { normalizeChain, isEvmChain, type SupportedChain } from "#providers/shared/chains";
import { addStatus, runProvider } from "#lib/runProvider";
import { getEvmFeeWrapperAddress, isNativeIn, subtractProtocolFee, wrapNativeBuyTxWithFeeWrapper } from "#lib/evm";
import type { SwapQuery, SwapQuoteQuery } from "#routes/helpers";
import type { ProviderStatus, SwapTxResponse, SwapQuoteResponse } from "#types/api";
import type { UnsignedSwapTx } from "#lib/evm";

/* ── EVM providers ────────────────────────────────────────── */
import { buildSwapTx as ethUniV2Swap, getQuote as ethUniV2Quote } from "#providers/dex/ethUniswapV2";
import { buildSwapTx as ethUniV3Swap, getQuote as ethUniV3Quote } from "#providers/dex/ethUniswapV3";
import { buildSwapTx as ethUniV4Swap, getQuote as ethUniV4Quote } from "#providers/dex/ethUniswapV4";
import { buildSwapTx as baseUniV2Swap, getQuote as baseUniV2Quote } from "#providers/dex/baseUniswapV2";
import { buildSwapTx as baseUniV3Swap, getQuote as baseUniV3Quote } from "#providers/dex/baseUniswapV3";
import { buildSwapTx as baseUniV4Swap, getQuote as baseUniV4Quote } from "#providers/dex/baseUniswapV4";
import { buildSwapTx as aeroSwap, getQuote as aeroQuote } from "#providers/dex/aerodrome";
import { buildSwapTx as aeroV3Swap, getQuote as aeroV3Quote } from "#providers/dex/aerodromeV3";
import { buildSwapTx as bscV2Swap, getQuote as bscV2Quote } from "#providers/dex/pancakeswapV2";
import { buildSwapTx as bscV3Swap, getQuote as bscV3Quote } from "#providers/dex/pancakeswapV3";

/* ── SOL providers ────────────────────────────────────────── */
import { buildSwapTx as raydiumSwap, getQuote as raydiumQuote } from "#providers/dex/raydium";
import { buildSwapTx as meteoraSwap, getQuote as meteoraQuote } from "#providers/dex/meteora";
import { buildSwapTx as pumpDexSwap, getQuote as pumpDexQuote } from "#providers/dex/pumpDex";

/* ── Helpers ──────────────────────────────────────────────── */



/* ── DEX registry ─────────────────────────────────────────── */

type DexId =
  | "uniswapV2" | "uniswapV3" | "uniswapV4"
  | "aerodromeV2" | "aerodromeV3"
  | "pancakeswapV2" | "pancakeswapV3"
  | "raydium" | "meteora" | "pumpDex";

type SwapFn = (params: { walletAddress: string; tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number; deadline?: number }) => Promise<unknown>;
type QuoteFn = (tokenIn: string, tokenOut: string, amountIn: string, slippageBps: number) => Promise<{ amountOut: string; amountOutMin: string }>;

type DexEntry = {
  id: DexId;
  label: string;
  chains: SupportedChain[];
  swapByChain: Partial<Record<SupportedChain, SwapFn>>;
  quoteByChain: Partial<Record<SupportedChain, QuoteFn>>;
};

const DEX_REGISTRY: DexEntry[] = [
  {
    id: "uniswapV2", label: "Uniswap V2",
    chains: ["eth", "base"],
    swapByChain: { eth: ethUniV2Swap, base: baseUniV2Swap },
    quoteByChain: { eth: ethUniV2Quote, base: baseUniV2Quote },
  },
  {
    id: "uniswapV3", label: "Uniswap V3",
    chains: ["eth", "base"],
    swapByChain: { eth: ethUniV3Swap, base: baseUniV3Swap },
    quoteByChain: { eth: ethUniV3Quote, base: baseUniV3Quote },
  },
  {
    id: "uniswapV4", label: "Uniswap V4",
    chains: ["eth", "base"],
    swapByChain: { eth: ethUniV4Swap, base: baseUniV4Swap },
    quoteByChain: { eth: ethUniV4Quote, base: baseUniV4Quote },
  },
  {
    id: "aerodromeV2", label: "Aerodrome V2",
    chains: ["base"],
    swapByChain: { base: aeroSwap },
    quoteByChain: { base: aeroQuote },
  },
  {
    id: "aerodromeV3", label: "Aerodrome V3 (Slipstream)",
    chains: ["base"],
    swapByChain: { base: aeroV3Swap },
    quoteByChain: { base: aeroV3Quote },
  },
  {
    id: "pancakeswapV2", label: "PancakeSwap V2",
    chains: ["bsc"],
    swapByChain: { bsc: bscV2Swap },
    quoteByChain: { bsc: bscV2Quote },
  },
  {
    id: "pancakeswapV3", label: "PancakeSwap V3",
    chains: ["bsc"],
    swapByChain: { bsc: bscV3Swap },
    quoteByChain: { bsc: bscV3Quote },
  },
  {
    id: "raydium", label: "Raydium",
    chains: ["sol"],
    swapByChain: { sol: raydiumSwap },
    quoteByChain: { sol: raydiumQuote },
  },
  {
    id: "meteora", label: "Meteora",
    chains: ["sol"],
    swapByChain: { sol: meteoraSwap },
    quoteByChain: { sol: meteoraQuote },
  },
  {
    id: "pumpDex", label: "PumpDex",
    chains: ["sol"],
    swapByChain: { sol: pumpDexSwap },
    quoteByChain: { sol: pumpDexQuote },
  },
];

function resolveDex(dex: string): DexEntry | undefined {
  return DEX_REGISTRY.find((d) => d.id.toLowerCase() === dex.toLowerCase());
}

function dexesForChain(chain: SupportedChain): DexEntry[] {
  return DEX_REGISTRY.filter((d) => d.chains.includes(chain));
}

/* ── Public service functions ─────────────────────────────── */

/**
 * POST /swap — build an unsigned swap transaction for a specific dex + chain.
 */
export async function getSwapTx(query: SwapQuery): Promise<SwapTxResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const nativeInBuy = isEvmChain(chain) && isNativeIn(query.tokenIn) && !isNativeIn(query.tokenOut);
  const feeWrapperAddress = nativeInBuy ? getEvmFeeWrapperAddress(chain) : null;
  const adjustedAmountIn = feeWrapperAddress
    ? subtractProtocolFee(BigInt(query.amountIn)).toString()
    : query.amountIn;

  const entry = resolveDex(query.dex);
  if (!entry) {
    return {
      endpoint: "swap",
      status: "partial",
      chain,
      dex: query.dex,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      amountIn: query.amountIn,
      slippageBps: query.slippageBps,
      tx: null,
      providers: [{ provider: query.dex, status: "error", detail: `Unknown dex "${query.dex}". Available: ${DEX_REGISTRY.map((d) => d.id).join(", ")}` }],
    };
  }

  const swapFn = entry.swapByChain[chain];
  const result = await runProvider(providers, entry.id, !!swapFn, () =>
    swapFn!({
      walletAddress: query.walletAddress,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      amountIn: adjustedAmountIn,
      slippageBps: query.slippageBps,
      deadline: query.deadline,
    }),
    `${entry.label} is not available on ${chain}. Supported chains: ${entry.chains.join(", ")}`,
  );

  const wrappedResult = feeWrapperAddress && result
    ? wrapNativeBuyTxWithFeeWrapper(result as UnsignedSwapTx, chain, query.amountIn)
    : result;

  return {
    endpoint: "swap",
    status: result ? "live" : "partial",
    chain,
    dex: entry.id,
    tokenIn: query.tokenIn,
    tokenOut: query.tokenOut,
    amountIn: query.amountIn,
    slippageBps: query.slippageBps,
    tx: wrappedResult as SwapTxResponse["tx"],
    providers,
  };
}

/**
 * GET /swapQuote — get a price quote (no transaction) for a specific dex + chain.
 */
export async function getSwapQuote(query: SwapQuoteQuery): Promise<SwapQuoteResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const nativeInBuy = isEvmChain(chain) && isNativeIn(query.tokenIn) && !isNativeIn(query.tokenOut);
  const feeWrapperAddress = nativeInBuy ? getEvmFeeWrapperAddress(chain) : null;
  const adjustedAmountIn = feeWrapperAddress
    ? subtractProtocolFee(BigInt(query.amountIn)).toString()
    : query.amountIn;

  const entry = resolveDex(query.dex);
  if (!entry) {
    return {
      endpoint: "swapQuote",
      status: "partial",
      chain,
      dex: query.dex,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      amountIn: query.amountIn,
      slippageBps: query.slippageBps,
      amountOut: null,
      amountOutMin: null,
      providers: [{ provider: query.dex, status: "error", detail: `Unknown dex "${query.dex}". Available: ${DEX_REGISTRY.map((d) => d.id).join(", ")}` }],
    };
  }

  const quoteFn = entry.quoteByChain[chain];
  const result = await runProvider(providers, entry.id, !!quoteFn, () =>
    quoteFn!(query.tokenIn, query.tokenOut, adjustedAmountIn, query.slippageBps),
    `${entry.label} is not available on ${chain}. Supported chains: ${entry.chains.join(", ")}`,
  );

  return {
    endpoint: "swapQuote",
    status: result ? "live" : "partial",
    chain,
    dex: entry.id,
    tokenIn: query.tokenIn,
    tokenOut: query.tokenOut,
    amountIn: query.amountIn,
    slippageBps: query.slippageBps,
    amountOut: result?.amountOut ?? null,
    amountOutMin: result?.amountOutMin ?? null,
    providers,
  };
}

/**
 * GET /swapDexes — list available DEXes for a given chain.
 */
export function getSwapDexes(chain: string): SwapDexesResponse {
  const normalized = normalizeChain(chain);
  const dexes = dexesForChain(normalized).map((d) => ({
    id: d.id,
    label: d.label,
  }));

  return {
    endpoint: "swapDexes",
    chain: normalized,
    dexes,
  };
}

export type SwapDexesResponse = {
  endpoint: "swapDexes";
  chain: string;
  dexes: Array<{ id: string; label: string }>;
};
