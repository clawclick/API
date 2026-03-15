import { isConfigured } from "#config/env";
import { getHistoricalPrices as getAlchemyHistory, isAlchemyConfigured } from "#providers/market/alchemy";
import { getTokenOverview as getBirdeyeOverview, getOhlcv as getBirdeyeOhlcv, isBirdeyeConfigured } from "#providers/market/birdeye";
import { getTokenMarketChart, getTokenPrice } from "#providers/market/coinGecko";
import { getTokenPairs } from "#providers/market/dexScreener";
import { getToken as getGeckoTerminalToken, getTopPools as getGeckoTerminalTopPools, getOhlcv as getGeckoTerminalOhlcv } from "#providers/market/geckoTerminal";
import { getTokenSecurity } from "#providers/risk/goPlus";
import { getHoneypotCheck } from "#providers/risk/honeypot";
import { searchMarkets } from "#providers/sentiment/polymarket";
import { isRedditConfigured, searchPosts } from "#providers/sentiment/reddit";
import { isXConfigured, searchRecentPosts } from "#providers/sentiment/x";
import { normalizeChain, isEvmChain, type SupportedChain } from "#providers/shared/chains";
import type { FudSearchQuery, PriceHistoryQuery, TokenQuery } from "#routes/helpers";
import type {
  FullAuditResponse,
  FudSearchResponse,
  HolderAnalysisResponse,
  IsScamResponse,
  MarketOverviewResponse,
  ProviderStatus,
  SocialMention,
  TokenPoolInfoResponse,
  TokenPriceHistoryResponse,
  TokenPricePoint
} from "#types/api";

type RiskBundle = {
  honeypot: Awaited<ReturnType<typeof getHoneypotCheck>>;
  goPlus: Awaited<ReturnType<typeof getTokenSecurity>>;
  providers: ProviderStatus[];
};

