import { isConfigured } from "#config/env";
import { addStatus, runProvider, summarizeStatus } from "#lib/runProvider";
import { getHistoricalPrices as getAlchemyHistory, isAlchemyConfigured } from "#providers/market/alchemy";
import {
  getHolderDistribution as getBirdeyeHolderDistribution,
  getOhlcv as getBirdeyeOhlcv,
  getTokenOverview as getBirdeyeOverview,
  getTokenSecurity as getBirdeyeTokenSecurity,
  isBirdeyeConfigured
} from "#providers/market/birdeye";
import {
  CODEX_NETWORK_IDS,
  codexGetDetailedTokenStats,
  codexGetTokenBars,
  codexListPairsForToken,
  codexTop10HoldersPercent,
  isCodexConfigured,
} from "#providers/market/codex";
import type { CodexDetailedTokenStatsWindow, CodexDetailedValueMetric, CodexStatsType } from "#providers/market/codex";
import { getCoinMarketChart, getTokenMarketChart, getTokenPrice } from "#providers/market/coinGecko";
import { getTokenPairs } from "#providers/market/dexScreener";
import { getToken as getGeckoTerminalToken, getTopPools as getGeckoTerminalTopPools, getOhlcv as getGeckoTerminalOhlcv } from "#providers/market/geckoTerminal";
import { getTokenSecurity } from "#providers/risk/goPlus";
import { getHoneypotCheck } from "#providers/risk/honeypot";
import { searchMarkets } from "#providers/sentiment/polymarket";
import { isRedditConfigured, searchPosts } from "#providers/sentiment/reddit";
import { isXConfigured, searchRecentPosts } from "#providers/sentiment/x";
import { getTokenHolderStats as getMoralisTokenHolderStats, getTokenOwners as getMoralisTokenOwners, isMoralisConfigured } from "#providers/walletTracking/moralis";
import { normalizeChain, isEvmChain, type SupportedChain } from "#providers/shared/chains";
import type { DetailedTokenStatsQuery, FudSearchQuery, MarketOverviewQuery, PriceHistoryQuery, TokenQuery } from "#routes/helpers";
import type {
  DetailedTokenStatsMetric,
  DetailedTokenStatsResponse,
  DetailedTokenStatsWindow,
  FullAuditResponse,
  FudSearchResponse,
  HolderAnalysisResponse,
  IsScamResponse,
  MarketOverviewDriver,
  MarketOverviewResponse,
  PredictionMarketSummary,
  ProviderStatus,
  SocialMention,
  TokenPoolInfoResponse,
  TokenPriceHistoryResponse,
  TokenPricePoint
} from "#types/api";

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

function normalizeRatioPercent(value: number | string | undefined | null): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }

  return parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function sumPercentOfSupply<T>(items: T[], limit: number, getPercent: (item: T) => number | null): number | null {
  const percents = items.slice(0, limit).map(getPercent).filter((value): value is number => value !== null);
  if (percents.length === 0) {
    return null;
  }

  return percents.reduce((sum, value) => sum + value, 0);
}

function countPercentThreshold<T>(items: T[], threshold: number, getPercent: (item: T) => number | null): number | null {
  const percents = items.map(getPercent).filter((value): value is number => value !== null);
  if (percents.length === 0) {
    return null;
  }

  return percents.filter((value) => value >= threshold).length;
}

