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
};

export type CodexEnhancedToken = {
  info?: CodexTokenInfo;
  createdAt?: number;
  creatorAddress?: string;
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
  freezable?: boolean;
  mintable?: boolean;
  sniperCount?: CodexNumberFilter;
  devHeldPercentage?: CodexNumberFilter;
  top10HoldersPercent?: CodexNumberFilter;
};

export type CodexRanking = {
  attribute: string;
  direction: "ASC" | "DESC";
};

const FILTER_TOKENS_QUERY = `query FilterTokens($filters: TokenFilters, $rankings: [TokenRanking], $limit: Int, $offset: Int) {
  filterTokens(filters: $filters, rankings: $rankings, limit: $limit, offset: $offset) {
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
        }
        createdAt
        creatorAddress
      }
    }
  }
}`;

export async function filterTokens(
  filters?: CodexTokenFilters,
  rankings?: CodexRanking[],
  limit = 25,
  offset?: number,
): Promise<CodexFilterTokensResponse> {
  return requestJson<CodexFilterTokensResponse>(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: getAuthHeader(),
    body: JSON.stringify({
      query: FILTER_TOKENS_QUERY,
      variables: { filters, rankings, limit, offset },
    }),
  });
}