function parseNumber(value: number | string | undefined | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseBooleanFlag(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  return value === "1";
}

function firstNumber(...values: Array<number | string | undefined | null>): number | null {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function addStatus(statuses: ProviderStatus[], provider: string, status: ProviderStatus["status"], detail?: string): void {
  statuses.push({ provider, status, detail });
}

function formatDexLabel(dexId: string | undefined, labels: string[] | undefined): string | null {
  if (!dexId) return null;
  const version = labels?.find((l) => /^v\d/i.test(l));
  return version ? `${dexId}_${version.toLowerCase()}` : dexId;
}

// In-memory cache: token → pool address (survives until server restart)
const poolAddressCache = new Map<string, string>();

function poolCacheKey(chain: string, tokenAddress: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

async function runProvider<T>(statuses: ProviderStatus[], provider: string, shouldRun: boolean, task: () => Promise<T>): Promise<T | null> {
  if (!shouldRun) {
    addStatus(statuses, provider, "skipped", "Provider not configured or not supported for this chain.");
    return null;
  }

  try {
    const result = await task();
    addStatus(statuses, provider, "ok");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addStatus(statuses, provider, "error", message);
    return null;
  }
}

function summarizeStatus(statuses: ProviderStatus[]): "live" | "partial" {
  return statuses.some((status) => status.status === "ok") ? "live" : "partial";
}

function getHistoryDays(limit: string): number {
  const value = limit.trim().toLowerCase();

  if (value.endsWith("d")) {
    return Number(value.slice(0, -1));
  }

  if (value.endsWith("w")) {
    return Number(value.slice(0, -1)) * 7;
  }

  if (value.endsWith("m")) {
    return Number(value.slice(0, -1)) * 30;
  }

  if (value.endsWith("y")) {
    return Number(value.slice(0, -1)) * 365;
  }

  return 90;
}

function getBirdeyeHistoryType(limit: string): string {
  const days = getHistoryDays(limit);
  if (days <= 1) {
    return "1D";
  }
  if (days <= 7) {
    return "1W";
  }
  if (days <= 30) {
    return "1M";
  }
  if (days <= 90) {
    return "3M";
  }
  if (days <= 365) {
    return "1Y";
  }
  return "ALL";
}

function getGeckoTerminalOhlcvParams(interval: string, limit: string): { timeframe: string; aggregate: number; candleLimit: number } {
  const days = getHistoryDays(limit);

  // Map user interval to GeckoTerminal timeframe + aggregate
  let timeframe = "day";
  let aggregate = 1;
  const iv = interval.trim().toLowerCase();
  if (iv === "1m" || iv === "5m" || iv === "15m") {
    timeframe = "minute";
    aggregate = Number(iv.replace("m", ""));
  } else if (iv === "1h" || iv === "4h" || iv === "12h") {
    timeframe = "hour";
    aggregate = Number(iv.replace("h", ""));
  } else {
    timeframe = "day";
    aggregate = 1;
  }

  // Calculate how many candles we need
  const hoursInRange = days * 24;
  let candleLimit: number;
  if (timeframe === "minute") {
    candleLimit = Math.min(Math.ceil((hoursInRange * 60) / aggregate), 1000);
  } else if (timeframe === "hour") {
    candleLimit = Math.min(Math.ceil(hoursInRange / aggregate), 1000);
  } else {
    candleLimit = Math.min(days, 1000);
  }

  return { timeframe, aggregate, candleLimit };
}

function getBirdeyeOhlcvType(interval: string): string {
  const iv = interval.trim().toLowerCase();
  if (iv === "1m") return "1m";
  if (iv === "5m") return "5m";
  if (iv === "15m") return "15m";
  if (iv === "1h") return "1H";
  if (iv === "4h") return "4H";
  return "1D";
}

function buildFudQuery(query: FudSearchQuery): string {
  const parts = [query.tokenName, query.symbol];
  if (query.tokenAddress) {
    parts.push(query.tokenAddress);
  }

  return parts.filter(Boolean).join(" OR ");
}

// ── TTL caches for risk data ──
type CachedEntry<T> = { data: T; fetchedAt: number };
const honeypotCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getHoneypotCheck>>>>();
const goPlusCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getTokenSecurity>>>>();

const RISK_TTL_MS = 3 * 60 * 60 * 1000;          // 3 hours
const RISK_TTL_YOUNG_MS = 60 * 60 * 1000;         // 1 hour (token < 6h old)
const YOUNG_TOKEN_THRESHOLD_MS = 6 * 60 * 60 * 1000;

function riskCacheKey(chain: string, tokenAddress: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

function isCacheValid<T>(entry: CachedEntry<T> | undefined, ttlMs: number): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < ttlMs;
}

async function getCachedHoneypot(
  providers: ProviderStatus[],
  chain: SupportedChain,
  tokenAddress: string,
  ttlMs: number
): Promise<Awaited<ReturnType<typeof getHoneypotCheck>>> {
  const key = riskCacheKey(chain, tokenAddress);
  const cached = honeypotCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "honeypot", "ok", "cached");
    return cached!.data;
  }
  const result = await runProvider(providers, "honeypot", isEvmChain(chain), () => getHoneypotCheck(chain, tokenAddress));
  if (result !== null) honeypotCache.set(key, { data: result, fetchedAt: Date.now() });
  return result;
}

async function getCachedGoPlus(
  providers: ProviderStatus[],
  chain: SupportedChain,
  tokenAddress: string,
  ttlMs: number
): Promise<Awaited<ReturnType<typeof getTokenSecurity>>> {
  const key = riskCacheKey(chain, tokenAddress);
  const cached = goPlusCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "goPlus", "ok", "cached");
    return cached!.data;
  }
  const result = await runProvider(providers, "goPlus", isEvmChain(chain), () => getTokenSecurity(chain, tokenAddress));
  if (result !== null) goPlusCache.set(key, { data: result, fetchedAt: Date.now() });
  return result;
}

function estimateTokenAgeTtl(honeypot: Awaited<ReturnType<typeof getHoneypotCheck>>): number {
  // If honeypot.is reports very few holders, it's likely a young token
  const holders = honeypot?.token?.totalHolders;
  if (holders !== undefined && holders < 200) return RISK_TTL_YOUNG_MS;
  return RISK_TTL_MS;
}

