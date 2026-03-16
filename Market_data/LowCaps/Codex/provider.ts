// DOCS: https://docs.codex.io/api-reference/queries/filtertokens
// GraphQL endpoint: https://graph.codex.io/graphql
// Auth: Authorization header with API key

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

/* ── Types ────────────────────────────────────────────────── */

export type CodexTokenInfo = {
  address?: string;
  name?: string;
  symbol?: string;
  imageThumbUrl?: string;
  totalSupply?: string;
  circulatingSupply?: string;
  description?: string;
};

export type CodexLaunchpadData = {
  launchpadName?: string;
  launchpadProtocol?: string;
  completed?: boolean;
  migrated?: boolean;
  migratedAt?: number;
  poolAddress?: string;
  migratedPoolAddress?: string;
  graduationPercent?: number;
};

export type CodexSocialLinks = {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
};

export type CodexEnhancedToken = {
  info?: CodexTokenInfo;
  createdAt?: number;
  creatorAddress?: string;
  launchpad?: CodexLaunchpadData;
  socialLinks?: CodexSocialLinks;
};

export type CodexTokenFilterResult = {
  token?: CodexEnhancedToken;
  createdAt?: number;
  lastTransaction?: number;
  buyCount24?: number;
  sellCount24?: number;
  txnCount24?: number;
  buyVolume24?: string;
  sellVolume24?: string;
  volume24?: string;
  change24?: string;
  change1?: string;
  change5m?: string;
  priceUSD?: string;
  liquidity?: string;
  circulatingMarketCap?: string;
  holders?: number;
  walletAgeAvg?: string;
  walletAgeStd?: string;
  sniperCount?: number;
  sniperHeldPercentage?: number;
  bundlerCount?: number;
  bundlerHeldPercentage?: number;
  insiderCount?: number;
  insiderHeldPercentage?: number;
  devHeldPercentage?: number;
  top10HoldersPercent?: number;
  pair?: {
    address?: string;
    createdAt?: number;
  };
};

export type CodexFilterTokensResponse = {
  data?: {
    filterTokens?: {
      results?: CodexTokenFilterResult[];
      count?: number;
      page?: number;
    };
  };
  errors?: Array<{ message?: string }>;
};

/* ── Helpers ──────────────────────────────────────────────── */

type CodexMetricValue = string | number | null | undefined;

export type CodexDetailedValueMetric = {
  currentValue?: CodexMetricValue;
  previousValue?: CodexMetricValue;
  change?: number | null;
};

export type CodexDetailedTokenStatsWindow = {
  duration?: string;
  start?: number;
  end?: number;
  statsUsd?: {
    volume?: CodexDetailedValueMetric;
    buyVolume?: CodexDetailedValueMetric;
    sellVolume?: CodexDetailedValueMetric;
    open?: CodexDetailedValueMetric;
    highest?: CodexDetailedValueMetric;
    lowest?: CodexDetailedValueMetric;
    close?: CodexDetailedValueMetric;
    liquidity?: CodexDetailedValueMetric;
  };
  statsNonCurrency?: {
    transactions?: CodexDetailedValueMetric;
    buys?: CodexDetailedValueMetric;
    sells?: CodexDetailedValueMetric;
    traders?: CodexDetailedValueMetric;
    buyers?: CodexDetailedValueMetric;
    sellers?: CodexDetailedValueMetric;
  };
};

export type CodexDetailedTokenStatsResponse = {
  data?: {
    getDetailedTokenStats?: {
      tokenAddress?: string;
      networkId?: number;
      statsType?: CodexStatsType;
      lastTransactionAt?: number;
      stats_min5?: CodexDetailedTokenStatsWindow;
      stats_hour1?: CodexDetailedTokenStatsWindow;
      stats_hour4?: CodexDetailedTokenStatsWindow;
      stats_hour12?: CodexDetailedTokenStatsWindow;
      stats_day1?: CodexDetailedTokenStatsWindow;
    };
  };
  errors?: Array<{ message?: string }>;
};

