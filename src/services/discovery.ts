import { addStatus, runProvider, summarizeStatus } from "#lib/runProvider";
import { normalizeChain, isEvmChain } from "#providers/shared/chains";
import { searchPairs, getLatestBoosts } from "#providers/market/dexScreener";
import { getTopTraders as getBirdeyeTopTraders, isBirdeyeConfigured } from "#providers/market/birdeye";
import { getTop as getEthplorerTop, isEthplorerConfigured, type EthplorerGetTopToken } from "#providers/market/ethplorer";
import { getLatestTokenProfiles } from "#providers/newPairs/dexScreenerNewPairs";
import { getCurrentlyLive } from "#providers/newPairs/pumpFun";
import { getNewPools } from "#providers/newPairs/raydiumNewPools";
import { getLatestPools } from "#providers/newPairs/uniswapPairCreation";
import { isEtherscanConfigured, getGasOracle } from "#providers/onchain/etherscan";
import { getBlockNumber, getFeeHistory, getGasPrice } from "#providers/onchain/rpc";
import type { GasFeedQuery, GetTopEthTokensQuery, NewPairsQuery, TokenSearchQuery, TopTradersQuery } from "#routes/helpers";
import type {
  GasFeedResponse,
  GetTopEthToken,
  GetTopEthTokensResponse,
  NewPairItem,
  NewPairsResponse,
  ProviderStatus,
  TokenSearchResponse,
  TopTradersResponse,
  TrendingToken,
  TrendingTokensResponse,
} from "#types/api";

type GetTopEthTokensCacheEntry = {
  data: GetTopEthTokensResponse;
  expiresAt: number;
};

const getTopEthTokensCache = new Map<string, GetTopEthTokensCacheEntry>();
const GET_TOP_ETH_TOKENS_CACHE_TTL_MS = 10 * 60 * 1000;

function getTopEthTokensCacheKey(q: GetTopEthTokensQuery): string {
  return JSON.stringify({ criteria: q.criteria, limit: q.limit });
}

/* ────────────────────────────────────────────────────────────
   GET /trendingTokens
   Aggregates DexScreener boosted tokens (promoted/trending).
   ──────────────────────────────────────────────────────────── */

export async function getTrendingTokens(): Promise<TrendingTokensResponse> {
  const statuses: ProviderStatus[] = [];

  const boosts = await runProvider(statuses, "dexScreener:boosts", true, () => getLatestBoosts());

  const tokens: TrendingToken[] = [];

  if (boosts) {
    for (const b of boosts) {
      tokens.push({
        chainId: b.chainId ?? null,
        tokenAddress: b.tokenAddress ?? null,
        name: null,
        symbol: null,
        priceUsd: null,
        volume24hUsd: null,
        liquidityUsd: null,
        priceChange24hPct: null,
        fdvUsd: null,
        marketCapUsd: null,
        boostAmount: b.totalAmount ?? null,
        pairAddress: null,
        dex: null,
        source: "dexScreener:boosts",
      });
    }
  }

  return {
    endpoint: "trendingTokens",
    status: summarizeStatus(statuses),
    tokens,
    providers: statuses,
  };
}

/* ────────────────────────────────────────────────────────────
   GET /getTopEthTokens
   Top Ethereum tokens from Ethplorer with a 10-minute cache.
   ──────────────────────────────────────────────────────────── */