async function getRiskBundle(chain: SupportedChain, tokenAddress: string): Promise<RiskBundle> {
  const providers: ProviderStatus[] = [];
  const honeypot = await getCachedHoneypot(providers, chain, tokenAddress, RISK_TTL_MS);
  const goPlus = await getCachedGoPlus(providers, chain, tokenAddress, RISK_TTL_MS);
  return { honeypot, goPlus, providers };
}

export async function getTokenPoolInfo(query: TokenQuery): Promise<TokenPoolInfoResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  // Primary: DexScreener (free, all chains, has everything we need)
  const dexPairs = await runProvider(providers, "dexScreener", true, () => getTokenPairs(chain, query.tokenAddress));
  const topDexPair = dexPairs?.[0];

  // Check if primary gave us the key fields
  const hasPrimary = topDexPair?.priceUsd != null;

  // Fallback: only call if DexScreener failed or errored
  let geckoAttributes: Record<string, any> | undefined;
  let birdeyeData: Record<string, any> | undefined;
  let coinGecko: Awaited<ReturnType<typeof getTokenPrice>> | null = null;

  if (!hasPrimary && isEvmChain(chain)) {
    const gt = await runProvider(providers, "geckoTerminal", true, () => getGeckoTerminalToken(chain, query.tokenAddress));
    geckoAttributes = gt?.data?.attributes;
    if (!geckoAttributes?.price_usd) {
      coinGecko = await runProvider(providers, "coinGecko", true, () => getTokenPrice(chain, query.tokenAddress));
    }
  } else if (!hasPrimary && chain === "sol" && isBirdeyeConfigured()) {
    const be = await runProvider(providers, "birdeye", true, () => getBirdeyeOverview(query.tokenAddress));
    birdeyeData = be?.data;
  }

  const result: TokenPoolInfoResponse = {
    endpoint: "tokenPoolInfo",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    name: topDexPair?.baseToken?.name ?? birdeyeData?.name ?? geckoAttributes?.name ?? null,
    symbol: topDexPair?.baseToken?.symbol ?? birdeyeData?.symbol ?? geckoAttributes?.symbol ?? null,
    priceUsd: firstNumber(topDexPair?.priceUsd, birdeyeData?.price, geckoAttributes?.price_usd, coinGecko?.usd),
    marketCapUsd: firstNumber(topDexPair?.marketCap, birdeyeData?.marketCap, geckoAttributes?.market_cap_usd, coinGecko?.usd_market_cap),
    fdvUsd: firstNumber(topDexPair?.fdv, birdeyeData?.fdv, geckoAttributes?.fdv_usd),
    liquidityUsd: firstNumber(topDexPair?.liquidity?.usd, birdeyeData?.liquidity, geckoAttributes?.total_reserve_in_usd),
    volume24hUsd: firstNumber(topDexPair?.volume?.h24, birdeyeData?.v24hUSD, geckoAttributes?.volume_usd?.h24, coinGecko?.usd_24h_vol),
    priceChange24hPct: firstNumber(topDexPair?.priceChange?.h24, birdeyeData?.priceChange24hPercent, coinGecko?.usd_24h_change),
    pairAddress: topDexPair?.pairAddress ?? null,
    dex: formatDexLabel(topDexPair?.dexId, topDexPair?.labels),
    providers
  };

  // Cache the pair address for future OHLCV lookups
  if (topDexPair?.pairAddress) {
    poolAddressCache.set(poolCacheKey(chain, query.tokenAddress), topDexPair.pairAddress);
  }

  return result;
}

