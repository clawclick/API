/**
 * Uniswap V4 – Ethereum (chain 1)
 *
 * Builds unsigned swap txs via the V4 Universal Router on ETH mainnet.
 * V4 uses a PoolManager with hook-based pools. Swaps go through the
 * Universal Router's `execute()` with V4_SWAP command.
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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203";
const INITIALIZE_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const WRAP_ETH_COMMAND = "0b";
const V4_SWAP_COMMAND = "10";
const ACTION_SWAP_EXACT_IN_SINGLE = "06";
const ACTION_SETTLE = "0b";
const ACTION_SETTLE_ALL = "0c";
const ACTION_TAKE = "0e";
const ADDRESS_THIS = "0000000000000000000000000000000000000002";
const QUOTE_EXACT_INPUT_SINGLE_SELECTOR = "aa9d21cb";
const EXECUTE_SELECTOR = "3593564c";
const CONTRACT_BALANCE =
  "0x8000000000000000000000000000000000000000000000000000000000000000";

type DexPair = Awaited<ReturnType<typeof getTokenPairs>>[number];
type PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};
type ResolvedV4Pool = {
  pair: DexPair;
  poolId: string;
  poolKey: PoolKey;
  inputCurrency: string;
  zeroForOne: boolean;
};

const poolKeyCache = new Map<string, PoolKey>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function isAddressEqual(left: string, right: string): boolean {
  return normalizeAddress(left) === normalizeAddress(right);
}

function stripHexPrefix(value: string): string {
  return value.replace(/^0x/, "");
}

function encodeBytes(data: string): string {
  const raw = stripHexPrefix(data);
  const padded = raw.padEnd(Math.ceil(raw.length / 64) * 64, "0");
  return encodeUint256(BigInt(raw.length / 2)) + padded;
}

function encodeBool(value: boolean): string {
  return encodeUint256(value ? 1n : 0n);
}

function encodeInt24(value: number): string {
  const normalized = BigInt.asUintN(24, BigInt(value));
  return encodeUint256(normalized);
}

function encodeBytesArray(items: string[]): string {
  const encodedItems = items.map((item) => encodeBytes(item));
  const headSize = BigInt(items.length * 32);
  let currentOffset = headSize;
  const heads: string[] = [];
  for (const encodedItem of encodedItems) {
    heads.push(encodeUint256(currentOffset));
    currentOffset += BigInt(encodedItem.length / 2);
  }
  return encodeUint256(BigInt(items.length)) + heads.join("") + encodedItems.join("");
}

function encodeDynamicTuple(items: string[]): string {
  const headSize = BigInt(items.length * 32);
  let currentOffset = headSize;
  const heads: string[] = [];
  for (const item of items) {
    heads.push(encodeUint256(currentOffset));
    currentOffset += BigInt(item.length / 2);
  }
  return heads.join("") + items.join("");
}

function wrapSingleDynamic(body: string): string {
  return encodeUint256(32n) + body;
}

function toHexBlock(blockNumber: number): string {
  return `0x${blockNumber.toString(16)}`;
}

function parseBlockNumber(value?: string): number {
  if (!value) throw new Error("Missing block number in RPC response");
  return Number(BigInt(value));
}

function parseTimestamp(value?: string): number {
  if (!value) throw new Error("Missing block timestamp in RPC response");
  return Number(BigInt(value));
}

function decodeSignedInt24(word: string): number {
  const value = Number(BigInt(`0x${word.slice(-6)}`));
  return value >= 0x800000 ? value - 0x1000000 : value;
}

function normalizePairCreatedAt(value: number | undefined): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function isEthUniswapV4Pair(pair: DexPair): boolean {
  return (
    pair.chainId === "ethereum" &&
    pair.dexId?.toLowerCase() === "uniswap" &&
    (pair.labels ?? []).some((label) => label.toLowerCase() === "v4") &&
    pair.pairAddress.length === 66
  );
}

function pairContainsInput(pair: DexPair, tokenOut: string, tokenIn: string, nativeIn: boolean): boolean {
  const tokens = [pair.baseToken?.address, pair.quoteToken?.address].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const containsOut = tokens.some((value) => isAddressEqual(value, tokenOut));
  const containsIn = tokens.some((value) => isAddressEqual(value, tokenIn));
  const containsWrappedNative = nativeIn && tokens.some((value) => isAddressEqual(value, WRAPPED_NATIVE.eth));
  return containsOut && (containsIn || containsWrappedNative);
}

function byLiquidityDesc(left: DexPair, right: DexPair): number {
  return (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0);
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const rpcUrl = getRequiredEnv("ETH_RPC_URL");
  return requestJson<T>(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function getLatestBlock(): Promise<{ number: number; timestamp: number }> {
  const block = await rpcCall<{ result?: { number?: string; timestamp?: string } }>("eth_getBlockByNumber", ["latest", false]);
  return {
    number: parseBlockNumber(block.result?.number),
    timestamp: parseTimestamp(block.result?.timestamp),
  };
}

async function getInitializeLogs(poolId: string, fromBlock: number, toBlock: number): Promise<Array<{ topics?: string[]; data?: string }>> {
  const response = await rpcCall<{ result?: Array<{ topics?: string[]; data?: string }> }>("eth_getLogs", [{
    address: POOL_MANAGER,
    fromBlock: toHexBlock(fromBlock),
    toBlock: toHexBlock(toBlock),
    topics: [INITIALIZE_TOPIC, poolId],
  }]);
  return response.result ?? [];
}

function decodeInitializeLog(poolId: string, log: { topics?: string[]; data?: string }): PoolKey {
  const topics = log.topics ?? [];
  const data = stripHexPrefix(log.data ?? "0x");
  if (topics.length < 4 || data.length < 64 * 5) {
    throw new Error(`Malformed Initialize log for pool ${poolId}`);
  }

  const feeWord = data.slice(0, 64);
  const tickSpacingWord = data.slice(64, 128);
  const hooksWord = data.slice(128, 192);

  return {
    currency0: `0x${topics[2].slice(-40)}`,
    currency1: `0x${topics[3].slice(-40)}`,
    fee: Number(BigInt(`0x${feeWord}`)),
    tickSpacing: decodeSignedInt24(tickSpacingWord),
    hooks: `0x${hooksWord.slice(-40)}`,
  };
}

async function getBlockTimestamp(blockNumber: number): Promise<number> {
  const block = await rpcCall<{ result?: { timestamp?: string } }>("eth_getBlockByNumber", [toHexBlock(blockNumber), false]);
  return parseTimestamp(block.result?.timestamp);
}

async function findBlockByTimestamp(targetTimestamp: number, latestBlock: { number: number; timestamp: number }): Promise<number> {
  let lo = 0;
  let hi = latestBlock.number;
  // Initial estimate using average block time (~12s on ETH)
  const avgBlockTime = (latestBlock.timestamp - (await getBlockTimestamp(Math.max(0, latestBlock.number - 10_000)))) / 10_000;
  const estimate = Math.max(0, Math.min(hi, latestBlock.number - Math.floor((latestBlock.timestamp - targetTimestamp) / avgBlockTime)));
  lo = Math.max(0, estimate - 100_000);
  hi = Math.min(latestBlock.number, estimate + 100_000);

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const ts = await getBlockTimestamp(mid);
    if (ts < targetTimestamp) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

async function scanForInitializeLog(poolId: string, start: number, end: number, chunkSize = 10): Promise<PoolKey | null> {
  for (let fromBlock = start; fromBlock <= end; fromBlock += chunkSize) {
    const toBlock = Math.min(end, fromBlock + chunkSize - 1);
    const logs = await getInitializeLogs(poolId, fromBlock, toBlock);
    if (logs.length > 0) {
      const poolKey = decodeInitializeLog(poolId, logs[0]);
      poolKeyCache.set(poolId, poolKey);
      return poolKey;
    }
  }
  return null;
}

async function resolvePoolKey(poolId: string, pairCreatedAt?: number): Promise<PoolKey> {
  const cached = poolKeyCache.get(poolId);
  if (cached) return cached;

  const latestBlock = await getLatestBlock();
  const createdAt = normalizePairCreatedAt(pairCreatedAt);

  if (createdAt) {
    const targetBlock = await findBlockByTimestamp(createdAt, latestBlock);
    // Tight scan ±200 blocks in 10-block chunks
    const result = await scanForInitializeLog(poolId, Math.max(0, targetBlock - 200), Math.min(latestBlock.number, targetBlock + 200));
    if (result) return result;
    // Widen to ±2000
    const wide = await scanForInitializeLog(poolId, Math.max(0, targetBlock - 2000), Math.min(latestBlock.number, targetBlock + 2000));
    if (wide) return wide;
  }

  // Fallback: scan recent 10K blocks
  const fallback = await scanForInitializeLog(poolId, Math.max(0, latestBlock.number - 10_000), latestBlock.number);
  if (fallback) return fallback;

  throw new Error(`Unable to resolve Uniswap V4 PoolKey for pool id ${poolId}`);
}

function encodeQuoteExactInputSingle(poolKey: PoolKey, zeroForOne: boolean, amountIn: bigint): string {
  const hookData = encodeBytes("0x");
  const structBody = [
    padAddress(poolKey.currency0),
    padAddress(poolKey.currency1),
    encodeUint256(BigInt(poolKey.fee)),
    encodeInt24(poolKey.tickSpacing),
    padAddress(poolKey.hooks),
    encodeBool(zeroForOne),
    encodeUint256(amountIn),
    encodeUint256(256n),
    hookData,
  ].join("");

  return buildCalldata(selector(QUOTE_EXACT_INPUT_SINGLE_SELECTOR), wrapSingleDynamic(structBody));
}

async function quoteExactInputSingle(poolKey: PoolKey, zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const data = encodeQuoteExactInputSingle(poolKey, zeroForOne, amountIn);
  const result = await rpcCall<{ result?: string }>("eth_call", [{ to: V4_QUOTER, data }, "latest"]);

  if (!result.result || result.result === "0x") {
    throw new Error("V4 quoter returned empty result");
  }

  return BigInt(`0x${stripHexPrefix(result.result).slice(0, 64)}`);
}

async function resolveDexScreenerPool(tokenIn: string, tokenOut: string, nativeIn: boolean): Promise<ResolvedV4Pool> {
  // For sells (tokenOut = WETH), look up the non-native token so DexScreener returns relevant pairs
  const lookupToken = isAddressEqual(tokenOut, WRAPPED_NATIVE.eth) ? tokenIn : tokenOut;
  const pairs = (await getTokenPairs("eth", lookupToken))
    .filter((pair) => isEthUniswapV4Pair(pair) && pairContainsInput(pair, tokenOut, tokenIn, nativeIn))
    .sort(byLiquidityDesc);

  const pair = pairs[0];
  if (!pair) {
    throw new Error(`DexScreener did not return a direct ETH Uniswap V4 pool for ${lookupToken}`);
  }

  const poolId = pair.pairAddress.toLowerCase();
  const poolKey = await resolvePoolKey(poolId, pair.pairCreatedAt);
  const usesNative = isAddressEqual(poolKey.currency0, ZERO_ADDRESS) || isAddressEqual(poolKey.currency1, ZERO_ADDRESS);
  const inputCurrency = nativeIn && usesNative ? ZERO_ADDRESS : tokenIn;

  if (!isAddressEqual(inputCurrency, poolKey.currency0) && !isAddressEqual(inputCurrency, poolKey.currency1)) {
    throw new Error(`Resolved V4 PoolKey for ${poolId} does not include input currency ${inputCurrency}`);
  }

  return {
    pair,
    poolId,
    poolKey,
    inputCurrency,
    zeroForOne: isAddressEqual(inputCurrency, poolKey.currency0),
  };
}

function encodeExactInputSingleAction(
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  amountOutMin: bigint,
): string {
  const hookData = encodeBytes("0x");
  const structBody = [
    padAddress(poolKey.currency0),
    padAddress(poolKey.currency1),
    encodeUint256(BigInt(poolKey.fee)),
    encodeInt24(poolKey.tickSpacing),
    padAddress(poolKey.hooks),
    encodeBool(zeroForOne),
    encodeUint256(amountIn),
    encodeUint256(amountOutMin),
    encodeUint256(288n),
    hookData,
  ].join("");

  return wrapSingleDynamic(structBody);
}

function encodeV4SwapInput(actions: string, params: string[]): string {
  const encodedActions = encodeBytes(actions);
  const encodedParams = encodeBytesArray(params);
  return `0x${encodeDynamicTuple([encodedActions, encodedParams])}`;
}

function buildUniversalRouterCalldata(commands: string, inputs: string[], deadline: number): string {
  const encodedCommands = encodeBytes(commands);
  const encodedInputs = encodeBytesArray(inputs);
  const argsHead = [
    encodeUint256(96n),
    encodeUint256(96n + BigInt(encodedCommands.length / 2)),
    encodeUint256(BigInt(deadline)),
  ].join("");
  return buildCalldata(selector(EXECUTE_SELECTOR), argsHead, encodedCommands, encodedInputs);
}

function typeCastMaxUint256(): bigint {
  return (1n << 256n) - 1n;
}

/* ── Build unsigned swap TX ──────────────────────────────── */

