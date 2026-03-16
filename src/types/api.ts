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
  providers: ProviderStatus[];
};

export type TokenPricePoint = {
  timestamp: number;
  priceUsd: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
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
  cached: boolean;
  providers: ProviderStatus[];
};

export type FullAuditResponse = {
  endpoint: "fullAudit";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  cached: boolean;
  summary: {
    isScam: boolean | null;
    risk: string | null;
    riskLevel: number | null;
    warnings: string[];
  };
  taxes: {
    buyTax: number | null;
    sellTax: number | null;
    transferTax: number | null;
  };
  contract: {
    openSource: boolean | null;
    isProxy: boolean | null;
    hasProxyCalls: boolean | null;
    isMintable: boolean | null;
    canTakeBackOwnership: boolean | null;
    hiddenOwner: boolean | null;
    selfDestruct: boolean | null;
    externalCall: boolean | null;
    ownerAddress: string | null;
    creatorAddress: string | null;
  };
  trading: {
    cannotBuy: boolean | null;
    cannotSellAll: boolean | null;
    isAntiWhale: boolean | null;
    tradingCooldown: boolean | null;
    transferPausable: boolean | null;
    personalSlippageModifiable: boolean | null;
    isBlacklisted: boolean | null;
    isWhitelisted: boolean | null;
  };
  holders: {
    holderCount: number | null;
    lpHolderCount: number | null;
    ownerPercent: number | null;
    creatorPercent: number | null;
    totalHolders: number | null;
  };
  simulation: {
    buyGas: string | null;
    sellGas: string | null;
  };
  providers: ProviderStatus[];
};

export type HolderAnalysisResponse = {
  endpoint: "holderAnalysis";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  cached: boolean;
  summary: {
    totalHolders: number | null;
    analyzedHolders: number | null;
    top5Percent: number | null;
    top10Percent: number | null;
    largestHolderPercent: number | null;
    holdersOver1Pct: number | null;
    holdersOver5Pct: number | null;
  };
  topHolders: Array<{
    address: string;
    label: string | null;
    entity: string | null;
    isContract: boolean | null;
    balance: number | null;
    balanceFormatted: number | null;
    percentOfSupply: number | null;
  }>;
  holders: {
    total: number | null;
    analyzed: number | null;
    lpHolders: number | null;
  };
  distribution: {
    top25Percent: number | null;
    top50Percent: number | null;
    top100Percent: number | null;
    whales: number | null;
    sharks: number | null;
    dolphins: number | null;
    fish: number | null;
    octopus: number | null;
    crabs: number | null;
    shrimps: number | null;
  };
  holderChange: {
    change5mPct: number | null;
    change1hPct: number | null;
    change6hPct: number | null;
    change24hPct: number | null;
    change3dPct: number | null;
    change7dPct: number | null;
    change30dPct: number | null;
  };
  concentration: {
    top10HolderPercent: number | null;
    top10UserPercent: number | null;
  };
  supply: {
    totalSupply: number | null;
    lpTotalSupply: number | null;
  };
  signals: string[];
  providers: ProviderStatus[];
};

export type SocialMention = {
  source: string;
  id: string;
  title: string;
  author: string | null;
  createdAt: string | null;
  url: string | null;
  matchedTerms?: string[];
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

export type PredictionMarketSummary = {
  id: string;
  question: string;
  category: string | null;
  endDate: string | null;
  volume: number | null;
  liquidity: number | null;
  url: string | null;
};

export type MarketOverviewDriver = {
  source: string;
  id: string;
  title: string;
  author: string | null;
  createdAt: string | null;
  url: string | null;
  impactScore: number;
  metrics?: Record<string, number | null>;
};

export type MarketOverviewResponse = {
  endpoint: "marketOverview";
  status: "live" | "partial";
  mode: "token" | "major";
  chain: string | null;
  tokenAddress: string | null;
  asset: string | null;
  cached: boolean;
  overallScore: number | null;
  sentimentLabel: string | null;
  summary: string[];
  topDrivers: MarketOverviewDriver[];
  pool: TokenPoolInfoResponse | null;
  risk: IsScamResponse | null;
  social: FudSearchResponse | null;
  sources: {
    xMentions: SocialMention[];
    redditMentions: SocialMention[];
    polymarketMarkets: PredictionMarketSummary[];
  };
  predictionMarkets: PredictionMarketSummary[];
  providers: ProviderStatus[];
};

export type SwapTxResponse = {
  endpoint: "swap";
  status: "live" | "partial";
  chain: string;
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
  tx: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    from: string;
    gasLimit?: string;
  } | {
    serializedTx: string;
    chainId: "solana";
    from: string;
  } | null;
  providers: ProviderStatus[];
};

export type SwapQuoteResponse = {
  endpoint: "swapQuote";
  status: "live" | "partial";
  chain: string;
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
  amountOut: string | null;
  amountOutMin: string | null;
  providers: ProviderStatus[];
};