export type CodexTokenBarsResponse = {
  data?: {
    getTokenBars?: {
      o?: Array<number | null>;
      h?: Array<number | null>;
      l?: Array<number | null>;
      c?: Array<number | null>;
      volume?: Array<string | number | null>;
    };
  };
  errors?: Array<{ message?: string }>;
};

export type CodexTop10HoldersPercentResponse = {
  data?: {
    top10HoldersPercent?: number | null;
  };
  errors?: Array<{ message?: string }>;
};

export type CodexListPairsForTokenPair = {
  address?: string;
  id?: string;
  networkId?: number;
  exchangeHash?: string;
  fee?: number | null;
  tickSpacing?: number | null;
  token0?: string;
  token1?: string;
  createdAt?: number;
  pooled?: {
    token0?: string;
    token1?: string;
  };
};

export type CodexListPairsForTokenResponse = {
  data?: {
    listPairsForToken?: CodexListPairsForTokenPair[];
  };
  errors?: Array<{ message?: string }>;
};

export function isCodexConfigured(): boolean {
  return isConfigured(getOptionalEnv("CODEX_API_KEY"));
}

function getAuthHeader(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: getRequiredEnv("CODEX_API_KEY"),
  };
}

const CODEX_GRAPHQL_URL = "https://graph.codex.io/graphql";

const DETAILED_TOKEN_STATS_QUERY = `query GetDetailedTokenStats($tokenAddress: String!, $networkId: Int!, $timestamp: Int, $durations: [DetailedTokenStatsDuration!], $bucketCount: Int, $statsType: TokenPairStatisticsType) {
  getDetailedTokenStats(tokenAddress: $tokenAddress, networkId: $networkId, timestamp: $timestamp, durations: $durations, bucketCount: $bucketCount, statsType: $statsType) {
    tokenAddress
    networkId
    statsType
    lastTransactionAt
    stats_min5 {
      duration
      start
      end
      statsUsd {
        volume { currentValue previousValue change }
        buyVolume { currentValue previousValue change }
        sellVolume { currentValue previousValue change }
        open { currentValue previousValue change }
        highest { currentValue previousValue change }
        lowest { currentValue previousValue change }
        close { currentValue previousValue change }
        liquidity { currentValue previousValue change }
      }
      statsNonCurrency {
        transactions { currentValue previousValue change }
        buys { currentValue previousValue change }
        sells { currentValue previousValue change }
        traders { currentValue previousValue change }
        buyers { currentValue previousValue change }
        sellers { currentValue previousValue change }
      }
    }
    stats_hour1 {
      duration
      start
      end
      statsUsd {
        volume { currentValue previousValue change }
        buyVolume { currentValue previousValue change }
        sellVolume { currentValue previousValue change }
        open { currentValue previousValue change }
        highest { currentValue previousValue change }
        lowest { currentValue previousValue change }
        close { currentValue previousValue change }
        liquidity { currentValue previousValue change }
      }
      statsNonCurrency {
        transactions { currentValue previousValue change }
        buys { currentValue previousValue change }
        sells { currentValue previousValue change }
        traders { currentValue previousValue change }
        buyers { currentValue previousValue change }
        sellers { currentValue previousValue change }
      }
    }
    stats_hour4 {
      duration
      start
      end
      statsUsd {
        volume { currentValue previousValue change }
        buyVolume { currentValue previousValue change }
        sellVolume { currentValue previousValue change }
        open { currentValue previousValue change }
        highest { currentValue previousValue change }
        lowest { currentValue previousValue change }
        close { currentValue previousValue change }
        liquidity { currentValue previousValue change }
      }
      statsNonCurrency {
        transactions { currentValue previousValue change }
        buys { currentValue previousValue change }
        sells { currentValue previousValue change }
        traders { currentValue previousValue change }
        buyers { currentValue previousValue change }
        sellers { currentValue previousValue change }
      }
    }
    stats_hour12 {
      duration
      start
      end
      statsUsd {
        volume { currentValue previousValue change }
        buyVolume { currentValue previousValue change }
        sellVolume { currentValue previousValue change }
        open { currentValue previousValue change }
        highest { currentValue previousValue change }
        lowest { currentValue previousValue change }
        close { currentValue previousValue change }
        liquidity { currentValue previousValue change }
      }
      statsNonCurrency {
        transactions { currentValue previousValue change }
        buys { currentValue previousValue change }
        sells { currentValue previousValue change }
        traders { currentValue previousValue change }
        buyers { currentValue previousValue change }
        sellers { currentValue previousValue change }
      }
    }
    stats_day1 {
      duration
      start
      end
      statsUsd {
        volume { currentValue previousValue change }
        buyVolume { currentValue previousValue change }
        sellVolume { currentValue previousValue change }
        open { currentValue previousValue change }
        highest { currentValue previousValue change }
        lowest { currentValue previousValue change }
        close { currentValue previousValue change }
        liquidity { currentValue previousValue change }
      }
      statsNonCurrency {
        transactions { currentValue previousValue change }
        buys { currentValue previousValue change }
        sells { currentValue previousValue change }
        traders { currentValue previousValue change }
        buyers { currentValue previousValue change }
        sellers { currentValue previousValue change }
      }
    }
  }
}`;