export async function getTopEthTokens(q: GetTopEthTokensQuery): Promise<GetTopEthTokensResponse> {
  const cacheKey = getTopEthTokensCacheKey(q);
  const cached = getTopEthTokensCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];
  const data = await runProvider(
    statuses,
    "ethplorer:getTop",
    isEthplorerConfigured(),
    () => getEthplorerTop(q.criteria, q.limit),
    "Ethplorer API key not configured.",
  );

  const tokens: GetTopEthToken[] = (data?.tokens ?? []).map((token: EthplorerGetTopToken) => {
    const raw = token as Record<string, unknown>;
    const price = token.price && typeof token.price === "object"
      ? {
          rate: token.price.rate ?? null,
          currency: token.price.currency ?? null,
          diff: token.price.diff ?? null,
          diff7d: token.price.diff7d ?? null,
          diff30d: token.price.diff30d ?? null,
          marketCapUsd: token.price.marketCapUsd ?? null,
          availableSupply: token.price.availableSupply ?? null,
          volume24h: token.price.volume24h ?? null,
          ts: token.price.ts ?? null,
        }
      : null;

    return {
      ...raw,
      address: token.address ?? null,
      totalSupply: token.totalSupply ?? null,
      name: token.name ?? null,
      symbol: token.symbol ?? null,
      decimals: token.decimals ?? null,
      price,
      owner: token.owner ?? null,
      contractInfo: token.contractInfo
        ? {
            creatorAddress: token.contractInfo.creatorAddress ?? null,
            creationTransactionHash: token.contractInfo.creationTransactionHash ?? null,
            creationTimestamp: token.contractInfo.creationTimestamp ?? null,
          }
        : null,
      countOps: token.countOps ?? null,
      txsCount: token.txsCount ?? null,
      totalIn: token.totalIn ?? null,
      totalOut: token.totalOut ?? null,
      transfersCount: token.transfersCount ?? null,
      ethTransfersCount: token.ethTransfersCount ?? null,
      holdersCount: token.holdersCount ?? null,
      image: token.image ?? null,
      website: token.website ?? null,
      lastUpdated: token.lastUpdated ?? null,
    };
  });

  const response: GetTopEthTokensResponse = {
    endpoint: "getTopEthTokens",
    status: summarizeStatus(statuses),
    criteria: q.criteria,
    limit: q.limit,
    cached: false,
    tokens,
    providers: statuses,
  };

  if (statuses.some((status) => status.status === "ok")) {
    getTopEthTokensCache.set(cacheKey, { data: response, expiresAt: Date.now() + GET_TOP_ETH_TOKENS_CACHE_TTL_MS });
  }

  return response;
}

/* ────────────────────────────────────────────────────────────
   GET /newPairs
   Aggregates new token listings across sources.
   ──────────────────────────────────────────────────────────── */

export async function getNewPairs(q: NewPairsQuery): Promise<NewPairsResponse> {
  const statuses: ProviderStatus[] = [];
  const pairs: NewPairItem[] = [];
  const wantAll = q.source === "all";

  // DexScreener new profiles
  if (wantAll || q.source === "dexscreener") {
    const profiles = await runProvider(statuses, "dexScreener:newProfiles", true, () => getLatestTokenProfiles());
    if (profiles) {
      for (const p of profiles.slice(0, q.limit)) {
        pairs.push({
          source: "dexScreener",
          chainId: p.chainId ?? null,
          pairAddress: null,
          tokenAddress: p.tokenAddress ?? null,
          name: null,
          symbol: null,
          description: p.description ?? null,
          createdAt: null,
          tvl: null,
          marketCap: null,
          url: p.url ?? null,
        });
      }
    }
  }

  // Pump.fun currently live
  if (wantAll || q.source === "pumpfun") {
    const live = await runProvider(statuses, "pumpfun:live", true, () => getCurrentlyLive());
    if (live) {
      for (const c of live.slice(0, q.limit)) {
        pairs.push({
          source: "pumpfun",
          chainId: "solana",
          pairAddress: null,
          tokenAddress: c.mint ?? null,
          name: c.name ?? null,
          symbol: c.symbol ?? null,
          description: c.description ?? null,
          createdAt: c.created_timestamp ?? null,
          tvl: null,
          marketCap: c.usd_market_cap ?? null,
          url: c.mint ? `https://pump.fun/${c.mint}` : null,
        });
      }
    }
  }

  // Raydium new pools
  if (wantAll || q.source === "raydium") {
    const pools = await runProvider(statuses, "raydium:newPools", true, () => getNewPools(1, q.limit));
    if (pools?.data?.data) {
      for (const p of pools.data.data.slice(0, q.limit)) {
        pairs.push({
          source: "raydium",
          chainId: "solana",
          pairAddress: p.id ?? null,
          tokenAddress: p.mintA?.address ?? null,
          name: p.mintA?.symbol && p.mintB?.symbol ? `${p.mintA.symbol}/${p.mintB.symbol}` : null,
          symbol: p.mintA?.symbol ?? null,
          description: null,
          createdAt: null,
          tvl: p.tvl ?? null,
          marketCap: null,
          url: p.id ? `https://raydium.io/swap/?inputMint=${p.mintA?.address}&outputMint=${p.mintB?.address}` : null,
        });
      }
    }
  }

  // Uniswap V3 latest pools
  if (wantAll || q.source === "uniswap") {
    const uni = await runProvider(statuses, "uniswap:latestPools", true, () => getLatestPools(q.limit));
    if (uni?.data?.pools) {
      for (const p of uni.data.pools.slice(0, q.limit)) {
        pairs.push({
          source: "uniswapV3",
          chainId: "ethereum",
          pairAddress: p.id ?? null,
          tokenAddress: null,
          name: p.token0?.symbol && p.token1?.symbol ? `${p.token0.symbol}/${p.token1.symbol}` : null,
          symbol: null,
          description: null,
          createdAt: p.createdAtTimestamp ? Number(p.createdAtTimestamp) : null,
          tvl: null,
          marketCap: null,
          url: p.id ? `https://info.uniswap.org/#/pools/${p.id}` : null,
        });
      }
    }
  }

  return {
    endpoint: "newPairs",
    status: summarizeStatus(statuses),
    source: q.source,
    pairs,
    providers: statuses,
  };
}

