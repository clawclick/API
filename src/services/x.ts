import {
  countRecentPosts,
  getPostById,
  getFollowers,
  getLikedPosts,
  getUserByUsername,
  isXConfigured,
  searchRecentPosts,
} from "#providers/sentiment/x";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import { getTokenPoolInfo, getTokenPriceHistory } from "#services/liveEndpoints";
import type {
  XCountRecentQuery,
  XKolVolumeQuery,
  XSearchQuery,
  XUserByUsernameQuery,
  XUserFollowersQuery,
  XUserLikesQuery,
} from "#routes/helpers";
import type {
  ProviderStatus,
  XCountRecentResponse,
  XKolVolumeResponse,
  XPostItem,
  XSearchResponse,
  XUserByUsernameResponse,
  XUserFollowersResponse,
  XUserLikesResponse,
  XUserSummary,
} from "#types/api";

type XUserLike = {
  id: string;
  name?: string;
  username?: string;
  verified?: boolean;
  protected?: boolean;
  created_at?: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
    like_count?: number;
  };
};

type XPostLike = {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    impression_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
};

type CacheEntry = {
  data: XKolVolumeResponse;
  expiresAt: number;
};

const X_KOL_VOLUME_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const xKolVolumeCache = new Map<string, CacheEntry>();

function mapUser(user: XUserLike | null | undefined): XUserSummary | null {
  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    name: user.name ?? null,
    username: user.username ?? null,
    verified: user.verified ?? null,
    protected: user.protected ?? null,
    createdAt: user.created_at ?? null,
    description: user.description ?? null,
    profileImageUrl: user.profile_image_url ?? null,
    metrics: {
      followers: user.public_metrics?.followers_count ?? null,
      following: user.public_metrics?.following_count ?? null,
      tweets: user.public_metrics?.tweet_count ?? null,
      listed: user.public_metrics?.listed_count ?? null,
      likes: user.public_metrics?.like_count ?? null,
    },
  };
}

function mapPosts(posts: XPostLike[] | undefined, users: XUserLike[] | undefined): XPostItem[] {
  const userMap = new Map((users ?? []).map((user) => [user.id, user]));

  return (posts ?? []).map((post) => {
    const user = post.author_id ? userMap.get(post.author_id) : undefined;

    return {
      id: post.id,
      text: post.text ?? "",
      createdAt: post.created_at ?? null,
      authorId: post.author_id ?? null,
      authorName: user?.name ?? null,
      authorUsername: user?.username ?? null,
      authorVerified: user?.verified ?? null,
      authorFollowers: user?.public_metrics?.followers_count ?? null,
      url: user?.username ? `https://x.com/${user.username}/status/${post.id}` : null,
      metrics: {
        likes: post.public_metrics?.like_count ?? null,
        replies: post.public_metrics?.reply_count ?? null,
        reposts: post.public_metrics?.retweet_count ?? null,
        quotes: post.public_metrics?.quote_count ?? null,
        bookmarks: post.public_metrics?.bookmark_count ?? null,
        impressions: post.public_metrics?.impression_count ?? null,
      },
    };
  });
}

function getXKolVolumeCacheKey(query: XKolVolumeQuery): string {
  return JSON.stringify({
    tweetUrl: query.tweetUrl ?? null,
    tokenAddress: query.tokenAddress?.trim().toLowerCase() ?? null,
    tokenName: query.tokenName?.trim().toLowerCase() ?? null,
    symbol: query.symbol?.trim().toLowerCase() ?? null,
    chain: query.chain.trim().toLowerCase(),
    timeWindowMinutes: query.timeWindowMinutes,
    maxResults: query.maxResults,
  });
}

function extractTweetId(tweetUrl: string): string | null {
  const match = tweetUrl.match(/status\/(\d+)/i);
  return match?.[1] ?? null;
}

function uniqueContractAddresses(text: string): string[] {
  return [...new Set(text.match(/0x[a-fA-F0-9]{40}/g) ?? [])];
}