const TOKEN_BARS_QUERY = `query GetTokenBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!, $countback: Int, $currencyCode: QuoteCurrency, $removeLeadingNullValues: Boolean, $removeEmptyBars: Boolean, $statsType: TokenPairStatisticsType) {
  getTokenBars(symbol: $symbol, from: $from, to: $to, resolution: $resolution, countback: $countback, currencyCode: $currencyCode, removeLeadingNullValues: $removeLeadingNullValues, removeEmptyBars: $removeEmptyBars, statsType: $statsType) {
    o
    h
    l
    c
    volume
  }
}`;

const TOP_10_HOLDERS_PERCENT_QUERY = `query Top10HoldersPercent($tokenId: String!) {
  top10HoldersPercent(tokenId: $tokenId)
}`;

const LIST_PAIRS_FOR_TOKEN_QUERY = `query ListPairsForToken($tokenAddress: String!, $networkId: Int!, $limit: Int) {
  listPairsForToken(tokenAddress: $tokenAddress, networkId: $networkId, limit: $limit) {
    address
    id
    networkId
    exchangeHash
    fee
    tickSpacing
    token0
    token1
    createdAt
    pooled {
      token0
      token1
    }
  }
}`;

/* ── Network ID mapping ──────────────────────────────────── */

export const CODEX_NETWORK_IDS: Record<string, number> = {
  eth: 1,
  base: 8453,
  bsc: 56,
  sol: 1399811149,
};

/* ── filterTokens query ──────────────────────────────────── */

export type CodexNumberFilter = { gt?: number; gte?: number; lt?: number; lte?: number };

export type CodexTokenFilters = {
  network?: number | number[];
  liquidity?: CodexNumberFilter;
  volume24?: CodexNumberFilter;
  circulatingMarketCap?: CodexNumberFilter;
  buyVolume24?: CodexNumberFilter;
  sellVolume24?: CodexNumberFilter;
  txnCount24?: CodexNumberFilter;
  holders?: CodexNumberFilter;
  priceUSD?: CodexNumberFilter;
  change24?: CodexNumberFilter;
  change1?: CodexNumberFilter;
  change5m?: CodexNumberFilter;
  createdAt?: CodexNumberFilter;
  includeScams?: boolean;
  potentialScam?: boolean;
  isVerified?: boolean;
  launchpadName?: string[];
  launchpadProtocol?: string[];
  launchpadCompleted?: boolean;
  freezable?: boolean;
  mintable?: boolean;
  sniperCount?: CodexNumberFilter;
  bundlerCount?: CodexNumberFilter;
  insiderCount?: CodexNumberFilter;
  devHeldPercentage?: CodexNumberFilter;
  top10HoldersPercent?: CodexNumberFilter;
  walletAgeAvg?: CodexNumberFilter;
  buyCount1?: CodexNumberFilter;
  sellCount1?: CodexNumberFilter;
};