/* ────────────────────────────────────────────────────────────
   GET /topTraders
   Top traders for a token via Birdeye (Sol).
   ──────────────────────────────────────────────────────────── */

const BIRDEYE_CHAIN_NAMES: Record<string, string> = {
  sol: "solana",
  eth: "ethereum",
  base: "base",
  bsc: "bsc",
};

export async function getTopTraders(q: TopTradersQuery): Promise<TopTradersResponse> {
  const chain = normalizeChain(q.chain);
  const statuses: ProviderStatus[] = [];
  const birdeyeChain = BIRDEYE_CHAIN_NAMES[chain] ?? "solana";

  const data = await runProvider(
    statuses,
    "birdeye:topTraders",
    isBirdeyeConfigured(),
    () => getBirdeyeTopTraders(q.tokenAddress, q.timeFrame, "volume", birdeyeChain),
    "Birdeye API key not configured.",
  );

  const traders = (data?.data?.items ?? []).map((t) => ({
    address: t.owner ?? null,
    tradeCount: t.trade ?? null,
    volume: t.volume ?? null,
    buyVolume: t.volumeBuy ?? null,
    sellVolume: t.volumeSell ?? null,
  }));

  return {
    endpoint: "topTraders",
    status: summarizeStatus(statuses),
    chain,
    tokenAddress: q.tokenAddress,
    timeFrame: q.timeFrame,
    traders,
    providers: statuses,
  };
}

/* ────────────────────────────────────────────────────────────
   GET /gasFeed
   Current gas prices for EVM chains via Etherscan V2.
   ──────────────────────────────────────────────────────────── */