function pointPrice(point: {
  priceUsd: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
} | undefined): number | null {
  if (!point) {
    return null;
  }

  return point.close ?? point.open ?? point.high ?? point.low ?? point.priceUsd ?? null;
}

function safePercentChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from <= 0) {
    return null;
  }

  return ((to - from) / from) * 100;
}

function normalizeSearchTerm(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildXKolSearchQuery(query: XKolVolumeQuery): string | null {
  const tokenAddress = normalizeSearchTerm(query.tokenAddress);
  if (tokenAddress) {
    return `${tokenAddress} -is:retweet`;
  }

  const tokenName = normalizeSearchTerm(query.tokenName);
  const symbol = normalizeSearchTerm(query.symbol)?.replace(/^[$@]+/, "");
  const terms: string[] = [];

  if (tokenName) {
    terms.push(`"${tokenName}"`);
  }

  if (symbol) {
    terms.push(`$${symbol}`);
    terms.push(symbol);
  }

  if (terms.length === 0) {
    return null;
  }

  return `${terms.join(" OR ")} -is:retweet`;
}

function mergeProviderStatuses(target: ProviderStatus[], source: ProviderStatus[]): void {
  target.push(...source);
}

async function analyzeXKolTweet(
  providers: ProviderStatus[],
  params: {
    chain: string;
    timeWindowMinutes: number;
    tweetUrl: string | null;
    requestedTokenAddress: string | null;
    requestedTokenName: string | null;
    requestedSymbol: string | null;
    searchQuery: string | null;
    matchedTweets: XPostItem[];
    tweet: XPostItem | null;
  },
): Promise<XKolVolumeResponse> {
  const { chain, timeWindowMinutes, tweetUrl, requestedTokenAddress, requestedTokenName, requestedSymbol, searchQuery, matchedTweets, tweet } = params;
  const tweetId = tweet?.id ?? null;

  const baseResponse: XKolVolumeResponse = {
    endpoint: "xKolVolume",
    status: summarizeStatus(providers),
    cached: false,
    chain,
    tweetUrl,
    tweetId,
    timeWindowMinutes,
    searchQuery,
    requestedTokenAddress,
    requestedTokenName,
    requestedSymbol,
    matchedTweets,
    tweet,
    contractAddresses: [],
    contractAddress: requestedTokenAddress,
    token: null,
    windows: {
      beforeStartAt: null,
      postAt: null,
      afterEndAt: null,
      beforeCount: 0,
      afterCount: 0,
    },
    volume: {
      beforeUsd: null,
      afterUsd: null,
      diffUsd: null,
      diffPct: null,
    },
    price: {
      beforePostUsd: null,
      atPostUsd: null,
      afterPostUsd: null,
      athAfterPostUsd: null,
      changeFromPostPct: null,
      athFromPostPct: null,
    },
    error: null,
    providers,
  };

  if (!tweet) {
    return {
      ...baseResponse,
      error: matchedTweets.length > 0
        ? "No usable tweet could be selected from the X search results."
        : "No matching tweets were found on X.",
    };
  }

  const contractAddresses = uniqueContractAddresses(tweet.text);
  const contractAddress = requestedTokenAddress ?? contractAddresses[0] ?? null;
  if (!contractAddress) {
    return {
      ...baseResponse,
      contractAddresses,
      contractAddress,
      error: "No EVM contract address was found in the selected tweet, and no tokenAddress was provided.",
    };
  }

  const tokenInfo = await getTokenPoolInfo({
    chain,
    tokenAddress: contractAddress,
    fresh: false,
  });
  mergeProviderStatuses(providers, tokenInfo.providers);

  const priceHistory = await getTokenPriceHistory({
    chain,
    tokenAddress: contractAddress,
    limit: "7d",
    interval: "1h",
  });
  mergeProviderStatuses(providers, priceHistory.providers);

  const token = {
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    priceUsd: tokenInfo.priceUsd,
    marketCapUsd: tokenInfo.marketCapUsd,
    liquidityUsd: tokenInfo.liquidityUsd,
    pairAddress: tokenInfo.pairAddress,
    dex: tokenInfo.dex,
  };

  const tweetTimeMs = tweet.createdAt ? Date.parse(tweet.createdAt) : Number.NaN;
  if (Number.isNaN(tweetTimeMs)) {
    return {
      ...baseResponse,
      status: summarizeStatus(providers),
      contractAddresses,
      contractAddress,
      token,
      error: "Tweet is missing a usable createdAt timestamp.",
    };
  }

  const windowMs = timeWindowMinutes * 60 * 1000;
  const beforeStartMs = tweetTimeMs - windowMs;
  const afterEndMs = tweetTimeMs + windowMs;
  const beforePoints = priceHistory.points.filter((point) => point.timestamp >= beforeStartMs && point.timestamp < tweetTimeMs);
  const afterPoints = priceHistory.points.filter((point) => point.timestamp >= tweetTimeMs && point.timestamp <= afterEndMs);

  if (priceHistory.points.length === 0) {
    return {
      ...baseResponse,
      status: summarizeStatus(providers),
      contractAddresses,
      contractAddress,
      token,
      windows: {
        beforeStartAt: new Date(beforeStartMs).toISOString(),
        postAt: new Date(tweetTimeMs).toISOString(),
        afterEndAt: new Date(afterEndMs).toISOString(),
        beforeCount: 0,
        afterCount: 0,
      },
      error: "No price history is available for this token.",
    };
  }

  if (beforePoints.length === 0 || afterPoints.length === 0) {
    return {
      ...baseResponse,
      status: summarizeStatus(providers),
      contractAddresses,
      contractAddress,
      token,
      windows: {
        beforeStartAt: new Date(beforeStartMs).toISOString(),
        postAt: new Date(tweetTimeMs).toISOString(),
        afterEndAt: new Date(afterEndMs).toISOString(),
        beforeCount: beforePoints.length,
        afterCount: afterPoints.length,
      },
      error: "Insufficient price history around the tweet timestamp.",
    };
  }

  const volumeBefore = beforePoints.reduce((sum, point) => sum + (point.volume ?? 0), 0);
  const volumeAfter = afterPoints.reduce((sum, point) => sum + (point.volume ?? 0), 0);
  const priceBeforePost = pointPrice(beforePoints[beforePoints.length - 1]);
  const priceAtPost = afterPoints[0]?.open ?? pointPrice(afterPoints[0]) ?? priceBeforePost;
  const priceAfterPost = pointPrice(afterPoints[afterPoints.length - 1]) ?? priceAtPost;
  const athAfterPost = afterPoints.reduce<number | null>((highest, point) => {
    const value = point.high ?? point.close ?? point.priceUsd ?? null;
    if (value == null) {
      return highest;
    }
    return highest == null ? value : Math.max(highest, value);
  }, null);

  return {
    ...baseResponse,
    status: summarizeStatus(providers),
    contractAddresses,
    contractAddress,
    token,
    windows: {
      beforeStartAt: new Date(beforeStartMs).toISOString(),
      postAt: new Date(tweetTimeMs).toISOString(),
      afterEndAt: new Date(afterEndMs).toISOString(),
      beforeCount: beforePoints.length,
      afterCount: afterPoints.length,
    },
    volume: {
      beforeUsd: volumeBefore,
      afterUsd: volumeAfter,
      diffUsd: volumeAfter - volumeBefore,
      diffPct: volumeBefore > 0 ? ((volumeAfter - volumeBefore) / volumeBefore) * 100 : null,
    },
    price: {
      beforePostUsd: priceBeforePost,
      atPostUsd: priceAtPost,
      afterPostUsd: priceAfterPost,
      athAfterPostUsd: athAfterPost,
      changeFromPostPct: safePercentChange(priceAtPost, priceAfterPost),
      athFromPostPct: safePercentChange(priceAtPost, athAfterPost),
    },
  };
}

async function resolveUserId(
  providers: ProviderStatus[],
  userId: string | undefined,
  username: string | undefined,
): Promise<{ userId: string | null; username: string | null; user: XUserSummary | null }> {
  if (userId) {
    return { userId, username: username ?? null, user: null };
  }

  if (!username) {
    return { userId: null, username: null, user: null };
  }

  const lookup = await runProvider(
    providers,
    "x:userByUsername",
    isXConfigured(),
    () => getUserByUsername(username),
    "X bearer token not configured.",
  );

  return {
    userId: lookup?.data?.id ?? null,
    username,
    user: mapUser(lookup?.data),
  };
}

export async function getXSearch(query: XSearchQuery): Promise<XSearchResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:searchRecentPosts",
    isXConfigured(),
    () => searchRecentPosts(query.query, query.maxResults),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xSearch",
    status: summarizeStatus(providers),
    query: query.query,
    maxResults: query.maxResults,
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    posts: mapPosts(result?.data, result?.includes?.users),
    providers,
  };
}