export type CodexStatsType = "FILTERED" | "UNFILTERED";

export type CodexRanking = {
  attribute: string;
  direction: "ASC" | "DESC";
};

const FILTER_TOKENS_QUERY = `query FilterTokens($filters: TokenFilters, $rankings: [TokenRanking], $limit: Int, $offset: Int, $phrase: String, $statsType: TokenPairStatisticsType) {
  filterTokens(filters: $filters, rankings: $rankings, limit: $limit, offset: $offset, phrase: $phrase, statsType: $statsType) {
    count
    page
    results {
      buyVolume24
      sellVolume24
      volume24
      circulatingMarketCap
      createdAt
      holders
      liquidity
      priceUSD
      change24
      change1
      change5m
      txnCount24
      buyCount24
      sellCount24
      walletAgeAvg
      walletAgeStd
      sniperCount
      sniperHeldPercentage
      bundlerCount
      bundlerHeldPercentage
      insiderCount
      insiderHeldPercentage
      devHeldPercentage
      top10HoldersPercent
      token {
        info {
          address
          name
          symbol
          imageThumbUrl
          totalSupply
          circulatingSupply
          description
        }
        createdAt
        creatorAddress
        launchpad {
          launchpadName
          launchpadProtocol
          completed
          migrated
          migratedAt
          poolAddress
          migratedPoolAddress
          graduationPercent
        }
        socialLinks {
          twitter
          telegram
          discord
          website
        }
      }
      pair {
        address
        createdAt
      }
    }
  }
}`;

/* ── filterPairs query ───────────────────────────────────── */

export type CodexPairFilters = {
  network?: number | number[];
  liquidity?: CodexNumberFilter;
  volumeUSD24?: CodexNumberFilter;
  txnCount24?: CodexNumberFilter;
  createdAt?: CodexNumberFilter;
};

export type CodexPairFilterResult = {
  pair?: {
    address?: string;
    createdAt?: number;
    token0?: string;
    token1?: string;
    exchangeHash?: string;
    networkId?: number;
  };
  token0?: string;
  token1?: string;
  liquidity?: string;
  volumeUSD24?: string;
  txnCount24?: number;
  priceUSD?: string;
  priceChange24?: string;
  buyCount24?: number;
  sellCount24?: number;
  holders?: number;
};

export type CodexFilterPairsResponse = {
  data?: {
    filterPairs?: {
      results?: CodexPairFilterResult[];
      count?: number;
      page?: number;
    };
  };
  errors?: Array<{ message?: string }>;
};

const FILTER_PAIRS_QUERY = `query FilterPairs($filters: PairFilters, $rankings: [PairRanking], $limit: Int, $offset: Int, $phrase: String, $statsType: TokenPairStatisticsType) {
  filterPairs(filters: $filters, rankings: $rankings, limit: $limit, offset: $offset, phrase: $phrase, statsType: $statsType) {
    count
    page
    results {
      liquidity
      volumeUSD24
      txnCount24
      priceUSD
      priceChange24
      buyCount24
      sellCount24
      holders
      token0
      token1
      pair {
        address
        createdAt
        token0
        token1
        exchangeHash
        networkId
      }
    }
  }
}`;

export async function filterTokens(
  filters?: CodexTokenFilters,
  rankings?: CodexRanking[],
  limit = 25,
  offset?: number,
  phrase?: string,
  statsType?: CodexStatsType,
): Promise<CodexFilterTokensResponse> {
  return requestJson<CodexFilterTokensResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: FILTER_TOKENS_QUERY,
      variables: { filters, rankings, limit, offset, phrase: phrase || undefined, statsType: statsType || undefined },
    }),
  });
}

export async function filterPairs(
  filters?: CodexPairFilters,
  rankings?: CodexRanking[],
  limit = 25,
  offset?: number,
  phrase?: string,
  statsType?: CodexStatsType,
): Promise<CodexFilterPairsResponse> {
  return requestJson<CodexFilterPairsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: FILTER_PAIRS_QUERY,
      variables: { filters, rankings, limit, offset, phrase: phrase || undefined, statsType: statsType || undefined },
    }),
  });
}