function buildHolderSignals(input: {
  top5Percent: number | null;
  top10Percent: number | null;
  largestHolderPercent: number | null;
  holdersOver1Pct: number | null;
  holdersOver5Pct: number | null;
  ownerPercent: number | null;
  creatorPercent: number | null;
  ownerCanChangeBalance: boolean | null;
  failedSellers: number | null;
  siphonedWallets: number | null;
}): string[] {
  const signals: string[] = [];

  if (input.top10Percent !== null && input.top10Percent >= 50) {
    signals.push(`Top 10 holders control ${input.top10Percent.toFixed(2)}% of supply.`);
  }
  if (input.top5Percent !== null && input.top5Percent >= 35) {
    signals.push(`Top 5 holders control ${input.top5Percent.toFixed(2)}% of supply.`);
  }
  if (input.largestHolderPercent !== null && input.largestHolderPercent >= 10) {
    signals.push(`Largest holder controls ${input.largestHolderPercent.toFixed(2)}% of supply.`);
  }
  if (input.holdersOver5Pct !== null && input.holdersOver5Pct >= 2) {
    signals.push(`${input.holdersOver5Pct} wallets each hold at least 5% of supply.`);
  }
  if (input.holdersOver1Pct !== null && input.holdersOver1Pct >= 5) {
    signals.push(`${input.holdersOver1Pct} wallets each hold at least 1% of supply.`);
  }
  if (input.ownerPercent !== null && input.ownerPercent >= 5) {
    signals.push(`Owner wallet still controls ${input.ownerPercent.toFixed(2)}% of supply.`);
  }
  if (input.creatorPercent !== null && input.creatorPercent >= 5) {
    signals.push(`Creator wallet still controls ${input.creatorPercent.toFixed(2)}% of supply.`);
  }
  if (input.ownerCanChangeBalance === true) {
    signals.push("Owner can change balance, which is a major distribution red flag.");
  }
  if (input.failedSellers !== null && input.failedSellers > 0) {
    signals.push(`${input.failedSellers} sampled holders failed to sell.`);
  }
  if (input.siphonedWallets !== null && input.siphonedWallets > 0) {
    signals.push(`${input.siphonedWallets} sampled wallets were flagged as siphoned.`);
  }

  return signals;
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

function getCodexResolution(interval: string): string {
  const iv = interval.trim().toLowerCase();
  if (iv === "1m") return "1";
  if (iv === "5m") return "5";
  if (iv === "15m") return "15";
  if (iv === "30m") return "30";
  if (iv === "1h") return "60";
  if (iv === "4h") return "240";
  if (iv === "12h") return "720";
  if (iv === "7d") return "7D";
  return "1D";
}

function getIntervalMs(interval: string): number {
  const iv = interval.trim().toLowerCase();
  if (iv.endsWith("m")) {
    return Number(iv.slice(0, -1)) * 60_000;
  }
  if (iv.endsWith("h")) {
    return Number(iv.slice(0, -1)) * 3_600_000;
  }
  if (iv.endsWith("d")) {
    return Number(iv.slice(0, -1)) * 86_400_000;
  }
  return 86_400_000;
}

function getDesiredCandleCount(limit: string, interval: string): number {
  const days = getHistoryDays(limit);
  const intervalMs = getIntervalMs(interval);
  const count = Math.ceil((days * 86_400_000) / intervalMs);
  return Math.max(1, Math.min(count, 1500));
}

function parseDetailedMetric(metric: CodexDetailedValueMetric | undefined): DetailedTokenStatsMetric | null {
  if (!metric) {
    return null;
  }

  return {
    currentValue: parseNumber(metric.currentValue),
    previousValue: parseNumber(metric.previousValue),
    change: parseNumber(metric.change),
  };
}

function mapDetailedTokenStatsWindow(window: CodexDetailedTokenStatsWindow | undefined): DetailedTokenStatsWindow | null {
  if (!window) {
    return null;
  }

  return {
    duration: window.duration ?? null,
    start: window.start ?? null,
    end: window.end ?? null,
    statsUsd: {
      volume: parseDetailedMetric(window.statsUsd?.volume),
      buyVolume: parseDetailedMetric(window.statsUsd?.buyVolume),
      sellVolume: parseDetailedMetric(window.statsUsd?.sellVolume),
      open: parseDetailedMetric(window.statsUsd?.open),
      highest: parseDetailedMetric(window.statsUsd?.highest),
      lowest: parseDetailedMetric(window.statsUsd?.lowest),
      close: parseDetailedMetric(window.statsUsd?.close),
      liquidity: parseDetailedMetric(window.statsUsd?.liquidity),
    },
    statsNonCurrency: {
      transactions: parseDetailedMetric(window.statsNonCurrency?.transactions),
      buys: parseDetailedMetric(window.statsNonCurrency?.buys),
      sells: parseDetailedMetric(window.statsNonCurrency?.sells),
      traders: parseDetailedMetric(window.statsNonCurrency?.traders),
      buyers: parseDetailedMetric(window.statsNonCurrency?.buyers),
      sellers: parseDetailedMetric(window.statsNonCurrency?.sellers),
    },
  };
}

function parseDetailedDurations(value: string): string[] {
  const allowed = new Set(["min5", "hour1", "hour4", "hour12", "day1"]);
  const durations = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && allowed.has(item));

  return durations.length > 0 ? durations : ["hour1", "day1"];
}

const HIGH_SIGNAL_FUD_TERMS = [
  "scam",
  "scam token",
  "rug",
  "rug pull",
  "rugpull",
  "honeypot",
  "exit scam",
  "cannot sell",
  "unable to sell",
  "sell failed",
  "liquidity removed",
  "liquidity pulled",
  "lp removed",
  "dev dumped",
  "team dumped",
  "wallets drained",
  "drained",
  "stolen funds",
  "fraud",
  "exploit",
  "malicious contract",
  "backdoor",
  "blacklisted",
  "warning",
  "red flag",
  "pump and dump",
  "fake holders",
  "fake volume",
  "wash trading",
  "soft rug",
  "suspicious",
  "sketchy",
  "unsafe",
  "stay away",
  "avoid"
];
const FUD_SEARCH_TTL_MS = 15 * 60 * 1000;        // 15 minutes
const MARKET_OVERVIEW_TTL_MS = 15 * 60 * 1000;   // 15 minutes

const MAJOR_ASSETS = {
  btc: {
    asset: "btc",
    label: "Bitcoin",
    coinGeckoId: "bitcoin",
    aliases: ["btc", "bitcoin", "$btc"]
  },
  eth: {
    asset: "eth",
    label: "Ethereum",
    coinGeckoId: "ethereum",
    aliases: ["eth", "ethereum", "$eth"]
  },
  sol: {
    asset: "sol",
    label: "Solana",
    coinGeckoId: "solana",
    aliases: ["sol", "solana", "$sol"]
  },
  xrp: {
    asset: "xrp",
    label: "XRP",
    coinGeckoId: "ripple",
    aliases: ["xrp", "ripple", "$xrp"]
  },
  bnb: {
    asset: "bnb",
    label: "BNB",
    coinGeckoId: "binancecoin",
    aliases: ["bnb", "binance coin", "binance", "$bnb", "bsc"]
  }
} as const;

const POSITIVE_SENTIMENT_TERMS = [
  "bullish",
  "breakout",
  "rally",
  "higher",
  "up only",
  "strength",
  "outperform",
  "accumulation",
  "approval",
  "adoption",
  "all time high",
  "ath"
];

