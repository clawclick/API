import { isConfigured } from "#config/env";
import { getTokenOverview as getBirdeyeOverview, getTokenHistory as getBirdeyeHistory, isBirdeyeConfigured } from "#providers/market/birdeye";
import { getTokenMarketChart, getTokenPrice } from "#providers/market/coinGecko";
import { getTokenPairs } from "#providers/market/dexScreener";
import { getToken as getGeckoTerminalToken } from "#providers/market/geckoTerminal";
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

function buildFudQuery(query: FudSearchQuery): string {
  const parts = [query.tokenName, query.symbol];
  if (query.tokenAddress) {
    parts.push(query.tokenAddress);
  }

  return parts.filter(Boolean).join(" OR ");
}

async function getRiskBundle(chain: SupportedChain, tokenAddress: string): Promise<RiskBundle> {
  const providers: ProviderStatus[] = [];
  const honeypot = await runProvider(providers, "honeypot", isEvmChain(chain), () => getHoneypotCheck(chain, tokenAddress));
  const goPlus = await runProvider(providers, "goPlus", isEvmChain(chain), () => getTokenSecurity(chain, tokenAddress));

  return { honeypot, goPlus, providers };
}

export async function getTokenPoolInfo(query: TokenQuery): Promise<TokenPoolInfoResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  const dexPairs = await runProvider(providers, "dexScreener", isEvmChain(chain), () => getTokenPairs(chain, query.tokenAddress));
  const geckoTerminal = await runProvider(providers, "geckoTerminal", isEvmChain(chain), () => getGeckoTerminalToken(chain, query.tokenAddress));
  const coinGecko = await runProvider(providers, "coinGecko", isEvmChain(chain), () => getTokenPrice(chain, query.tokenAddress));
  const birdeye = await runProvider(providers, "birdeye", chain === "sol" && isBirdeyeConfigured(), () => getBirdeyeOverview(query.tokenAddress));

  const topDexPair = dexPairs?.[0];
  const geckoAttributes = geckoTerminal?.data?.attributes;
  const birdeyeData = birdeye?.data;

  return {
    endpoint: "tokenPoolInfo",
    status: summarizeStatus(providers),
    chain,
    tokenAddress: query.tokenAddress,
    name: birdeyeData?.name ?? topDexPair?.baseToken?.name ?? geckoAttributes?.name ?? null,
    symbol: birdeyeData?.symbol ?? topDexPair?.baseToken?.symbol ?? geckoAttributes?.symbol ?? null,
    priceUsd: firstNumber(birdeyeData?.price, topDexPair?.priceUsd, geckoAttributes?.price_usd, coinGecko?.usd),
    marketCapUsd: firstNumber(birdeyeData?.marketCap, topDexPair?.marketCap, geckoAttributes?.market_cap_usd, coinGecko?.usd_market_cap),
    fdvUsd: firstNumber(birdeyeData?.fdv, topDexPair?.fdv, geckoAttributes?.fdv_usd),
    liquidityUsd: firstNumber(birdeyeData?.liquidity, topDexPair?.liquidity?.usd, geckoAttributes?.total_reserve_in_usd),
    volume24hUsd: firstNumber(birdeyeData?.v24hUSD, topDexPair?.volume?.h24, geckoAttributes?.volume_usd?.h24, coinGecko?.usd_24h_vol),
    priceChange24hPct: firstNumber(birdeyeData?.priceChange24hPercent, topDexPair?.priceChange?.h24, coinGecko?.usd_24h_change),
    pairAddress: topDexPair?.pairAddress ?? null,
    dex: topDexPair?.dexId ?? null,
    imageUrl: geckoAttributes?.image_url ?? null,
    providers
  };
}