/* ── filterWallets query ─────────────────────────────────── */

export type CodexWalletTimeFrame = "1d" | "1w" | "30d" | "1y";

export type CodexWalletFilters = {
  networkId?: number;
  realizedProfitUsd?: CodexNumberFilter;
  winRate?: CodexNumberFilter;
  swaps?: CodexNumberFilter;
  volumeUsd?: CodexNumberFilter;
  uniqueTokens?: CodexNumberFilter;
  includeLabels?: string[];
  excludeLabels?: string[];
};

export type CodexWalletResult = {
  address?: string;
  labels?: string[];
  lastTransactionAt?: number;
  firstTransactionAt?: number;
  volumeUsd?: string;
  realizedProfitUsd?: string;
  realizedProfitPercentage?: number;
  winRate?: number;
  swaps?: number;
  uniqueTokens?: number;
};

export type CodexFilterWalletsResponse = {
  data?: {
    filterWallets?: {
      results?: CodexWalletResult[];
      count?: number;
      offset?: number;
    };
  };
  errors?: Array<{ message?: string }>;
};

function buildFilterWalletsQuery(tf: string): string {
  return `query FilterWallets($input: FilterWalletsInput!) {
  filterWallets(input: $input) {
    count
    offset
    results {
      address
      labels
      lastTransactionAt
      firstTransactionAt
      volumeUsd: volumeUsd${tf}
      realizedProfitUsd: realizedProfitUsd${tf}
      realizedProfitPercentage: realizedProfitPercentage${tf}
      winRate: winRate${tf}
      swaps: swaps${tf}
      uniqueTokens: uniqueTokens${tf}
    }
  }
}`;
}

export async function codexFilterWallets(
  filters: CodexWalletFilters,
  sortBy: string | undefined,
  sortDirection: string | undefined,
  limit: number,
  offset: number | undefined,
  timeFrame: CodexWalletTimeFrame = "1w",
): Promise<CodexFilterWalletsResponse> {
  const tf = timeFrame;
  const inputFilters: Record<string, unknown> = {};
  if (filters.networkId) inputFilters.networkId = filters.networkId;
  if (filters.realizedProfitUsd) inputFilters[`realizedProfitUsd${tf}`] = filters.realizedProfitUsd;
  if (filters.winRate) inputFilters[`winRate${tf}`] = filters.winRate;
  if (filters.swaps) inputFilters[`swaps${tf}`] = filters.swaps;
  if (filters.volumeUsd) inputFilters[`volumeUsd${tf}`] = filters.volumeUsd;
  if (filters.uniqueTokens) inputFilters[`uniqueTokens${tf}`] = filters.uniqueTokens;
  if (filters.includeLabels?.length) inputFilters.includeLabels = filters.includeLabels;
  if (filters.excludeLabels?.length) inputFilters.excludeLabels = filters.excludeLabels;

  const input: Record<string, unknown> = { limit, filters: inputFilters };
  if (offset != null) input.offset = offset;
  input.rankings = [{ attribute: `${sortBy ?? "realizedProfitUsd"}${tf}`, direction: sortDirection ?? "DESC" }];

  return requestJson<CodexFilterWalletsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({ query: buildFilterWalletsQuery(tf), variables: { input } }),
  });
}

/* ── filterTokenWallets query ────────────────────────────── */

export type CodexTokenWalletResult = {
  address?: string;
  tokenAddress?: string;
  networkId?: number;
  lastTransactionAt?: number;
  tokenBalance?: string;
  tokenBalanceLive?: string;
  tokenBalanceLiveUsd?: string;
  realizedProfitUsd?: string;
  realizedProfitPercentage?: number;
  buys?: number;
  sells?: number;
  amountBoughtUsd?: string;
  amountSoldUsd?: string;
  token?: { name?: string; symbol?: string };
};

