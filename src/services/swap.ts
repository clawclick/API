import { normalizeChain, isEvmChain, type SupportedChain } from "#providers/shared/chains";
import { addStatus, runProvider } from "#lib/runProvider";
import { buildErc20ApproveTx, buildPermit2ApproveTx, getEvmFeeWrapperAddress, isNativeIn, PERMIT2_ADDRESS, subtractProtocolFee, wrapNativeBuyTxWithFeeWrapper, wrapTokenSellTxWithFeeWrapper, wrapTokenSellTxWithPermit2FeeWrapper } from "#lib/evm";
import type { ApproveQuery, SwapQuery, SwapQuoteQuery } from "#routes/helpers";
import type { ApproveResponse, ProviderStatus, SwapTxResponse, SwapQuoteResponse } from "#types/api";
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
import { buildSwapTx as pumpfunSwap, getQuote as pumpfunQuote } from "#providers/dex/pumpfun";

/* ── Helpers ──────────────────────────────────────────────── */



/* ── DEX registry ─────────────────────────────────────────── */

type DexId =
  | "uniswapV2" | "uniswapV3" | "uniswapV4"
  | "aerodromeV2" | "aerodromeV3"
  | "pancakeswapV2" | "pancakeswapV3"
  | "raydium" | "meteora" | "pumpfun";

type SwapFn = (params: { walletAddress: string; tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number; deadline?: number; recipient?: string }) => Promise<unknown>;
type QuoteFn = (tokenIn: string, tokenOut: string, amountIn: string, slippageBps: number) => Promise<{ amountOut: string; amountOutMin: string }>;

type DexEntry = {
  id: DexId;
  label: string;
  chains: SupportedChain[];
  swapByChain: Partial<Record<SupportedChain, SwapFn>>;
  quoteByChain: Partial<Record<SupportedChain, QuoteFn>>;
};