export async function getTokenPriceHistory(query: PriceHistoryQuery): Promise<TokenPriceHistoryResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const days = getHistoryDays(query.limit);
  let points: TokenPricePoint[] = [];

  // ── EVM: GeckoTerminal OHLCV (primary) ──
  if (isEvmChain(chain)) {
    const cacheKey = poolCacheKey(chain, query.tokenAddress);
    let poolAddress = poolAddressCache.get(cacheKey);

    if (!poolAddress) {
      const pools = await runProvider(providers, "geckoTerminal", true, () => getGeckoTerminalTopPools(chain, query.tokenAddress));
      poolAddress = pools?.data?.[0]?.attributes?.address ?? undefined;
      if (poolAddress) poolAddressCache.set(cacheKey, poolAddress);
    }

    if (poolAddress) {
      const { timeframe, aggregate, candleLimit } = getGeckoTerminalOhlcvParams(query.interval, query.limit);
      const ohlcv = await runProvider(providers, "geckoTerminalOhlcv", true, () => getGeckoTerminalOhlcv(chain, poolAddress, timeframe, aggregate, candleLimit));
      const candles = ohlcv?.data?.attributes?.ohlcv_list;
      if (candles?.length) {
        points = candles.map(([ts, o, h, l, c, v]) => ({
          timestamp: ts * 1000,
          priceUsd: c,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v
        }));
      }
    }
  }

  // ── SOL: Birdeye OHLCV (primary) ──
  if (chain === "sol" && isBirdeyeConfigured() && points.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 86400;
    const beOhlcv = await runProvider(providers, "birdeye", true, () => getBirdeyeOhlcv(query.tokenAddress, getBirdeyeOhlcvType(query.interval), from, now));
    const items = beOhlcv?.data?.items;
    if (items?.length) {
      points = items.flatMap((item) => {
        if (item.unixTime === undefined || item.c === undefined) return [];
        return [{
          timestamp: item.unixTime * 1000,
          priceUsd: item.c,
          open: item.o,
          high: item.h,
          low: item.l,
          close: item.c,
          volume: item.v
        }];
      });
    }
  }

  // ── Fallback: Alchemy (all chains, prices only) ──
  if (points.length === 0 && isAlchemyConfigured()) {
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - days * 86400_000).toISOString();
    const alchemyInterval = query.interval.trim().toLowerCase().endsWith("h") ? "1h" : "1d";
    const alchemy = await runProvider(providers, "alchemy", true, () => getAlchemyHistory(chain, query.tokenAddress, startTime, endTime, alchemyInterval));
    if (alchemy?.data?.length) {
      points = alchemy.data.map((p) => ({
        timestamp: new Date(p.timestamp).getTime(),
        priceUsd: Number(p.value)
      }));
    }
  }

  return {
    endpoint: "tokenPriceHistory",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    currency: "usd",
    limit: query.limit,
    interval: query.interval,
    points,
    providers
  };
}

export async function getIsScam(query: TokenQuery): Promise<IsScamResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  // Check cache first
  const key = riskCacheKey(chain, query.tokenAddress);
  const cached = honeypotCache.get(key);
  const fromCache = isCacheValid(cached, RISK_TTL_MS);

  const honeypot = await getCachedHoneypot(providers, chain, query.tokenAddress, RISK_TTL_MS);

  const warnings = [
    honeypot?.honeypotResult?.honeypotReason,
    ...(honeypot?.summary?.flags?.map((flag) => flag.description ?? flag.flag ?? "") ?? [])
  ].filter((value): value is string => Boolean(value));

  const riskLevel = firstNumber(honeypot?.summary?.riskLevel);
  const isScam = honeypot?.honeypotResult?.isHoneypot
    ?? (riskLevel !== null ? riskLevel >= 60 : null);

  return {
    endpoint: "isScam",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    isScam,
    risk: honeypot?.summary?.risk ?? null,
    riskLevel,
    warnings,
    cached: fromCache,
    providers
  };
}