export type CodexFilterTokenWalletsResponse = {
  data?: {
    filterTokenWallets?: {
      results?: CodexTokenWalletResult[];
      count?: number;
      offset?: number;
    };
  };
  errors?: Array<{ message?: string }>;
};

function buildFilterTokenWalletsQuery(tf: string): string {
  return `query FilterTokenWallets($input: FilterTokenWalletsInput!) {
  filterTokenWallets(input: $input) {
    count
    offset
    results {
      address
      tokenAddress
      networkId
      lastTransactionAt
      tokenBalance
      tokenBalanceLive
      tokenBalanceLiveUsd
      realizedProfitUsd: realizedProfitUsd${tf}
      realizedProfitPercentage: realizedProfitPercentage${tf}
      buys: buys${tf}
      sells: sells${tf}
      amountBoughtUsd: amountBoughtUsd${tf}
      amountSoldUsd: amountSoldUsd${tf}
      token { name symbol }
    }
  }
}`;
}

export async function codexFilterTokenWallets(
  tokenAddress: string,
  networkId: number,
  sortBy: string | undefined,
  sortDirection: string | undefined,
  limit: number,
  offset: number | undefined,
  timeFrame: CodexWalletTimeFrame = "30d",
): Promise<CodexFilterTokenWalletsResponse> {
  const tf = timeFrame;
  const input: Record<string, unknown> = {
    tokenIds: [`${tokenAddress}:${networkId}`],
    limit,
    rankings: [{ attribute: `${sortBy ?? "realizedProfitUsd"}${tf}`, direction: sortDirection ?? "DESC" }],
  };
  if (offset != null) input.offset = offset;

  return requestJson<CodexFilterTokenWalletsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({ query: buildFilterTokenWalletsQuery(tf), variables: { input } }),
  });
}

/* ── detailedWalletStats query ───────────────────────────── */

export type CodexStatsUsd = {
  volumeUsd?: string;
  realizedProfitUsd?: string;
  realizedProfitPercentage?: number;
  averageProfitUsdPerTrade?: string;
};

export type CodexStatsNonCurrency = {
  swaps?: number;
  uniqueTokens?: number;
  wins?: number;
  losses?: number;
};

export type CodexStatsPeriod = {
  statsUsd?: CodexStatsUsd;
  statsNonCurrency?: CodexStatsNonCurrency;
};

export type CodexNetworkBreakdown = {
  networkId?: number;
  nativeTokenBalance?: string;
};

export type CodexDetailedWalletStatsData = {
  walletAddress?: string;
  lastTransactionAt?: number;
  labels?: string[];
  scammerScore?: number;
  botScore?: number;
  statsDay1?: CodexStatsPeriod;
  statsWeek1?: CodexStatsPeriod;
  statsDay30?: CodexStatsPeriod;
  statsYear1?: CodexStatsPeriod;
  networkBreakdown?: CodexNetworkBreakdown[];
  wallet?: {
    address?: string;
    firstFunding?: {
      timestamp?: number;
      address?: string;
    };
  };
};

export type CodexDetailedWalletStatsResponse = {
  data?: {
    detailedWalletStats?: CodexDetailedWalletStatsData;
  };
  errors?: Array<{ message?: string }>;
};

const DETAILED_WALLET_STATS_QUERY = `query DetailedWalletStats($input: DetailedWalletStatsInput!) {
  detailedWalletStats(input: $input) {
    walletAddress
    lastTransactionAt
    labels
    scammerScore
    botScore
    statsDay1 {
      statsUsd { volumeUsd realizedProfitUsd realizedProfitPercentage averageProfitUsdPerTrade }
      statsNonCurrency { swaps uniqueTokens wins losses }
    }
    statsWeek1 {
      statsUsd { volumeUsd realizedProfitUsd realizedProfitPercentage averageProfitUsdPerTrade }
      statsNonCurrency { swaps uniqueTokens wins losses }
    }
    statsDay30 {
      statsUsd { volumeUsd realizedProfitUsd realizedProfitPercentage averageProfitUsdPerTrade }
      statsNonCurrency { swaps uniqueTokens wins losses }
    }
    statsYear1 {
      statsUsd { volumeUsd realizedProfitUsd realizedProfitPercentage averageProfitUsdPerTrade }
      statsNonCurrency { swaps uniqueTokens wins losses }
    }
    networkBreakdown { networkId nativeTokenBalance }
    wallet {
      address
      firstFunding { address timestamp }
    }
  }
}`;