export async function getTokenPriceHistory(query: PriceHistoryQuery): Promise<TokenPriceHistoryResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const days = getHistoryDays(query.limit);

  const coinGeckoHistory = await runProvider(providers, "coinGecko", isEvmChain(chain), () => getTokenMarketChart(chain, query.tokenAddress, days));
  const birdeyeHistory = await runProvider(providers, "birdeye", chain === "sol" && isBirdeyeConfigured(), () => getBirdeyeHistory(query.tokenAddress, getBirdeyeHistoryType(query.limit)));

  const points: TokenPricePoint[] = (coinGeckoHistory?.prices?.map(([timestamp, price]) => ({ timestamp, priceUsd: price }))
    ?? birdeyeHistory?.data?.items?.flatMap((item) => {
      if (item.unixTime === undefined || item.value === undefined) {
        return [];
      }

      return [{ timestamp: item.unixTime * 1000, priceUsd: item.value }];
    })
    ?? []);

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
  const risk = await getRiskBundle(chain, query.tokenAddress);

  const warnings = [
    risk.honeypot?.honeypotResult?.honeypotReason,
    ...(risk.honeypot?.summary?.flags?.map((flag) => flag.description ?? flag.flag ?? "") ?? []),
    parseBooleanFlag(risk.goPlus?.cannot_buy) ? "Token may block buys." : null,
    parseBooleanFlag(risk.goPlus?.cannot_sell_all) ? "Token may prevent full sells." : null
  ].filter((value): value is string => Boolean(value));

  const riskLevel = firstNumber(risk.honeypot?.summary?.riskLevel);
  const isScam = risk.honeypot?.honeypotResult?.isHoneypot
    ?? (parseBooleanFlag(risk.goPlus?.cannot_buy) === true || parseBooleanFlag(risk.goPlus?.cannot_sell_all) === true)
    ?? (riskLevel !== null ? riskLevel >= 60 : null);

  return {
    endpoint: "isScam",
    status: summarizeStatus(risk.providers),
    chain,
    tokenAddress: query.tokenAddress,
    isScam,
    risk: risk.honeypot?.summary?.risk ?? null,
    riskLevel,
    warnings,
    providers: risk.providers
  };
}

export async function getFullAudit(query: TokenQuery): Promise<FullAuditResponse> {
  const chain = normalizeChain(query.chain);
  const risk = await getRiskBundle(chain, query.tokenAddress);
  const riskLevel = firstNumber(risk.honeypot?.summary?.riskLevel);
  const isScam = risk.honeypot?.honeypotResult?.isHoneypot
    ?? (parseBooleanFlag(risk.goPlus?.cannot_buy) === true || parseBooleanFlag(risk.goPlus?.cannot_sell_all) === true)
    ?? (riskLevel !== null ? riskLevel >= 60 : null);

  return {
    endpoint: "fullAudit",
    status: summarizeStatus(risk.providers),
    chain,
    tokenAddress: query.tokenAddress,
    summary: {
      isScam,
      risk: risk.honeypot?.summary?.risk ?? null,
      riskLevel
    },
    honeypot: {
      isHoneypot: risk.honeypot?.honeypotResult?.isHoneypot ?? null,
      buyTax: firstNumber(risk.honeypot?.simulationResult?.buyTax),
      sellTax: firstNumber(risk.honeypot?.simulationResult?.sellTax),
      transferTax: firstNumber(risk.honeypot?.simulationResult?.transferTax),
      openSource: risk.honeypot?.contractCode?.openSource ?? null,
      hasProxyCalls: risk.honeypot?.contractCode?.hasProxyCalls ?? null
    },
    goPlus: {
      cannotBuy: parseBooleanFlag(risk.goPlus?.cannot_buy),
      cannotSellAll: parseBooleanFlag(risk.goPlus?.cannot_sell_all),
      isProxy: parseBooleanFlag(risk.goPlus?.is_proxy),
      isMintable: parseBooleanFlag(risk.goPlus?.is_mintable),
      holderCount: firstNumber(risk.goPlus?.holder_count)
    },
    providers: risk.providers
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