export async function getFullAudit(query: TokenQuery): Promise<FullAuditResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  // Check caches before fetching
  const key = riskCacheKey(chain, query.tokenAddress);
  const hpCached = honeypotCache.get(key);
  const gpCached = goPlusCache.get(key);

  // Fetch honeypot first to determine TTL
  const honeypot = await getCachedHoneypot(providers, chain, query.tokenAddress, RISK_TTL_MS);
  const ttl = estimateTokenAgeTtl(honeypot);
  const goPlus = await getCachedGoPlus(providers, chain, query.tokenAddress, ttl);

  const fromCache = isCacheValid(hpCached, ttl) && isCacheValid(gpCached, ttl);

  // Build warnings from both providers
  const warnings = [
    honeypot?.honeypotResult?.honeypotReason,
    ...(honeypot?.summary?.flags?.map((flag) => flag.description ?? flag.flag ?? "") ?? []),
    parseBooleanFlag(goPlus?.cannot_buy) ? "Token may block buys." : null,
    parseBooleanFlag(goPlus?.cannot_sell_all) ? "Token may prevent full sells." : null,
    parseBooleanFlag(goPlus?.is_honeypot) ? "GoPlus flagged as honeypot." : null,
    parseBooleanFlag(goPlus?.hidden_owner) ? "Contract has a hidden owner." : null,
    parseBooleanFlag(goPlus?.selfdestruct) ? "Contract can self-destruct." : null,
    parseBooleanFlag(goPlus?.external_call) ? "Contract makes external calls." : null,
    parseBooleanFlag(goPlus?.can_take_back_ownership) ? "Ownership can be reclaimed." : null,
    parseBooleanFlag(goPlus?.transfer_pausable) ? "Transfers can be paused." : null,
    parseBooleanFlag(goPlus?.trading_cooldown) ? "Trading cooldown enabled." : null
  ].filter((value): value is string => Boolean(value));

  const riskLevel = firstNumber(honeypot?.summary?.riskLevel);
  const isScam = (honeypot?.honeypotResult?.isHoneypot
    ?? (parseBooleanFlag(goPlus?.cannot_buy) === true || parseBooleanFlag(goPlus?.cannot_sell_all) === true || parseBooleanFlag(goPlus?.is_honeypot) === true))
    || (riskLevel !== null ? riskLevel >= 60 : null);

  return {
    endpoint: "fullAudit",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    cached: fromCache,
    summary: {
      isScam,
      risk: honeypot?.summary?.risk ?? null,
      riskLevel,
      warnings
    },
    taxes: {
      buyTax: firstNumber(honeypot?.simulationResult?.buyTax, goPlus?.buy_tax),
      sellTax: firstNumber(honeypot?.simulationResult?.sellTax, goPlus?.sell_tax),
      transferTax: firstNumber(honeypot?.simulationResult?.transferTax)
    },
    contract: {
      openSource: honeypot?.contractCode?.openSource ?? parseBooleanFlag(goPlus?.is_open_source),
      isProxy: parseBooleanFlag(goPlus?.is_proxy),
      hasProxyCalls: honeypot?.contractCode?.hasProxyCalls ?? null,
      isMintable: parseBooleanFlag(goPlus?.is_mintable),
      canTakeBackOwnership: parseBooleanFlag(goPlus?.can_take_back_ownership),
      hiddenOwner: parseBooleanFlag(goPlus?.hidden_owner),
      selfDestruct: parseBooleanFlag(goPlus?.selfdestruct),
      externalCall: parseBooleanFlag(goPlus?.external_call),
      ownerAddress: goPlus?.owner_address ?? null,
      creatorAddress: goPlus?.creator_address ?? null
    },
    trading: {
      cannotBuy: parseBooleanFlag(goPlus?.cannot_buy),
      cannotSellAll: parseBooleanFlag(goPlus?.cannot_sell_all),
      isAntiWhale: parseBooleanFlag(goPlus?.is_anti_whale),
      tradingCooldown: parseBooleanFlag(goPlus?.trading_cooldown),
      transferPausable: parseBooleanFlag(goPlus?.transfer_pausable),
      personalSlippageModifiable: parseBooleanFlag(goPlus?.personal_slippage_modifiable),
      isBlacklisted: parseBooleanFlag(goPlus?.is_blacklisted),
      isWhitelisted: parseBooleanFlag(goPlus?.is_whitelisted)
    },
    holders: {
      holderCount: firstNumber(goPlus?.holder_count),
      lpHolderCount: firstNumber(goPlus?.lp_holder_count),
      ownerPercent: firstNumber(goPlus?.owner_percent),
      creatorPercent: firstNumber(goPlus?.creator_percent),
      totalHolders: firstNumber(honeypot?.token?.totalHolders, goPlus?.holder_count)
    },
    simulation: {
      buyGas: honeypot?.simulationResult?.buyGas?.toString() ?? null,
      sellGas: honeypot?.simulationResult?.sellGas?.toString() ?? null
    },
    providers
  };
}