export async function getXCountRecent(query: XCountRecentQuery): Promise<XCountRecentResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:countRecentPosts",
    isXConfigured(),
    () => countRecentPosts(query.query, query.granularity),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xCountRecent",
    status: summarizeStatus(providers),
    query: query.query,
    granularity: query.granularity,
    totalPostCount: result?.meta?.total_tweet_count ?? null,
    nextToken: result?.meta?.next_token ?? null,
    buckets: (result?.data ?? []).map((bucket) => ({
      start: bucket.start ?? null,
      end: bucket.end ?? null,
      postCount: bucket.tweet_count ?? null,
    })),
    providers,
  };
}

export async function getXUserByUsernameData(query: XUserByUsernameQuery): Promise<XUserByUsernameResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:userByUsername",
    isXConfigured(),
    () => getUserByUsername(query.username),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xUserByUsername",
    status: summarizeStatus(providers),
    username: query.username,
    user: mapUser(result?.data),
    providers,
  };
}

export async function getXUserLikesData(query: XUserLikesQuery): Promise<XUserLikesResponse> {
  const providers: ProviderStatus[] = [];
  const resolved = await resolveUserId(providers, query.userId, query.username);

  const result = await runProvider(
    providers,
    "x:userLikes",
    isXConfigured() && !!resolved.userId,
    () => getLikedPosts(resolved.userId!, query.maxResults, query.paginationToken),
    !isXConfigured()
      ? "X bearer token not configured."
      : "Could not resolve an X user id from the provided username.",
  );

  return {
    endpoint: "xUserLikes",
    status: summarizeStatus(providers),
    username: resolved.username,
    userId: resolved.userId ?? "",
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    posts: mapPosts(result?.data, result?.includes?.users),
    providers,
  };
}

