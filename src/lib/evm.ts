/**
 * Shared EVM utilities for building unsigned swap transactions.
 *
 * All functions encode calldata for on-chain router contracts and return
 * an UnsignedSwapTx object the caller signs & submits themselves.
 * We never accept or handle private keys.
 */

/* ── Chain IDs ─────────────────────────────────────────────── */

export const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  base: 8453,
  bsc: 56,
};

/* ── Types ─────────────────────────────────────────────────── */

export type UnsignedSwapTx = {
  to: string;
  data: string;
  value: string;        // hex wei (e.g. "0x0" for non-native)
  chainId: number;
  from: string;
  gasLimit?: string;     // hex – optional estimate
};

export type SwapParams = {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;      // raw wei / lamport string
  slippageBps: number;   // basis points, e.g. 50 = 0.5 %
  deadline?: number;     // unix seconds (default: now + 20 min)
};

/* ── ABI encoding helpers (zero-dep) ───────────────────────── */

/** Pad a 20-byte address to 32-byte word (left-pad with zeros). */
export function padAddress(addr: string): string {
  return addr.replace(/^0x/, "").padStart(64, "0");
}

/** Encode a uint256 as a 32-byte hex word. */
export function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** Keccak-256 is not available without a dep.  We use the first 4 bytes of
 *  a known selector string directly (pre-computed). */
export function selector(hex4: string): string {
  return hex4.replace(/^0x/, "");
}

/** Concatenate parts into a full calldata hex string. */
export function buildCalldata(sel: string, ...words: string[]): string {
  return "0x" + sel + words.join("");
}

/** Calculate minimum amount out given slippage in basis points. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Default deadline = now + 20 minutes. */
export function defaultDeadline(overrideSec?: number): number {
  return overrideSec ?? Math.floor(Date.now() / 1000) + 1200;
}

/* ── WETH / WBNB addresses ─────────────────────────────────── */

export const WRAPPED_NATIVE: Record<string, string> = {
  eth:  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  base: "0x4200000000000000000000000000000000000006",
  bsc:  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
};

/** Returns true when tokenIn is the zero address or "ETH"/"BNB"/"native" sentinel. */
export function isNativeIn(tokenIn: string): boolean {
  const t = tokenIn.toLowerCase();
  return (
    t === "0x0000000000000000000000000000000000000000" ||
    t === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
    t === "native" ||
    t === "eth" ||
    t === "bnb"
  );
}
