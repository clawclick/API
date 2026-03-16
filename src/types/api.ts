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

/* ── Discovery & Market Endpoints ──────────────────────────── */

export type TrendingToken = {
  chainId: string | null;
  tokenAddress: string | null;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  priceChange24hPct: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  boostAmount: number | null;
  pairAddress: string | null;
  dex: string | null;
  source: string;
};

export type TrendingTokensResponse = {
  endpoint: "trendingTokens";
  status: "live" | "partial";
  tokens: TrendingToken[];
  providers: ProviderStatus[];
};

export type NewPairItem = {
  source: string;
  chainId: string | null;
  pairAddress: string | null;
  tokenAddress: string | null;
  name: string | null;
  symbol: string | null;
  description: string | null;
  createdAt: number | null;
  tvl: number | null;
  marketCap: number | null;
  url: string | null;
};

export type NewPairsResponse = {
  endpoint: "newPairs";
  status: "live" | "partial";
  source: string | null;
  pairs: NewPairItem[];
  providers: ProviderStatus[];
};

export type TopTraderItem = {
  address: string | null;
  tradeCount: number | null;
  volume: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
};

export type TopTradersResponse = {
  endpoint: "topTraders";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  timeFrame: string;
  traders: TopTraderItem[];
  providers: ProviderStatus[];
};

export type GasFeedResponse = {
  endpoint: "gasFeed";
  status: "live" | "partial";
  chain: string;
  lastBlock: string | null;
  safeGwei: string | null;
  proposeGwei: string | null;
  fastGwei: string | null;
  baseFeeGwei: string | null;
  providers: ProviderStatus[];
};

export type TokenSearchResult = {
  chainId: string | null;
  pairAddress: string | null;
  tokenAddress: string | null;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  priceChange24hPct: number | null;
  fdvUsd: number | null;
  dex: string | null;
};

export type TokenSearchResponse = {
  endpoint: "tokenSearch";
  status: "live" | "partial";
  query: string;
  results: TokenSearchResult[];
  providers: ProviderStatus[];
};

/* ── Codex filterTokens ───────────────────────────────────── */

export type FilteredToken = {
  address: string | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  description: string | null;
  totalSupply: string | null;
  circulatingSupply: string | null;
  createdAt: number | null;
  creatorAddress: string | null;
  priceUsd: string | null;
  liquidity: string | null;
  marketCap: string | null;
  volume24h: string | null;
  buyVolume24h: string | null;
  sellVolume24h: string | null;
  change24h: string | null;
  change1h: string | null;
  change5m: string | null;
  txnCount24h: number | null;
  buyCount24h: number | null;
  sellCount24h: number | null;
  holders: number | null;
  walletAgeAvg: string | null;
  sniperCount: number | null;
  sniperHeldPct: number | null;
  bundlerCount: number | null;
  bundlerHeldPct: number | null;
  insiderCount: number | null;
  insiderHeldPct: number | null;
  devHeldPct: number | null;
  top10HoldersPct: number | null;
  launchpad: {
    name: string | null;
    protocol: string | null;
    completed: boolean | null;
    migrated: boolean | null;
    migratedAt: number | null;
    poolAddress: string | null;
    migratedPoolAddress: string | null;
    graduationPercent: number | null;
  } | null;
  socialLinks: {
    twitter: string | null;
    telegram: string | null;
    discord: string | null;
    website: string | null;
  } | null;
  pairAddress: string | null;
};

export type FilterTokensResponse = {
  endpoint: "filterTokens";
  status: "live" | "partial";
  cached: boolean;
  count: number;
  page: number;
  tokens: FilteredToken[];
  providers: ProviderStatus[];
};

/* ── Codex launchpad WebSocket event ──────────────────────── */

export type LaunchpadEvent = {
  address: string | null;
  networkId: number | null;
  protocol: string | null;
  eventType: string | null;
  launchpadName: string | null;
  marketCap: string | null;
  price: number | null;
  liquidity: string | null;
  holders: number | null;
  volume1: number | null;
  transactions1: number | null;
  buyCount1: number | null;
  sellCount1: number | null;
  sniperCount: number | null;
  sniperHeldPercentage: number | null;
  bundlerCount: number | null;
  bundlerHeldPercentage: number | null;
  insiderCount: number | null;
  insiderHeldPercentage: number | null;
  devHeldPercentage: number | null;
  top10HoldersPercent: number | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImage: string | null;
};

/* ── Codex filterWallets ──────────────────────────────────── */

export type FilteredWallet = {
  address: string | null;
  labels: string[];
  lastTransactionAt: number | null;
  firstTransactionAt: number | null;
  volumeUsd: string | null;
  realizedProfitUsd: string | null;
  realizedProfitPct: number | null;
  winRate: number | null;
  swaps: number | null;
  uniqueTokens: number | null;
};

export type FilterWalletsResponse = {
  endpoint: "filterWallets";
  status: "live" | "partial";
  cached: boolean;
  timeFrame: string;
  count: number;
  wallets: FilteredWallet[];
  providers: ProviderStatus[];
};

/* ── Codex tokenWallets ───────────────────────────────────── */

export type TokenWalletItem = {
  address: string | null;
  tokenAddress: string | null;
  networkId: number | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  lastTransactionAt: number | null;
  tokenBalance: string | null;
  tokenBalanceLive: string | null;
  tokenBalanceLiveUsd: string | null;
  realizedProfitUsd: string | null;
  realizedProfitPct: number | null;
  buys: number | null;
  sells: number | null;
  amountBoughtUsd: string | null;
  amountSoldUsd: string | null;
};

export type TokenWalletsResponse = {
  endpoint: "tokenWallets";
  status: "live" | "partial";
  cached: boolean;
  timeFrame: string;
  tokenAddress: string;
  network: string;
  count: number;
  wallets: TokenWalletItem[];
  providers: ProviderStatus[];
};

/* ── Codex walletStats ────────────────────────────────────── */

export type WalletStatsPeriod = {
  volumeUsd: string | null;
  realizedProfitUsd: string | null;
  realizedProfitPct: number | null;
  avgProfitPerTrade: string | null;
  swaps: number | null;
  uniqueTokens: number | null;
  wins: number | null;
  losses: number | null;
};

export type WalletNetworkBalance = {
  networkId: number | null;
  nativeTokenBalance: string | null;
};

export type WalletStatsResponse = {
  endpoint: "walletStats";
  status: "live" | "partial";
  cached: boolean;
  walletAddress: string;
  lastTransactionAt: number | null;
  labels: string[];
  scammerScore: number | null;
  botScore: number | null;
  stats1d: WalletStatsPeriod | null;
  stats1w: WalletStatsPeriod | null;
  stats30d: WalletStatsPeriod | null;
  stats1y: WalletStatsPeriod | null;
  networkBalances: WalletNetworkBalance[];
  firstFunding: {
    timestamp: number | null;
    address: string | null;
  } | null;
  providers: ProviderStatus[];
};

/* ── Codex tokenHolders ───────────────────────────────────── */

export type TokenHolderItem = {
  address: string | null;
  balance: string | null;
  balanceUsd: string | null;
  firstHeldTimestamp: number | null;
};

export type TokenHoldersResponse = {
  endpoint: "tokenHolders";
  status: "live" | "partial";
  cached: boolean;
  tokenAddress: string;
  network: string;
  holderCount: number | null;
  top10HoldersPercent: number | null;
  holders: TokenHolderItem[];
  providers: ProviderStatus[];
};