export async function getGasFeed(q: GasFeedQuery): Promise<GasFeedResponse> {
  const chain = normalizeChain(q.chain);
  const statuses: ProviderStatus[] = [];

  const etherscanData = await runProvider(
    statuses,
    "etherscan:gasOracle",
    isEvmChain(chain) && isEtherscanConfigured(chain),
    () => getGasOracle(chain),
    !isEvmChain(chain)
      ? "gasFeed is only supported on EVM chains (eth, base, bsc)."
      : "Etherscan/Basescan/Bscscan API key not configured for this chain.",
  );

  let lastBlock = etherscanData?.result?.LastBlock ?? null;
  let safeGwei = etherscanData?.result?.SafeGasPrice ?? null;
  let proposeGwei = etherscanData?.result?.ProposeGasPrice ?? null;
  let fastGwei = etherscanData?.result?.FastGasPrice ?? null;
  let baseFeeGwei = etherscanData?.result?.suggestBaseFee ?? null;

  const needsRpcFallback = isEvmChain(chain) && (!safeGwei || !proposeGwei || !fastGwei || !baseFeeGwei);

  if (needsRpcFallback) {
    const [blockData, gasPriceData, feeHistoryData] = await Promise.all([
      runProvider(statuses, "rpc:blockNumber", true, () => getBlockNumber(chain)),
      runProvider(statuses, "rpc:gasPrice", true, () => getGasPrice(chain)),
      runProvider(statuses, "rpc:feeHistory", true, () => getFeeHistory(chain)),
    ]);

    const blockResult = blockData?.result;
    const gasPriceResult = gasPriceData?.result;
    const feeHistoryResult = feeHistoryData?.result;

    if (!lastBlock && blockResult) {
      lastBlock = String(parseInt(blockResult, 16));
    }

    const gasPriceGwei = hexWeiToGweiString(gasPriceResult);
    const rpcBaseFeeGwei = hexWeiToGweiString(feeHistoryResult?.baseFeePerGas?.at(-1) ?? feeHistoryResult?.baseFeePerGas?.[0]);
    const rewardSeries = feeHistoryResult?.reward ?? [];
    const latestRewardSet = rewardSeries.at(-1) ?? [];
    const safeRewardGwei = hexWeiToGweiString(latestRewardSet[0]);
    const proposeRewardGwei = hexWeiToGweiString(latestRewardSet[1]);
    const fastRewardGwei = hexWeiToGweiString(latestRewardSet[2]);

    if (!baseFeeGwei) {
      baseFeeGwei = rpcBaseFeeGwei ?? gasPriceGwei;
    }
    if (!safeGwei) {
      safeGwei = sumGwei(baseFeeGwei, safeRewardGwei) ?? gasPriceGwei;
    }
    if (!proposeGwei) {
      proposeGwei = sumGwei(baseFeeGwei, proposeRewardGwei) ?? gasPriceGwei;
    }
    if (!fastGwei) {
      fastGwei = sumGwei(baseFeeGwei, fastRewardGwei) ?? gasPriceGwei;
    }
  }

  return {
    endpoint: "gasFeed",
    status: summarizeStatus(statuses),
    chain,
    lastBlock,
    safeGwei,
    proposeGwei,
    fastGwei,
    baseFeeGwei,
    providers: statuses,
  };
}

function hexWeiToGweiString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const wei = BigInt(value);
    const whole = wei / 1_000_000_000n;
    const fraction = (wei % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return null;
  }
}

function sumGwei(left: string | null, right: string | null): string | null {
  if (!left || !right) {
    return null;
  }

  try {
    const sum = parseGweiToNano(left) + parseGweiToNano(right);
    const whole = sum / 1_000_000_000n;
    const fraction = (sum % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return null;
  }
}

function parseGweiToNano(value: string): bigint {
  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionPart.slice(0, 9)).padEnd(9, "0") || "0");
  return (whole * 1_000_000_000n) + fraction;
}

/* ────────────────────────────────────────────────────────────
   GET /tokenSearch
   Search for tokens/pairs by name, symbol, or address.
   ──────────────────────────────────────────────────────────── */

export async function getTokenSearch(q: TokenSearchQuery): Promise<TokenSearchResponse> {
  const statuses: ProviderStatus[] = [];

  const pairs = await runProvider(statuses, "dexScreener:search", true, () => searchPairs(q.query));

  const results = (pairs ?? []).map((p) => ({
    chainId: p.chainId ?? null,
    pairAddress: p.pairAddress ?? null,
    tokenAddress: p.baseToken?.address ?? null,
    name: p.baseToken?.name ?? null,
    symbol: p.baseToken?.symbol ?? null,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    volume24hUsd: p.volume?.h24 ?? null,
    liquidityUsd: p.liquidity?.usd ?? null,
    priceChange24hPct: p.priceChange?.h24 ?? null,
    fdvUsd: p.fdv ?? null,
    dex: p.dexId ?? null,
  }));

  return {
    endpoint: "tokenSearch",
    status: summarizeStatus(statuses),
    query: q.query,
    results,
    providers: statuses,
  };
}