const NEGATIVE_SENTIMENT_TERMS = [
  "bearish",
  "breakdown",
  "crash",
  "lower",
  "selloff",
  "weakness",
  "recession",
  "rejected",
  "lawsuit",
  "exploit",
  "dump",
  "panic"
];

type MajorAsset = keyof typeof MAJOR_ASSETS;

function buildTokenIdentifiers(query: FudSearchQuery): string[] {
  const identifiers = new Set<string>();

  if (query.tokenName?.trim()) {
    identifiers.add(`"${query.tokenName.trim()}"`);
  }

  if (query.symbol?.trim()) {
    const symbol = query.symbol.trim();
    identifiers.add(`"${symbol}"`);
    identifiers.add(`"$${symbol}"`);
  }

  if (query.tokenAddress?.trim()) {
    identifiers.add(`"${query.tokenAddress.trim()}"`);
  }

  return [...identifiers];
}

function buildFudFetchQuery(query: FudSearchQuery): string {
  const identifiers = buildTokenIdentifiers(query);
  const tokenClause = identifiers.length > 1 ? `(${identifiers.join(" OR ")})` : identifiers[0] ?? "";

  return `${tokenClause} lang:en`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchedFudTerms(text: string | undefined): string[] {
  if (!text) {
    return [];
  }

  const lowerText = text.toLowerCase();
  return HIGH_SIGNAL_FUD_TERMS.filter((term) => new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`, "i").test(lowerText));
}

// ── TTL caches for risk data ──
type CachedEntry<T> = { data: T; fetchedAt: number };
const honeypotCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getHoneypotCheck>>>>();
const goPlusCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getTokenSecurity>>>>();
const moralisOwnersCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getMoralisTokenOwners>>>>();
const moralisHolderStatsCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getMoralisTokenHolderStats>>>>();
const birdeyeSecurityCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getBirdeyeTokenSecurity>>>>();
const birdeyeHolderDistributionCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof getBirdeyeHolderDistribution>>>>();
const xSearchCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof searchRecentPosts>>>>();
const redditSearchCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof searchPosts>>>>();
const polymarketSearchCache = new Map<string, CachedEntry<Awaited<ReturnType<typeof searchMarkets>>>>();
const marketOverviewCache = new Map<string, CachedEntry<MarketOverviewResponse>>();
const detailedTokenStatsCache = new Map<string, CachedEntry<DetailedTokenStatsResponse>>();
const codexTop10HoldersPercentCache = new Map<string, CachedEntry<number | null>>();

const RISK_TTL_MS = 3 * 60 * 60 * 1000;          // 3 hours
const RISK_TTL_YOUNG_MS = 60 * 60 * 1000;         // 1 hour (token < 6h old)
const YOUNG_TOKEN_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const HOLDER_TTL_MS = 2 * 60 * 60 * 1000;         // 2 hours
const DETAILED_TOKEN_STATS_TTL_MS = 30 * 60 * 1000;

function riskCacheKey(chain: string, tokenAddress: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

function holderCacheKey(chain: string, tokenAddress: string, suffix: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}:${suffix}`;
}

function detailedTokenStatsCacheKey(query: DetailedTokenStatsQuery): string {
  return JSON.stringify(query);
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

async function getCachedMoralisOwners(
  providers: ProviderStatus[],
  chain: SupportedChain,
  tokenAddress: string,
  limit: number,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof getMoralisTokenOwners>> | null> {
  const key = holderCacheKey(chain, tokenAddress, `moralisOwners:${limit}`);
  const cached = moralisOwnersCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "moralisOwners", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "moralisOwners", isEvmChain(chain) && isMoralisConfigured(), () => getMoralisTokenOwners(tokenAddress, chain, limit));
  if (result !== null) {
    moralisOwnersCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedMoralisHolderStats(
  providers: ProviderStatus[],
  chain: SupportedChain,
  tokenAddress: string,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof getMoralisTokenHolderStats>> | null> {
  const key = holderCacheKey(chain, tokenAddress, "moralisHolderStats");
  const cached = moralisHolderStatsCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "moralisHolderStats", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "moralisHolderStats", isEvmChain(chain) && isMoralisConfigured(), () => getMoralisTokenHolderStats(tokenAddress, chain));
  if (result !== null) {
    moralisHolderStatsCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedBirdeyeSecurity(
  providers: ProviderStatus[],
  tokenAddress: string,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof getBirdeyeTokenSecurity>> | null> {
  const key = holderCacheKey("sol", tokenAddress, "birdeyeSecurity");
  const cached = birdeyeSecurityCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "birdeyeSecurity", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "birdeyeSecurity", isBirdeyeConfigured(), () => getBirdeyeTokenSecurity(tokenAddress));
  if (result !== null) {
    birdeyeSecurityCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedBirdeyeHolderDistribution(
  providers: ProviderStatus[],
  tokenAddress: string,
  topN: number,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof getBirdeyeHolderDistribution>> | null> {
  const key = holderCacheKey("sol", tokenAddress, `birdeyeHolderDistribution:${topN}`);
  const cached = birdeyeHolderDistributionCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "birdeyeHolderDistribution", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "birdeyeHolderDistribution", isBirdeyeConfigured(), () => getBirdeyeHolderDistribution(tokenAddress, topN));
  if (result !== null) {
    birdeyeHolderDistributionCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedXSearch(
  providers: ProviderStatus[],
  query: string,
  maxResults: number,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof searchRecentPosts>> | null> {
  const key = `x:${query}:${maxResults}`;
  const cached = xSearchCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "x", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "x", isXConfigured(), () => searchRecentPosts(query, maxResults));
  if (result !== null) {
    xSearchCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedRedditSearch(
  providers: ProviderStatus[],
  query: string,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof searchPosts>> | null> {
  const key = `reddit:${query}`;
  const cached = redditSearchCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "reddit", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "reddit", isRedditConfigured(), () => searchPosts(query));
  if (result !== null) {
    redditSearchCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

async function getCachedPolymarketSearch(
  providers: ProviderStatus[],
  query: string,
  ttlMs: number,
): Promise<Awaited<ReturnType<typeof searchMarkets>> | null> {
  const key = `polymarket:${query}`;
  const cached = polymarketSearchCache.get(key);
  if (isCacheValid(cached, ttlMs)) {
    addStatus(providers, "polymarket", "ok", "cached");
    return cached!.data;
  }

  const result = await runProvider(providers, "polymarket", true, () => searchMarkets(query));
  if (result !== null) {
    polymarketSearchCache.set(key, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

function normalizeMajorAsset(asset: string | undefined): MajorAsset | null {
  const value = asset?.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === "bitcoin" || value === "btc") return "btc";
  if (value === "ethereum" || value === "eth") return "eth";
  if (value === "solana" || value === "sol") return "sol";
  if (value === "xrp" || value === "ripple") return "xrp";
  if (value === "bnb" || value === "binance" || value === "binance coin" || value === "bsc" || value === "binance-smart-chain") return "bnb";
  return null;
}

function resolveMajorAsset(asset: string | undefined, tokenAddress: string | undefined): MajorAsset | null {
  return normalizeMajorAsset(asset) ?? normalizeMajorAsset(tokenAddress);
}

function buildMajorXQuery(asset: MajorAsset): string {
  const aliases = MAJOR_ASSETS[asset].aliases.map((alias) => `"${alias}"`);
  return `(${aliases.join(" OR ")}) lang:en -is:retweet`;
}

function buildMajorRedditQuery(asset: MajorAsset): string {
  const aliases = MAJOR_ASSETS[asset].aliases.filter((alias) => !alias.startsWith("$")).map((alias) => `"${alias}"`);
  return aliases.join(" OR ");
}

function scoreTextSentiment(text: string | undefined): number {
  if (!text) {
    return 0;
  }

  const lowerText = text.toLowerCase();
  const positive = POSITIVE_SENTIMENT_TERMS.reduce((count, term) => count + (lowerText.includes(term) ? 1 : 0), 0);
  const negative = NEGATIVE_SENTIMENT_TERMS.reduce((count, term) => count + (lowerText.includes(term) ? 1 : 0), 0);
  if (positive === 0 && negative === 0) {
    return 0;
  }

  return Math.max(-1, Math.min(1, (positive - negative) / Math.max(positive + negative, 1)));
}

function logWeight(value: number): number {
  return value > 0 ? Math.log10(value + 1) : 0;
}

function buildPredictionMarketSummary(market: Awaited<ReturnType<typeof searchMarkets>>[number]): PredictionMarketSummary {
  return {
    id: market.id,
    question: market.question ?? "",
    category: market.category ?? null,
    endDate: market.endDate ?? null,
    volume: parseNumber(market.volume),
    liquidity: parseNumber(market.liquidity),
    url: market.slug ? `https://polymarket.com/event/${market.slug}` : null
  };
}

function sentimentLabel(score: number | null): string | null {
  if (score === null) {
    return null;
  }
  if (score >= 7.5) return "bullish";
  if (score >= 6) return "positive";
  if (score > 4) return "mixed";
  if (score > 2.5) return "negative";
  return "bearish";
}

function computeOverallScore(drivers: MarketOverviewDriver[]): number | null {
  if (drivers.length === 0) {
    return 5;
  }

  const totalImpact = drivers.reduce((sum, driver) => sum + driver.impactScore, 0);
  const avgImpact = totalImpact / drivers.length;
  const uniqueSources = new Set(drivers.map((driver) => driver.source)).size;
  const conviction = Math.min(1, drivers.length / 5) * Math.min(1, uniqueSources / 3);
  const score = 5 + avgImpact * 2.5 * conviction;
  return Math.max(1, Math.min(10, Number(score.toFixed(1))));
}

function buildMajorSummary(asset: MajorAsset, score: number | null, drivers: MarketOverviewDriver[], markets: PredictionMarketSummary[]): string[] {
  const summary: string[] = [];
  const label = sentimentLabel(score);
  if (label) {
    summary.push(`${MAJOR_ASSETS[asset].label} sentiment is currently ${label}.`);
  }

  if (drivers.length > 0) {
    summary.push(`${drivers.length} high-signal items were ranked across X, Reddit, and Polymarket.`);
  }

  if (markets.length > 0) {
    summary.push(`${markets.length} relevant Polymarket markets were included for macro context.`);
  }

  return summary;
}

function buildTopDriverScore(metrics: Record<string, number | null> | undefined, contentScore: number, fallbackWeight = 1): number {
  if (!metrics) {
    return Number((contentScore * fallbackWeight).toFixed(3));
  }

  const raw = Object.values(metrics).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const weight = 1 + logWeight(raw);
  return Number((contentScore * weight).toFixed(3));
}

function buildMajorXMentions(response: Awaited<ReturnType<typeof searchRecentPosts>> | null): SocialMention[] {
  const userMap = new Map((response?.includes?.users ?? []).map((user) => [user.id, user]));

  return (response?.data ?? []).map((post) => {
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
}

function buildMajorRedditMentions(response: Awaited<ReturnType<typeof searchPosts>> | null): SocialMention[] {
  return (response?.data?.children ?? []).flatMap((child) => {
    const post = child.data;
    if (!post?.id || !post.title) {
      return [];
    }

    return [{
      source: "reddit",
      id: post.id,
      title: post.selftext ? `${post.title}\n\n${post.selftext}` : post.title,
      author: post.author ?? null,
      createdAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
      url: post.permalink ? `https://reddit.com${post.permalink}` : null,
      metrics: {
        score: post.score ?? null,
        comments: post.num_comments ?? null
      }
    }];
  });
}

function buildMajorDrivers(xMentions: SocialMention[], redditMentions: SocialMention[], markets: PredictionMarketSummary[]): MarketOverviewDriver[] {
  const xDrivers = xMentions.map((mention) => ({
    ...mention,
    impactScore: buildTopDriverScore(mention.metrics, scoreTextSentiment(mention.title), 0.8)
  }));

  const redditDrivers = redditMentions.map((mention) => ({
    ...mention,
    impactScore: buildTopDriverScore(mention.metrics, scoreTextSentiment(mention.title), 1)
  }));

  const polymarketDrivers = markets.map((market) => {
    const metrics = {
      volume: market.volume,
      liquidity: market.liquidity
    };

    return {
      source: "polymarket",
      id: market.id,
      title: market.question,
      author: null,
      createdAt: market.endDate,
      url: market.url,
      metrics,
      impactScore: buildTopDriverScore(metrics, scoreTextSentiment(market.question), 1.2)
    };
  });

  return [...xDrivers, ...redditDrivers, ...polymarketDrivers]
    .filter((driver) => driver.impactScore !== 0)
    .sort((left, right) => Math.abs(right.impactScore) - Math.abs(left.impactScore))
    .slice(0, 10);
}

export async function getTokenPoolInfo(query: TokenQuery): Promise<TokenPoolInfoResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  // Primary: DexScreener (free, all chains, has everything we need)
  const dexPairs = await runProvider(providers, "dexScreener", true, () => getTokenPairs(chain, query.tokenAddress));
  const topDexPair = dexPairs?.[0];
  const networkId = CODEX_NETWORK_IDS[chain];
  let codexPairAddress: string | null = null;

  if (!topDexPair?.pairAddress && isCodexConfigured() && networkId) {
    const codexPairs = await runProvider(
      providers,
      "codex:listPairsForToken",
      true,
      () => codexListPairsForToken(query.tokenAddress, networkId, 5),
    );
    codexPairAddress = codexPairs?.data?.listPairsForToken?.[0]?.address ?? null;
  }

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
    pairAddress: topDexPair?.pairAddress ?? codexPairAddress,
    dex: formatDexLabel(topDexPair?.dexId, topDexPair?.labels),
    providers
  };

  // Cache the pair address for future OHLCV lookups
  if (result.pairAddress) {
    poolAddressCache.set(poolCacheKey(chain, query.tokenAddress), result.pairAddress);
  }

  return result;
}

export async function getTokenPriceHistory(query: PriceHistoryQuery): Promise<TokenPriceHistoryResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const days = getHistoryDays(query.limit);
  let points: TokenPricePoint[] = [];
  const majorAsset = resolveMajorAsset((query as { asset?: string }).asset, query.tokenAddress);
  const tokenAddress = query.tokenAddress ?? "";

  if (majorAsset) {
    const marketChart = await runProvider(
      providers,
      "coinGeckoMajor",
      true,
      () => getCoinMarketChart(MAJOR_ASSETS[majorAsset].coinGeckoId, days)
    );

    if (marketChart?.prices?.length) {
      points = marketChart.prices.map(([timestamp, price]) => ({
        timestamp,
        priceUsd: price
      }));
    }

    return {
      endpoint: "tokenPriceHistory",
      status: summarizeStatus(providers),
      chain,
      tokenAddress: majorAsset,
      currency: "usd",
      limit: query.limit,
      interval: query.interval,
      points,
      providers
    };
  }

  // ── EVM: GeckoTerminal OHLCV (primary) ──
  if (isEvmChain(chain)) {
    const cacheKey = poolCacheKey(chain, tokenAddress);
    let poolAddress = poolAddressCache.get(cacheKey);

    if (!poolAddress) {
      const pools = await runProvider(providers, "geckoTerminal", true, () => getGeckoTerminalTopPools(chain, tokenAddress));
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
    const beOhlcv = await runProvider(providers, "birdeye", true, () => getBirdeyeOhlcv(tokenAddress, getBirdeyeOhlcvType(query.interval), from, now));
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

  // ── Fallback: Codex token bars (OHLCV) ──
  if (points.length === 0 && isCodexConfigured()) {
    const networkId = CODEX_NETWORK_IDS[chain];
    if (networkId) {
      const now = Math.floor(Date.now() / 1000);
      const countback = getDesiredCandleCount(query.limit, query.interval);
      const codexBars = await runProvider(
        providers,
        "codex:getTokenBars",
        true,
        () => codexGetTokenBars({
          symbol: `${tokenAddress}:${networkId}`,
          from: Math.max(0, now - days * 86400),
          to: now,
          resolution: getCodexResolution(query.interval),
          countback,
          removeLeadingNullValues: false,
          removeEmptyBars: false,
          statsType: "UNFILTERED",
        }),
      );
      const bars = codexBars?.data?.getTokenBars;
      const closes = bars?.c ?? [];
      const opens = bars?.o ?? [];
      const highs = bars?.h ?? [];
      const lows = bars?.l ?? [];
      const volumes = bars?.volume ?? [];
      if (closes.length) {
        const intervalMs = getIntervalMs(query.interval);
        const endTimeMs = now * 1000;
        const startTimeMs = endTimeMs - (closes.length - 1) * intervalMs;
        points = closes.flatMap((close, index) => {
          if (close == null) {
            return [];
          }

          return [{
            timestamp: startTimeMs + index * intervalMs,
            priceUsd: close,
            open: opens[index] ?? undefined,
            high: highs[index] ?? undefined,
            low: lows[index] ?? undefined,
            close,
            volume: parseNumber(volumes[index]) ?? undefined,
          }];
        });
      }
    }
  }

  // ── Fallback: Alchemy (all chains, prices only) ──
  if (points.length === 0 && isAlchemyConfigured()) {
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - days * 86400_000).toISOString();
    const alchemyInterval = query.interval.trim().toLowerCase().endsWith("h") ? "1h" : "1d";
    const alchemy = await runProvider(providers, "alchemy", true, () => getAlchemyHistory(chain, tokenAddress, startTime, endTime, alchemyInterval));
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
    tokenAddress,
    currency: "usd",
    limit: query.limit,
    interval: query.interval,
    points,
    providers
  };
}

export async function getDetailedTokenStats(query: DetailedTokenStatsQuery): Promise<DetailedTokenStatsResponse> {
  const chain = normalizeChain(query.chain);
  const cacheKey = detailedTokenStatsCacheKey(query);
  const cached = detailedTokenStatsCache.get(cacheKey);
  if (cached && isCacheValid(cached, DETAILED_TOKEN_STATS_TTL_MS)) {
    return { ...cached.data, cached: true };
  }

  const providers: ProviderStatus[] = [];
  const networkId = CODEX_NETWORK_IDS[chain];
  const durations = parseDetailedDurations(query.durations);
  const result = await runProvider(
    providers,
    "codex:getDetailedTokenStats",
    isCodexConfigured() && !!networkId,
    () => codexGetDetailedTokenStats(
      query.tokenAddress,
      networkId,
      durations,
      query.bucketCount,
      query.statsType as CodexStatsType,
      query.timestamp,
    ),
    networkId ? "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io" : `Unknown network: ${query.chain}`,
  );

  const stats = result?.data?.getDetailedTokenStats;
  const response: DetailedTokenStatsResponse = {
    endpoint: "detailedTokenStats",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    cached: false,
    bucketCount: query.bucketCount,
    statsType: (stats?.statsType as "FILTERED" | "UNFILTERED" | undefined) ?? null,
    lastTransactionAt: stats?.lastTransactionAt ?? null,
    durations: {
      min5: mapDetailedTokenStatsWindow(stats?.stats_min5),
      hour1: mapDetailedTokenStatsWindow(stats?.stats_hour1),
      hour4: mapDetailedTokenStatsWindow(stats?.stats_hour4),
      hour12: mapDetailedTokenStatsWindow(stats?.stats_hour12),
      day1: mapDetailedTokenStatsWindow(stats?.stats_day1),
    },
    providers,
  };

  if (providers.some((provider) => provider.status === "ok")) {
    detailedTokenStatsCache.set(cacheKey, { data: response, fetchedAt: Date.now() });
  }

  return response;
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
  const providers: ProviderStatus[] = [];

  const moralisOwnersCached = moralisOwnersCache.get(holderCacheKey(chain, query.tokenAddress, "moralisOwners:10"));
  const moralisStatsCached = moralisHolderStatsCache.get(holderCacheKey(chain, query.tokenAddress, "moralisHolderStats"));
  const birdeyeSecurityCached = birdeyeSecurityCache.get(holderCacheKey("sol", query.tokenAddress, "birdeyeSecurity"));
  const birdeyeDistributionCached = birdeyeHolderDistributionCache.get(holderCacheKey("sol", query.tokenAddress, "birdeyeHolderDistribution:10"));

  const moralisOwners = isEvmChain(chain)
    ? await getCachedMoralisOwners(providers, chain, query.tokenAddress, 10, HOLDER_TTL_MS)
    : null;
  const moralisHolderStats = isEvmChain(chain)
    ? await getCachedMoralisHolderStats(providers, chain, query.tokenAddress, HOLDER_TTL_MS)
    : null;
  const birdeyeSecurity = chain === "sol"
    ? await getCachedBirdeyeSecurity(providers, query.tokenAddress, HOLDER_TTL_MS)
    : null;
  const birdeyeDistribution = chain === "sol"
    ? await getCachedBirdeyeHolderDistribution(providers, query.tokenAddress, 10, HOLDER_TTL_MS)
    : null;

  const topHolders = chain === "sol"
    ? (birdeyeDistribution?.data?.holders ?? []).flatMap((holder) => {
        if (!holder.wallet) {
          return [];
        }

        return [{
          address: holder.wallet,
          label: null,
          entity: null,
          isContract: null,
          balance: firstNumber(holder.holding),
          balanceFormatted: firstNumber(holder.holding),
          percentOfSupply: firstNumber(holder.percent_of_supply)
        }];
      })
    : (moralisOwners?.result ?? []).flatMap((owner) => {
        if (!owner.owner_address) {
          return [];
        }

        return [{
          address: owner.owner_address,
          label: owner.owner_address_label ?? null,
          entity: owner.entity ?? null,
          isContract: owner.is_contract ?? null,
          balance: firstNumber(owner.balance),
          balanceFormatted: firstNumber(owner.balance_formatted),
          percentOfSupply: firstNumber(owner.percentage_relative_to_total_supply)
        }];
      });

  const top5Percent = sumPercentOfSupply(topHolders, 5, (holder) => holder.percentOfSupply);
  let codexTop10Percent: number | null = null;
  if (isCodexConfigured()) {
    const cacheKey = holderCacheKey(chain, query.tokenAddress, "codexTop10HoldersPercent");
    const cached = codexTop10HoldersPercentCache.get(cacheKey);
    if (isCacheValid(cached, HOLDER_TTL_MS)) {
      codexTop10Percent = cached?.data ?? null;
    } else {
      const networkId = CODEX_NETWORK_IDS[chain];
      if (networkId) {
        const codexTop10 = await runProvider(
          providers,
          "codex:top10HoldersPercent",
          true,
          () => codexTop10HoldersPercent(query.tokenAddress, networkId),
        );
        codexTop10Percent = codexTop10?.data?.top10HoldersPercent ?? null;
        codexTop10HoldersPercentCache.set(cacheKey, { data: codexTop10Percent, fetchedAt: Date.now() });
      }
    }
  }
  const top10Percent = sumPercentOfSupply(topHolders, 10, (holder) => holder.percentOfSupply)
    ?? firstNumber(birdeyeSecurity?.data?.top10HolderPercent)
    ?? normalizeRatioPercent(moralisHolderStats?.holderSupply?.top10?.supplyPercent)
    ?? codexTop10Percent;
  const largestHolderPercent = topHolders[0]?.percentOfSupply ?? null;
  const holdersOver1Pct = countPercentThreshold(topHolders, 1, (holder) => holder.percentOfSupply);
  const holdersOver5Pct = countPercentThreshold(topHolders, 5, (holder) => holder.percentOfSupply);

  const signals = buildHolderSignals({
    top5Percent,
    top10Percent,
    largestHolderPercent,
    holdersOver1Pct,
    holdersOver5Pct,
    ownerPercent: null,
    creatorPercent: null,
    ownerCanChangeBalance: null,
    failedSellers: null,
    siphonedWallets: null,
  });

  const fromCache = chain === "sol"
    ? isCacheValid(birdeyeSecurityCached, HOLDER_TTL_MS) && isCacheValid(birdeyeDistributionCached, HOLDER_TTL_MS)
    : isCacheValid(moralisOwnersCached, HOLDER_TTL_MS)
      && isCacheValid(moralisStatsCached, HOLDER_TTL_MS);

  return {
    endpoint: "holderAnalysis",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    cached: fromCache,
    summary: {
      totalHolders: firstNumber(moralisHolderStats?.totalHolders, birdeyeDistribution?.data?.summary?.wallet_count),
      analyzedHolders: topHolders.length,
      top5Percent,
      top10Percent,
      largestHolderPercent,
      holdersOver1Pct,
      holdersOver5Pct,
    },
    topHolders,
    holders: {
      total: firstNumber(moralisHolderStats?.totalHolders, birdeyeDistribution?.data?.summary?.wallet_count),
      analyzed: topHolders.length,
      lpHolders: null
    },
    distribution: {
      top25Percent: normalizeRatioPercent(moralisHolderStats?.holderSupply?.top25?.supplyPercent),
      top50Percent: normalizeRatioPercent(moralisHolderStats?.holderSupply?.top50?.supplyPercent),
      top100Percent: normalizeRatioPercent(moralisHolderStats?.holderSupply?.top100?.supplyPercent),
      whales: firstNumber(moralisHolderStats?.holderDistribution?.whales),
      sharks: firstNumber(moralisHolderStats?.holderDistribution?.sharks),
      dolphins: firstNumber(moralisHolderStats?.holderDistribution?.dolphins),
      fish: firstNumber(moralisHolderStats?.holderDistribution?.fish),
      octopus: firstNumber(moralisHolderStats?.holderDistribution?.octopus),
      crabs: firstNumber(moralisHolderStats?.holderDistribution?.crabs),
      shrimps: firstNumber(moralisHolderStats?.holderDistribution?.shrimps)
    },
    holderChange: {
      change5mPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["5min"]?.changePercent),
      change1hPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["1h"]?.changePercent),
      change6hPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["6h"]?.changePercent),
      change24hPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["24h"]?.changePercent),
      change3dPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["3d"]?.changePercent),
      change7dPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["7d"]?.changePercent),
      change30dPct: normalizeRatioPercent(moralisHolderStats?.holderChange?.["30d"]?.changePercent)
    },
    concentration: {
      top10HolderPercent: firstNumber(birdeyeSecurity?.data?.top10HolderPercent, top10Percent),
      top10UserPercent: firstNumber(birdeyeSecurity?.data?.top10UserPercent)
    },
    supply: {
      totalSupply: firstNumber(birdeyeSecurity?.data?.totalSupply, moralisOwners?.total_supply),
      lpTotalSupply: null
    },
    signals,
    providers
  };
}

export async function getFudSearch(query: FudSearchQuery): Promise<FudSearchResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const searchQuery = buildFudFetchQuery(query);

  const xResponse = await getCachedXSearch(providers, searchQuery, 100, FUD_SEARCH_TTL_MS);

  const userMap = new Map((xResponse?.includes?.users ?? []).map((user) => [user.id, user]));

  const xMentions: SocialMention[] = (xResponse?.data ?? []).flatMap((post) => {
    const matchedTerms = findMatchedFudTerms(post.text);
    if (matchedTerms.length === 0) {
      return [];
    }

    const user = post.author_id ? userMap.get(post.author_id) : undefined;

    return [{
      source: "x",
      id: post.id,
      title: post.text ?? "",
      author: user?.username ?? user?.name ?? null,
      createdAt: post.created_at ?? null,
      url: user?.username ? `https://x.com/${user.username}/status/${post.id}` : null,
      matchedTerms,
      metrics: {
        likes: post.public_metrics?.like_count ?? null,
        replies: post.public_metrics?.reply_count ?? null,
        reposts: post.public_metrics?.retweet_count ?? null,
        impressions: post.public_metrics?.impression_count ?? null,
        followers: user?.public_metrics?.followers_count ?? null
      }
    }];
  });

  return {
    endpoint: "fudSearch",
    status: summarizeStatus(providers),
    chain,
    query: searchQuery,
    mentions: xMentions,
    providers
  };
}

export async function getMarketOverview(query: MarketOverviewQuery): Promise<MarketOverviewResponse> {
  const majorAsset = resolveMajorAsset(query.asset, query.tokenAddress);

  if (majorAsset) {
    const cachedResponse = marketOverviewCache.get(`major:${majorAsset}`);
    if (cachedResponse && isCacheValid(cachedResponse, MARKET_OVERVIEW_TTL_MS)) {
      return {
        ...cachedResponse.data,
        cached: true
      };
    }

    const providers: ProviderStatus[] = [];
    const xQuery = buildMajorXQuery(majorAsset);
    const redditQuery = buildMajorRedditQuery(majorAsset);
    const polymarketQuery = MAJOR_ASSETS[majorAsset].label;

    const [xResponse, redditResponse, polymarketResponse] = await Promise.all([
      getCachedXSearch(providers, xQuery, 50, MARKET_OVERVIEW_TTL_MS),
      getCachedRedditSearch(providers, redditQuery, MARKET_OVERVIEW_TTL_MS),
      getCachedPolymarketSearch(providers, polymarketQuery, MARKET_OVERVIEW_TTL_MS)
    ]);

    const xMentions = buildMajorXMentions(xResponse);
    const redditMentions = buildMajorRedditMentions(redditResponse);
    const predictionMarkets = (polymarketResponse ?? []).map(buildPredictionMarketSummary);
    const topDrivers = buildMajorDrivers(xMentions, redditMentions, predictionMarkets);
    const overallScore = computeOverallScore(topDrivers);

    const response: MarketOverviewResponse = {
      endpoint: "marketOverview",
      status: summarizeStatus(providers),
      mode: "major",
      chain: null,
      tokenAddress: null,
      asset: majorAsset,
      cached: providers.every((provider) => provider.status !== "ok" || provider.detail === "cached"),
      overallScore,
      sentimentLabel: sentimentLabel(overallScore),
      summary: buildMajorSummary(majorAsset, overallScore, topDrivers, predictionMarkets),
      topDrivers,
      pool: null,
      risk: null,
      social: null,
      sources: {
        xMentions,
        redditMentions,
        polymarketMarkets: predictionMarkets
      },
      predictionMarkets,
      providers
    };

    marketOverviewCache.set(`major:${majorAsset}`, { data: response, fetchedAt: Date.now() });
    return response;
  }

  const chain = normalizeChain(query.chain);
  const tokenQuery: TokenQuery = {
    chain,
    tokenAddress: query.tokenAddress ?? "",
    poolAddress: query.poolAddress,
    symbol: query.symbol,
    tokenName: query.tokenName
  };

  const [pool, risk, social] = await Promise.all([
    getTokenPoolInfo(tokenQuery),
    getIsScam(tokenQuery),
    query.tokenName || query.symbol
      ? getFudSearch({
          chain,
          tokenAddress: tokenQuery.tokenAddress,
          tokenName: tokenQuery.tokenName,
          symbol: tokenQuery.symbol
        })
      : Promise.resolve(null)
  ]);

  return {
    endpoint: "marketOverview",
    status: [pool.status, risk.status, social?.status ?? "partial"].includes("live") ? "live" : "partial",
    mode: "token",
    chain,
    tokenAddress: tokenQuery.tokenAddress,
    asset: null,
    cached: false,
    overallScore: null,
    sentimentLabel: null,
    summary: [],
    topDrivers: [],
    pool,
    risk,
    social,
    sources: {
      xMentions: social?.mentions ?? [],
      redditMentions: [],
      polymarketMarkets: []
    },
    predictionMarkets: [],
    providers: []
  };
}