export async function getXUserFollowersData(query: XUserFollowersQuery): Promise<XUserFollowersResponse> {
  const providers: ProviderStatus[] = [];
  const resolved = await resolveUserId(providers, query.userId, query.username);

  const result = await runProvider(
    providers,
    "x:userFollowers",
    isXConfigured() && !!resolved.userId,
    () => getFollowers(resolved.userId!, query.maxResults, query.paginationToken),
    !isXConfigured()
      ? "X bearer token not configured."
      : "Could not resolve an X user id from the provided username.",
  );

  return {
    endpoint: "xUserFollowers",
    status: summarizeStatus(providers),
    username: resolved.username,
    userId: resolved.userId ?? "",
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    followers: (result?.data ?? []).map((user) => mapUser(user)).filter((user): user is XUserSummary => user !== null),
    providers,
  };
}

export async function getXKolVolumeData(query: XKolVolumeQuery): Promise<XKolVolumeResponse> {
  const cacheKey = getXKolVolumeCacheKey(query);
  const cached = xKolVolumeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const providers: ProviderStatus[] = [];
  const chain = query.chain.trim().toLowerCase();
  const timeWindowMinutes = query.timeWindowMinutes;
  const requestedTokenAddress = normalizeSearchTerm(query.tokenAddress);
  const requestedTokenName = normalizeSearchTerm(query.tokenName);
  const requestedSymbol = normalizeSearchTerm(query.symbol);
  const directTweetUrl = normalizeSearchTerm(query.tweetUrl);
  const searchQuery = directTweetUrl ? null : buildXKolSearchQuery(query);

  let matchedTweets: XPostItem[] = [];
  let selectedTweet: XPostItem | null = null;
  let response: XKolVolumeResponse;

  if (directTweetUrl) {
    const tweetId = extractTweetId(directTweetUrl);
    if (!tweetId) {
      response = {
        endpoint: "xKolVolume",
        status: "partial",
        cached: false,
        chain,
        tweetUrl: directTweetUrl,
        tweetId: null,
        timeWindowMinutes,
        searchQuery,
        requestedTokenAddress,
        requestedTokenName,
        requestedSymbol,
        matchedTweets,
        tweet: null,
        contractAddresses: [],
        contractAddress: requestedTokenAddress,
        token: null,
        windows: {
          beforeStartAt: null,
          postAt: null,
          afterEndAt: null,
          beforeCount: 0,
          afterCount: 0,
        },
        volume: {
          beforeUsd: null,
          afterUsd: null,
          diffUsd: null,
          diffPct: null,
        },
        price: {
          beforePostUsd: null,
          atPostUsd: null,
          afterPostUsd: null,
          athAfterPostUsd: null,
          changeFromPostPct: null,
          athFromPostPct: null,
        },
        error: "Could not extract a tweet id from tweetUrl.",
        providers,
      };
      xKolVolumeCache.set(cacheKey, { data: response, expiresAt: Date.now() + X_KOL_VOLUME_CACHE_TTL_MS });
      return response;
    }

    const tweetLookup = await runProvider(
      providers,
      "x:postById",
      isXConfigured(),
      () => getPostById(tweetId),
      "X bearer token not configured.",
    );
    selectedTweet = mapPosts(tweetLookup?.data ? [tweetLookup.data] : [], tweetLookup?.includes?.users)[0] ?? null;
    matchedTweets = selectedTweet ? [selectedTweet] : [];
    response = await analyzeXKolTweet(providers, {
      chain,
      timeWindowMinutes,
      tweetUrl: directTweetUrl,
      requestedTokenAddress,
      requestedTokenName,
      requestedSymbol,
      searchQuery,
      matchedTweets,
      tweet: selectedTweet,
    });
  } else {
    const xSearchResult = await runProvider(
      providers,
      "x:searchRecentPosts",
      isXConfigured() && !!searchQuery,
      () => searchRecentPosts(searchQuery!, query.maxResults),
      !isXConfigured()
        ? "X bearer token not configured."
        : "Could not build an X search query from the provided token fields.",
    );

    matchedTweets = mapPosts(xSearchResult?.data, xSearchResult?.includes?.users);
    selectedTweet = requestedTokenAddress
      ? matchedTweets[0] ?? null
      : matchedTweets.find((tweet) => uniqueContractAddresses(tweet.text).length > 0) ?? matchedTweets[0] ?? null;

    response = await analyzeXKolTweet(providers, {
      chain,
      timeWindowMinutes,
      tweetUrl: selectedTweet?.url ?? null,
      requestedTokenAddress,
      requestedTokenName,
      requestedSymbol,
      searchQuery,
      matchedTweets,
      tweet: selectedTweet,
    });
  }

  xKolVolumeCache.set(cacheKey, { data: response, expiresAt: Date.now() + X_KOL_VOLUME_CACHE_TTL_MS });
  return response;
}
