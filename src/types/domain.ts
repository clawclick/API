export type EndpointName =
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
  | "tokenHolders";

export type ProviderRecord = {
  id: string;
  label: string;
  category: string;
  folder: string;
  env: string[];
  endpoints: EndpointName[];
};