export async function codexDetailedWalletStats(
  walletAddress: string,
): Promise<CodexDetailedWalletStatsResponse> {
  return requestJson<CodexDetailedWalletStatsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: DETAILED_WALLET_STATS_QUERY,
      variables: { input: { walletAddress } },
    }),
  });
}

/* ── holders query ───────────────────────────────────────── */

export type CodexHolderItem = {
  address?: string;
  shiftedBalance?: string;
  balanceUsd?: string;
  firstHeldTimestamp?: number;
};

export type CodexHoldersResponse = {
  data?: {
    holders?: {
      items?: CodexHolderItem[];
      count?: number;
      status?: string;
      top10HoldersPercent?: number;
    };
  };
  errors?: Array<{ message?: string }>;
};

const HOLDERS_QUERY = `query Holders($input: HoldersInput!) {
  holders(input: $input) {
    count
    status
    top10HoldersPercent
    items {
      address
      shiftedBalance
      balanceUsd
      firstHeldTimestamp
    }
  }
}`;

export async function codexHolders(
  tokenAddress: string,
  networkId: number,
  cursor?: string,
  limit = 50,
): Promise<CodexHoldersResponse> {
  const input: Record<string, unknown> = {
    tokenId: `${tokenAddress}:${networkId}`,
    limit,
  };
  if (cursor) input.cursor = cursor;

  return requestJson<CodexHoldersResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({ query: HOLDERS_QUERY, variables: { input } }),
  });
}

export async function codexGetDetailedTokenStats(
  tokenAddress: string,
  networkId: number,
  durations: string[],
  bucketCount?: number,
  statsType: CodexStatsType = "UNFILTERED",
  timestamp?: number,
): Promise<CodexDetailedTokenStatsResponse> {
  return requestJson<CodexDetailedTokenStatsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: DETAILED_TOKEN_STATS_QUERY,
      variables: {
        tokenAddress,
        networkId,
        durations,
        bucketCount,
        statsType,
        timestamp,
      },
    }),
  });
}

export async function codexGetTokenBars(input: {
  symbol: string;
  from: number;
  to: number;
  resolution: string;
  countback?: number;
  currencyCode?: "USD" | "TOKEN";
  removeLeadingNullValues?: boolean;
  removeEmptyBars?: boolean;
  statsType?: CodexStatsType;
}): Promise<CodexTokenBarsResponse> {
  return requestJson<CodexTokenBarsResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: TOKEN_BARS_QUERY,
      variables: {
        symbol: input.symbol,
        from: input.from,
        to: input.to,
        resolution: input.resolution,
        countback: input.countback,
        currencyCode: input.currencyCode ?? "USD",
        removeLeadingNullValues: input.removeLeadingNullValues ?? false,
        removeEmptyBars: input.removeEmptyBars ?? false,
        statsType: input.statsType ?? "UNFILTERED",
      },
    }),
  });
}

export async function codexTop10HoldersPercent(
  tokenAddress: string,
  networkId: number,
): Promise<CodexTop10HoldersPercentResponse> {
  return requestJson<CodexTop10HoldersPercentResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: TOP_10_HOLDERS_PERCENT_QUERY,
      variables: { tokenId: `${tokenAddress}:${networkId}` },
    }),
  });
}

export async function codexListPairsForToken(
  tokenAddress: string,
  networkId: number,
  limit = 10,
): Promise<CodexListPairsForTokenResponse> {
  return requestJson<CodexListPairsForTokenResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: LIST_PAIRS_FOR_TOKEN_QUERY,
      variables: { tokenAddress, networkId, limit },
    }),
  });
}
