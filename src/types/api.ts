export type ProviderStatus = {
  provider: string;
  status: "ok" | "skipped" | "error";
  detail?: string;
};

export type WalletHolding = {
  tokenAddress: string | null;
  chain: string;
  symbol: string | null;
  name: string | null;
  amount: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  logoUrl: string | null;
  source: string;
};

export type WalletProtocol = {
  id: string;
  chain: string;
  name: string | null;
  netUsdValue: number | null;
  assetUsdValue: number | null;
  debtUsdValue: number | null;
  siteUrl: string | null;
};

export type WalletActivity = {
  txHash: string;
  category: string;
  chain: string;
  timestamp: number | null;
  gasUsd: number | null;
  projectId: string | null;
  cexId: string | null;
  sendCount: number;
  receiveCount: number;
};

export type WalletApproval = {
  tokenId: string;
  symbol: string | null;
  chain: string;
  exposureUsd: number | null;
  spenderCount: number;
};

export type WalletReviewResponse = {
  endpoint: "walletReview";
  status: "live" | "partial";
  chain: string;
  walletAddress: string;
  days: string;
  summary: {
    totalNetWorthUsd: number | null;
    chainNetWorthUsd: number | null;
    realizedProfitUsd: number | null;
    realizedProfitPct: number | null;
    totalTradeVolumeUsd: number | null;
    totalTrades: number | null;
    totalBuys: number | null;
    totalSells: number | null;
    profitable: boolean | null;
    tokenCount: number;
    protocolCount: number;
    activeChains: string[];
    approvalExposureUsd: number | null;
    recentTransfers: number;
    recentApprovals: number;
    recentInteractions: number;
  };
  topHoldings: WalletHolding[];
  topProtocols: WalletProtocol[];
  recentActivity: WalletActivity[];
  riskyApprovals: WalletApproval[];
  providers: ProviderStatus[];
};

export type TokenPoolInfoResponse = {
  endpoint: "tokenPoolInfo";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  pairAddress: string | null;
  dex: string | null;
  imageUrl: string | null;
  providers: ProviderStatus[];
};

export type TokenPricePoint = {
  timestamp: number;
  priceUsd: number;
};

export type TokenPriceHistoryResponse = {
  endpoint: "tokenPriceHistory";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  currency: "usd";
  limit: string;
  interval: string;
  points: TokenPricePoint[];
  providers: ProviderStatus[];
};

export type IsScamResponse = {
  endpoint: "isScam";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  isScam: boolean | null;
  risk: string | null;
  riskLevel: number | null;
  warnings: string[];
  providers: ProviderStatus[];
};

export type FullAuditResponse = {
  endpoint: "fullAudit";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  summary: {
    isScam: boolean | null;
    risk: string | null;
    riskLevel: number | null;
  };
  honeypot: {
    isHoneypot: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
    transferTax: number | null;
    openSource: boolean | null;
    hasProxyCalls: boolean | null;
  };
  goPlus: {
    cannotBuy: boolean | null;
    cannotSellAll: boolean | null;
    isProxy: boolean | null;
    isMintable: boolean | null;
    holderCount: number | null;
  };
  providers: ProviderStatus[];
};

export type HolderAnalysisResponse = {
  endpoint: "holderAnalysis";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  totalHolders: number | null;
  analyzedHolders: number | null;
  successfulSellers: number | null;
  failedSellers: number | null;
  siphonedWallets: number | null;
  averageTax: number | null;
  highestTax: number | null;
  averageGas: number | null;
  providers: ProviderStatus[];
};

export type SocialMention = {
  source: string;
  id: string;
  title: string;
  author: string | null;
  createdAt: string | null;
  url: string | null;
  metrics?: Record<string, number | null>;
};

export type FudSearchResponse = {
  endpoint: "fudSearch";
  status: "live" | "partial";
  chain: string;
  query: string;
  mentions: SocialMention[];
  providers: ProviderStatus[];
};

export type MarketOverviewResponse = {
  endpoint: "marketOverview";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  pool: TokenPoolInfoResponse;
  risk: IsScamResponse;
  social: FudSearchResponse | null;
  predictionMarkets: Array<{
    id: string;
    question: string;
    category: string | null;
    endDate: string | null;
    volume: number | null;
    liquidity: number | null;
    url: string | null;
  }>;
};