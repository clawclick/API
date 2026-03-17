import { getOptionalEnv, isConfigured } from "#config/env";

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

const EVM_FEE_DENOMINATOR = 10_000n;
const EVM_PROTOCOL_FEE_BPS_DEFAULT = "10";

export function getEvmFeeWrapperAddress(chain: string): string | null {
  const envName = `${chain.toUpperCase()}_FEE_WRAPPER_ADDRESS`;
  const value = getOptionalEnv(envName);
  return isConfigured(value) ? value : null;
}

export function getEvmProtocolFeeBps(): bigint {
  const raw = getOptionalEnv("EVM_PROTOCOL_FEE_BPS", EVM_PROTOCOL_FEE_BPS_DEFAULT);
  const feeBps = Number(raw);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) {
    throw new Error(`EVM_PROTOCOL_FEE_BPS must be an integer between 0 and 100. Received: ${raw}`);
  }
  return BigInt(feeBps);
}

export function subtractProtocolFee(amount: bigint, feeBps = getEvmProtocolFeeBps()): bigint {
  return amount - ((amount * feeBps) / EVM_FEE_DENOMINATOR);
}

function encodeBytes(data: string): string {
  const raw = data.replace(/^0x/, "");
  const padded = raw.padEnd(Math.ceil(raw.length / 64) * 64, "0");
  return encodeUint256(BigInt(raw.length / 2)) + padded;
}

export function wrapNativeBuyTxWithFeeWrapper(
  tx: UnsignedSwapTx,
  chain: string,
  totalAmountIn: string,
): UnsignedSwapTx {
  const wrapper = getEvmFeeWrapperAddress(chain);
  if (!wrapper) {
    return tx;
  }

  const calldata = buildCalldata(
    selector("f3437c19"),
    padAddress(tx.to),
    encodeUint256(64n),
    encodeBytes(tx.data),
  );

  return {
    ...tx,
    to: wrapper,
    data: calldata,
    value: `0x${BigInt(totalAmountIn).toString(16)}`,
  };
}

/* ── Unwrap WETH/WBNB → native ─────────────────────────────── */

/**
 * Build an unsigned TX that calls WETH.withdraw(amount) to unwrap
 * wrapped native tokens back to ETH / BNB.
 * withdraw(uint256 wad) selector: 0x2e1a7d4d
 */
export function buildUnwrapTx(
  chain: string,
  walletAddress: string,
  amount: string,
): UnsignedSwapTx {
  const weth = WRAPPED_NATIVE[chain];
  if (!weth) throw new Error(`Unsupported chain for unwrap: ${chain}`);

  const calldata = buildCalldata(
    selector("2e1a7d4d"),
    encodeUint256(BigInt(amount)),
  );

  return {
    to: weth,
    data: calldata,
    value: "0x0",
    chainId: EVM_CHAIN_IDS[chain] ?? 1,
    from: walletAddress,
  };
}
