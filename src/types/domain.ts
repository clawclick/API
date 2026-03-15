export type EndpointName =
  | "walletReview"
  | "tokenPoolInfo"
  | "tokenPriceHistory"
  | "isScam"
  | "fullAudit"
  | "holderAnalysis"
  | "fudSearch"
  | "marketOverview";

export type ProviderRecord = {
  id: string;
  label: string;
  category: string;
  folder: string;
  env: string[];
  endpoints: EndpointName[];
};