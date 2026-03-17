/**
 * Uniswap V3 – Ethereum (chain 1)
 *
 * Builds unsigned swap txs against SwapRouter02 on mainnet.
 * Resolves the fee tier from the main (highest-liquidity) DexScreener pair,
 * then quotes via QuoterV2.
 */

import { getRequiredEnv } from "#config/env";
import { requestJson } from "#lib/http";
import { getTokenPairs } from "#providers/market/dexScreener";
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

const CHAIN_ID = EVM_CHAIN_IDS.eth;
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"; // SwapRouter02 on ETH mainnet
const QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // QuoterV2 on ETH mainnet
const FALLBACK_FEES = [3000, 500, 10000, 100] as const;

/* ── Fee-tier resolution via DexScreener + on-chain ───────── */

async function readPoolFee(poolAddress: string): Promise<number> {
  const rpcUrl = getRequiredEnv("ETH_RPC_URL");
  const result = await requestJson<{ result?: string }>(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: poolAddress, data: "0xddca3f43" }, "latest"],
    }),
  });
  if (!result.result || result.result === "0x") {
    throw new Error("Could not read fee() from pool " + poolAddress);
  }
  return Number(BigInt(result.result));
}

async function resolveMainPoolFee(
  tokenIn: string,
  tokenOut: string,
): Promise<number | null> {
  const pairs = await getTokenPairs("eth", tokenOut);
  const v3Pairs = pairs
    .filter(
      (p) =>
        p.chainId === "ethereum" &&
        p.dexId?.toLowerCase() === "uniswap" &&
        (p.labels ?? []).some((l) => l.toLowerCase() === "v3") &&
        [p.baseToken?.address, p.quoteToken?.address]
          .filter((a): a is string => !!a)
          .some((a) => a.toLowerCase() === tokenIn.toLowerCase() || a.toLowerCase() === WRAPPED_NATIVE.eth.toLowerCase()),
    )
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  if (v3Pairs.length === 0) return null;

  try {
    return await readPoolFee(v3Pairs[0].pairAddress);
  } catch {
    return null;
  }
}

/* ── QuoterV2 ─────────────────────────────────────────────── */

async function quoteExactInputSingle(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<bigint> {
  const rpcUrl = getRequiredEnv("ETH_RPC_URL");
  const data = buildCalldata(
    selector("c6a5026a"),
    padAddress(tokenIn),
    padAddress(tokenOut),
    encodeUint256(amountIn),
    encodeUint256(BigInt(fee)),
    encodeUint256(0n),
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
    throw new Error("QuoterV2 returned empty – pool may not exist for this fee tier");
  }

  return BigInt("0x" + result.result.replace(/^0x/, "").slice(0, 64));
}

async function resolveFeeTier(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  preferredFee?: number,
): Promise<{ fee: number; amountOut: bigint }> {
  // 1. Try to get the fee from the main DexScreener pair
  const mainFee = await resolveMainPoolFee(tokenIn, tokenOut);
  if (mainFee) {
    try {
      const amountOut = await quoteExactInputSingle(tokenIn, tokenOut, amountIn, mainFee);
      return { fee: mainFee, amountOut };
    } catch { /* fall through to fallback */ }
  }

  // 2. Fallback: try common fees in order (for tokens not on DexScreener yet)
  const candidates = preferredFee
    ? [preferredFee, ...FALLBACK_FEES.filter((f) => f !== preferredFee)]
    : [...FALLBACK_FEES];

  let lastError: Error | null = null;
  for (const fee of candidates) {
    try {
      const amountOut = await quoteExactInputSingle(tokenIn, tokenOut, amountIn, fee);
      return { fee, amountOut };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No V3 pool found for this token pair on any fee tier");
}

/* ── Build unsigned swap TX ──────────────────────────────── */

export async function buildSwapTx(params: SwapParams, fee = 3000): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.eth;
  const actualTokenIn = nativeIn ? weth : tokenIn;

  const resolved = await resolveFeeTier(actualTokenIn, tokenOut, amtIn, fee);
  const amountOutMin = applySlippage(resolved.amountOut, slippageBps);

  const calldata = buildCalldata(
    selector("04e45aaf"),
    padAddress(actualTokenIn),
    padAddress(tokenOut),
    encodeUint256(BigInt(resolved.fee)),
    padAddress(walletAddress),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    encodeUint256(0n),
  );

  return {
    to: ROUTER,
    data: calldata,
    value: nativeIn ? "0x" + amtIn.toString(16) : "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
  fee = 3000,
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const weth = WRAPPED_NATIVE.eth;
  const actualIn = isNativeIn(tokenIn) ? weth : tokenIn;
  const resolved = await resolveFeeTier(actualIn, tokenOut, BigInt(amountIn), fee);
  return {
    amountOut: resolved.amountOut.toString(),
    amountOutMin: applySlippage(resolved.amountOut, slippageBps).toString(),
    fee: resolved.fee,
  };
}