const DEX_SPENDERS: Partial<Record<DexId, Partial<Record<SupportedChain, string>>>> = {
  uniswapV2: {
    eth: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    base: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
  },
  uniswapV3: {
    eth: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    base: "0x2626664c2603336E57B271c5C0b26F421741e481",
  },
  uniswapV4: {
    eth: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
    base: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  },
  aerodromeV2: {
    base: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  },
  aerodromeV3: {
    base: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
  },
  pancakeswapV2: {
    bsc: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  },
  pancakeswapV3: {
    bsc: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  },
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
    id: "pumpfun", label: "PumpFun",
    chains: ["sol"],
    swapByChain: { sol: pumpfunSwap },
    quoteByChain: { sol: pumpfunQuote },
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
  const nativeOutSell = isEvmChain(chain) && !isNativeIn(query.tokenIn) && isNativeIn(query.tokenOut);
  const feeWrapperAddress = (nativeInBuy || nativeOutSell) ? getEvmFeeWrapperAddress(chain) : null;
  const adjustedAmountIn = (nativeInBuy && feeWrapperAddress)
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

  const wrapSellWithPermit2 = nativeOutSell && entry.id === "uniswapV4" && chain === "base";
  const wrapSellWithLegacy = nativeOutSell && !wrapSellWithPermit2;
  const shouldWrapSell = wrapSellWithLegacy || wrapSellWithPermit2;

  const swapFn = entry.swapByChain[chain];
  const result = await runProvider(providers, entry.id, !!swapFn, () =>
    swapFn!({
      walletAddress: query.walletAddress,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      amountIn: adjustedAmountIn,
      slippageBps: query.slippageBps,
      deadline: query.deadline,
      recipient: (shouldWrapSell && feeWrapperAddress) ? feeWrapperAddress : undefined,
    }),
    `${entry.label} is not available on ${chain}. Supported chains: ${entry.chains.join(", ")}`,
  );

  let wrappedResult = result;
  if (nativeInBuy && feeWrapperAddress && result) {
    wrappedResult = wrapNativeBuyTxWithFeeWrapper(result as UnsignedSwapTx, chain, query.amountIn);
  } else if (wrapSellWithPermit2 && feeWrapperAddress && result) {
    wrappedResult = wrapTokenSellTxWithPermit2FeeWrapper(result as UnsignedSwapTx, chain, query.walletAddress, query.tokenIn, query.amountIn);
  } else if (wrapSellWithLegacy && feeWrapperAddress && result) {
    wrappedResult = wrapTokenSellTxWithFeeWrapper(result as UnsignedSwapTx, chain, query.walletAddress, query.tokenIn, query.amountIn);
  }

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

export async function getApproveTx(query: ApproveQuery): Promise<ApproveResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const entry = resolveDex(query.dex);
  if (!entry) {
    return {
      endpoint: "approve",
      status: "partial",
      chain,
      dex: query.dex,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      approvalMode: query.approvalMode,
      resolvedMode: "none",
      spender: null,
      steps: [],
      notes: [`Unknown dex \"${query.dex}\". Available: ${DEX_REGISTRY.map((d) => d.id).join(", ")}`],
      providers: [{ provider: query.dex, status: "error", detail: `Unknown dex \"${query.dex}\".` }],
    };
  }

  if (!isEvmChain(chain)) {
    return {
      endpoint: "approve",
      status: "partial",
      chain,
      dex: entry.id,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      approvalMode: query.approvalMode,
      resolvedMode: "none",
      spender: null,
      steps: [],
      notes: ["/approve currently supports EVM chains only."],
      providers,
    };
  }

  if (isNativeIn(query.tokenIn)) {
    return {
      endpoint: "approve",
      status: "live",
      chain,
      dex: entry.id,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      approvalMode: query.approvalMode,
      resolvedMode: "none",
      spender: null,
      steps: [],
      notes: ["Native input does not require token approval."],
      providers,
    };
  }

  const spenderOverride = query.spender;
  const directSpender = spenderOverride ?? DEX_SPENDERS[entry.id]?.[chain];
  const nativeOutSell = !isNativeIn(query.tokenIn) && isNativeIn(query.tokenOut);
  const feeWrapperAddress = nativeOutSell ? getEvmFeeWrapperAddress(chain) : null;
  const approvalMode = query.approvalMode;
  const resolvedMode = approvalMode === "auto"
    ? (feeWrapperAddress ? "erc20" : entry.id === "uniswapV4" ? "permit2" : "erc20")
    : approvalMode;

  if (!feeWrapperAddress && !directSpender) {
    return {
      endpoint: "approve",
      status: "partial",
      chain,
      dex: entry.id,
      tokenIn: query.tokenIn,
      tokenOut: query.tokenOut,
      approvalMode,
      resolvedMode: "none",
      spender: null,
      steps: [],
      notes: ["Could not resolve an approval spender for this dex/chain pair."],
      providers,
    };
  }

  const steps: ApproveResponse["steps"] = [];
  const notes: string[] = [];

  if (approvalMode === "auto" && feeWrapperAddress) {
    steps.push({
      kind: "erc20",
      label: "Approve fee wrapper to pull tokenIn",
      spender: feeWrapperAddress,
      tx: buildErc20ApproveTx(chain, query.walletAddress, query.tokenIn, feeWrapperAddress),
    });
    notes.push("Auto mode matched the current /swap sell path and resolved to fee-wrapper approval.");
  } else if (resolvedMode === "permit2") {
    const spender = directSpender!;
    steps.push({
      kind: "erc20",
      label: "Approve Permit2 to pull tokenIn",
      spender: PERMIT2_ADDRESS,
      tx: buildErc20ApproveTx(chain, query.walletAddress, query.tokenIn, PERMIT2_ADDRESS),
    });
    steps.push({
      kind: "permit2",
      label: "Approve router inside Permit2",
      spender,
      tx: buildPermit2ApproveTx(
        chain,
        query.walletAddress,
        query.tokenIn,
        spender,
        query.amount ? BigInt(query.amount) : undefined,
        query.expiration ? BigInt(query.expiration) : undefined,
      ),
    });
    notes.push("Sign the Permit2 approval after the ERC20 approval unless the token is already approved to Permit2.");
  } else {
    const spender = feeWrapperAddress ?? directSpender!;
    steps.push({
      kind: "erc20",
      label: spender === feeWrapperAddress ? "Approve fee wrapper to pull tokenIn" : "Approve router to pull tokenIn",
      spender,
      tx: buildErc20ApproveTx(chain, query.walletAddress, query.tokenIn, spender),
    });
  }

  return {
    endpoint: "approve",
    status: "live",
    chain,
    dex: entry.id,
    tokenIn: query.tokenIn,
    tokenOut: query.tokenOut,
    approvalMode,
    resolvedMode,
    spender: steps[steps.length - 1]?.spender ?? null,
    steps,
    notes,
    providers,
  };
}

export type SwapDexesResponse = {
  endpoint: "swapDexes";
  chain: string;
  dexes: Array<{ id: string; label: string }>;
};
