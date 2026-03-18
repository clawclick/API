export type EndpointName =
  | "approve"
  | "walletReview"
  | "tokenPoolInfo"
  | "tokenPriceHistory"
  | "detailedTokenStats"
  | "isScam"
  | "fullAudit"
  | "holderAnalysis"
  | "fudSearch"
  | "marketOverview"
  | "filterTokens"
  | "filterWallets"
  | "tokenWallets"
  | "walletStats"
  | "tokenHolders"
  | "unwrap"
  | "swap"
  | "swapQuote"
  | "swapDexes"
  | "trendingTokens"
  | "newPairs"
  | "topTraders"
  | "gasFeed"
  | "tokenSearch"
  | "volatilityScanner"
  | "priceHistoryIndicators";

export type ProviderRecord = {
  id: string;
  label: string;
  category: string;
  folder: string;
  env: string[];
  endpoints: EndpointName[];
};