export async function buildSwapTx(params: SwapParams, fee = 3000): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const recipient = params.recipient ?? walletAddress;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const actualTokenIn = nativeIn ? WRAPPED_NATIVE.eth : tokenIn;
  const actualTokenOut = isNativeIn(tokenOut) ? WRAPPED_NATIVE.eth : tokenOut;
  const resolvedPool = await resolveDexScreenerPool(actualTokenIn, actualTokenOut, nativeIn);
  const amountOut = await quoteExactInputSingle(resolvedPool.poolKey, resolvedPool.zeroForOne, amtIn);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  const swapAction = encodeExactInputSingleAction(
    resolvedPool.poolKey,
    resolvedPool.zeroForOne,
    amtIn,
    amountOutMin,
  );

  const outputCurrency = resolvedPool.zeroForOne ? resolvedPool.poolKey.currency1 : resolvedPool.poolKey.currency0;
  const wrapNativeToWeth = nativeIn && isAddressEqual(resolvedPool.inputCurrency, WRAPPED_NATIVE.eth);
  const actions = wrapNativeToWeth
    ? `${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE}${ACTION_TAKE}`
    : `${ACTION_SWAP_EXACT_IN_SINGLE}${ACTION_SETTLE_ALL}${ACTION_TAKE}`;
  const v4Params = wrapNativeToWeth
    ? [
        swapAction,
        `0x${padAddress(resolvedPool.inputCurrency)}${encodeUint256(0n)}${encodeBool(false)}`,
        `0x${padAddress(outputCurrency)}${padAddress(recipient)}${encodeUint256(0n)}`,
      ]
    : [
        swapAction,
        `0x${padAddress(resolvedPool.inputCurrency)}${encodeUint256(typeCastMaxUint256())}`,
        `0x${padAddress(outputCurrency)}${padAddress(recipient)}${encodeUint256(0n)}`,
      ];
  const v4Input = encodeV4SwapInput(`0x${actions}`, v4Params);

  const commands = wrapNativeToWeth ? `${WRAP_ETH_COMMAND}${V4_SWAP_COMMAND}` : V4_SWAP_COMMAND;
  const inputs = wrapNativeToWeth
    ? [
        `0x${padAddress(ADDRESS_THIS)}${encodeUint256(amtIn)}`,
        v4Input,
      ]
    : [v4Input];
  const calldata = buildUniversalRouterCalldata(`0x${commands}`, inputs, dl);

  return {
    to: UNIVERSAL_ROUTER,
    data: calldata,
    value: nativeIn ? "0x" + amtIn.toString(16) : "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
    gasLimit: "0x1e8480",  // 2 000 000
  };
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
  fee = 3000,
): Promise<{ amountOut: string; amountOutMin: string; fee: number }> {
  const nativeIn = isNativeIn(tokenIn);
  const actualIn = nativeIn ? WRAPPED_NATIVE.eth : tokenIn;
  const actualOut = isNativeIn(tokenOut) ? WRAPPED_NATIVE.eth : tokenOut;
  const resolvedPool = await resolveDexScreenerPool(actualIn, actualOut, nativeIn);
  const out = await quoteExactInputSingle(resolvedPool.poolKey, resolvedPool.zeroForOne, BigInt(amountIn));
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
    fee: resolvedPool.poolKey.fee,
  };
}
