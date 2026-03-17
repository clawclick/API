/**
 * PancakeSwap V3 – BSC (chain 56)
 *
 * Builds unsigned swap txs against PancakeSwap's V3-style SmartRouter on BNB Chain.
 * Uses exactInputSingle for single-hop concentrated-liquidity swaps.
 * Resolves the fee tier from the main (highest-liquidity) DexScreener pair.
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

const CHAIN_ID = EVM_CHAIN_IDS.bsc;
const ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"; // PancakeSwap V3 SmartRouter on BSC
const QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"; // PancakeSwap QuoterV2 on BSC
const FALLBACK_FEES = [2500, 500, 10000, 100] as const;

/* ── Fee-tier resolution via DexScreener + on-chain ───────── */

async function readPoolFee(poolAddress: string): Promise<number> {
  const rpcUrl = getRequiredEnv("BSC_RPC_URL");
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
  const lookupToken = tokenOut.toLowerCase() === WRAPPED_NATIVE.bsc.toLowerCase() ? tokenIn : tokenOut;
  const pairs = await getTokenPairs("bsc", lookupToken);
  const v3Pairs = pairs
    .filter(
      (p) =>
        p.chainId === "bsc" &&
        p.dexId?.toLowerCase() === "pancakeswap" &&
        (p.labels ?? []).some((l) => l.toLowerCase() === "v3") &&
        [p.baseToken?.address, p.quoteToken?.address]
          .filter((a): a is string => !!a)
          .some((a) => a.toLowerCase() === tokenIn.toLowerCase() || a.toLowerCase() === WRAPPED_NATIVE.bsc.toLowerCase()),
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
  const rpcUrl = getRequiredEnv("BSC_RPC_URL");

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

/* ── Build unsigned swap TX ──────────────────────────────── */

export async function buildSwapTx(params: SwapParams): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualTokenIn = nativeIn ? wbnb : tokenIn;
  const actualTokenOut = isNativeIn(tokenOut) ? wbnb : tokenOut;

  const resolvedFee = await resolveMainPoolFee(actualTokenIn, actualTokenOut);
  const feesToTry = resolvedFee ? [resolvedFee] : [...FALLBACK_FEES];
  let amountOut: bigint | null = null;
  let fee = feesToTry[0];
  for (const f of feesToTry) {
    try {
      amountOut = await quoteExactInputSingle(actualTokenIn, actualTokenOut, amtIn, f);
      fee = f;
      break;
    } catch { /* try next */ }
  }
  if (amountOut === null) throw new Error("No PancakeSwap V3 pool found for this pair");
  const amountOutMin = applySlippage(amountOut, slippageBps);

  // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
  const calldata = buildCalldata(
    selector("04e45aaf"),
    padAddress(actualTokenIn),
    padAddress(actualTokenOut),
    encodeUint256(BigInt(fee)),
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
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const wbnb = WRAPPED_NATIVE.bsc;
  const actualIn = isNativeIn(tokenIn) ? wbnb : tokenIn;
  const actualOut = isNativeIn(tokenOut) ? wbnb : tokenOut;

  const resolvedFee = await resolveMainPoolFee(actualIn, actualOut);
  const feesToTry = resolvedFee ? [resolvedFee] : [...FALLBACK_FEES];
  let out: bigint | null = null;
  let fee = feesToTry[0];
  for (const f of feesToTry) {
    try {
      out = await quoteExactInputSingle(actualIn, actualOut, BigInt(amountIn), f);
      fee = f;
      break;
    } catch { /* try next */ }
  }
  if (out === null) throw new Error("No PancakeSwap V3 pool found for this pair");
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
    fee,
  };
}