export async function getHolderAnalysis(query: TokenQuery): Promise<HolderAnalysisResponse> {
  const chain = normalizeChain(query.chain);
  const risk = await getRiskBundle(chain, query.tokenAddress);
  const analysis = risk.honeypot?.holderAnalysis;

  return {
    endpoint: "holderAnalysis",
    status: summarizeStatus(risk.providers),
    chain,
    tokenAddress: query.tokenAddress,
    totalHolders: firstNumber(risk.honeypot?.token?.totalHolders, risk.goPlus?.holder_count),
    analyzedHolders: firstNumber(analysis?.holders),
    successfulSellers: firstNumber(analysis?.successful),
    failedSellers: firstNumber(analysis?.failed),
    siphonedWallets: firstNumber(analysis?.siphoned),
    averageTax: firstNumber(analysis?.averageTax),
    highestTax: firstNumber(analysis?.highestTax),
    averageGas: firstNumber(analysis?.averageGas),
    providers: risk.providers
  };
}

export async function getFudSearch(query: FudSearchQuery): Promise<FudSearchResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const searchQuery = buildFudQuery(query);

  const xResponse = await runProvider(providers, "x", isXConfigured(), () => searchRecentPosts(searchQuery));
  const redditResponse = await runProvider(providers, "reddit", isRedditConfigured(), () => searchPosts(searchQuery));

  const userMap = new Map((xResponse?.includes?.users ?? []).map((user) => [user.id, user]));

  const xMentions: SocialMention[] = (xResponse?.data ?? []).map((post) => {
    const user = post.author_id ? userMap.get(post.author_id) : undefined;

    return {
      source: "x",
      id: post.id,
      title: post.text ?? "",
      author: user?.username ?? user?.name ?? null,
      createdAt: post.created_at ?? null,
      url: user?.username ? `https://x.com/${user.username}/status/${post.id}` : null,
      metrics: {
        likes: post.public_metrics?.like_count ?? null,
        replies: post.public_metrics?.reply_count ?? null,
        reposts: post.public_metrics?.retweet_count ?? null,
        impressions: post.public_metrics?.impression_count ?? null,
        followers: user?.public_metrics?.followers_count ?? null
      }
    };
  });

  const redditMentions: SocialMention[] = (redditResponse?.data?.children ?? []).flatMap((child) => {
    const post = child.data;
    if (!post?.id) {
      return [];
    }

    return [{
      source: "reddit",
      id: post.id,
      title: [post.title, post.selftext].filter(Boolean).join("\n\n"),
      author: post.author ?? null,
      createdAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
      url: post.permalink ? `https://reddit.com${post.permalink}` : null,
      metrics: {
        score: post.score ?? null,
        comments: post.num_comments ?? null
      }
    }];
  });

  return {
    endpoint: "fudSearch",
    status: summarizeStatus(providers),
    chain,
    query: searchQuery,
    mentions: [...xMentions, ...redditMentions],
    providers
  };
}

export async function getMarketOverview(query: TokenQuery): Promise<MarketOverviewResponse> {
  const chain = normalizeChain(query.chain);
  const tokenName = query.tokenName ?? query.symbol ?? query.tokenAddress;

  const [pool, risk, social, polymarketMarkets] = await Promise.all([
    getTokenPoolInfo(query),
    getIsScam(query),
    query.tokenName && query.symbol
      ? getFudSearch({
          chain,
          tokenAddress: query.tokenAddress,
          tokenName: query.tokenName,
          symbol: query.symbol
        })
      : Promise.resolve(null),
    runProvider([], "polymarket", true, () => searchMarkets(tokenName))
  ]);

  return {
    endpoint: "marketOverview",
    status: [pool.status, risk.status, social?.status ?? "partial"].includes("live") ? "live" : "partial",
    chain,
    tokenAddress: query.tokenAddress,
    pool,
    risk,
    social,
    predictionMarkets: (polymarketMarkets ?? []).map((market) => ({
      id: market.id,
      question: market.question ?? "",
      category: market.category ?? null,
      endDate: market.endDate ?? null,
      volume: parseNumber(market.volume),
      liquidity: parseNumber(market.liquidity),
      url: market.slug ? `https://polymarket.com/event/${market.slug}` : null
    }))
  };
}