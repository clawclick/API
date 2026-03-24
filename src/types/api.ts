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

export type WalletPerformanceToken = {
  tokenAddress: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  chain: string | null;
  realizedPnlUsd: number | null;
  realizedRoiPct: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedRoiPct: number | null;
  averageBuyPrice: number | null;
  averageSellPrice: number | null;
  amountBought: number | null;
  amountSold: number | null;
  amountHeld: number | null;
  costBasisUsd: number | null;
  lastTradeAt: string | null;
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
  performance: {
    winRate: number | null;
    tradedTokenCount: number | null;
    tradedTimes: number | null;
    realizedPnlUsd: number | null;
    realizedPnlPercent: number | null;
    pagination: {
      page: number | null;
      perPage: number | null;
      isLastPage: boolean | null;
    } | null;
    topTokens: Array<{
      tokenAddress: string | null;
      tokenSymbol: string | null;
      chain: string | null;
      realizedPnlUsd: number | null;
      realizedRoiPct: number | null;
    }>;
  };
  tokenPerformance: WalletPerformanceToken[];
  topHoldings: WalletHolding[];
  topProtocols: WalletProtocol[];
  recentActivity: WalletActivity[];
  riskyApprovals: WalletApproval[];
  providers: ProviderStatus[];
};

export type WalletChartResponse = {
  endpoint: "walletChart";
  status: "live" | "partial";
  walletAddress: string;
  requestedChain: "eth" | "base" | "bsc" | "sol" | null;
  chartPeriod: "max";
  currency: "usd";
  chains: Array<"eth" | "base" | "bsc" | "sol">;
  chainIds: {
    eth: "ethereum";
    base: "base";
    sol: "solana";
    bsc: "binance-smart-chain";
  };
  appliedChainIds: string[] | null;
  chart: {
    data?: unknown;
    links?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  } | null;
  providers: ProviderStatus[];
};

export type NansenPagination = {
  page: number;
  perPage: number;
  isLastPage: boolean | null;
};

export type TokenScreenerItem = {
  chain: string | null;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  tokenAgeDays: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  priceChangePct: number | null;
  fdvUsd: number | null;
  fdvMcRatio: number | null;
  buyVolumeUsd: number | null;
  inflowFdvRatio: number | null;
  outflowFdvRatio: number | null;
  sellVolumeUsd: number | null;
  volumeUsd: number | null;
  netflowUsd: number | null;
};

export type TokenScreenerResponse = {
  endpoint: "tokenScreener";
  status: "live" | "partial";
  chains: string[];
  presetApplied?: string | null;
  timeframe: string | null;
  dateRange: {
    from: string;
    to: string;
  } | null;
  count: number;
  summary: {
    positiveNetflowCount: number;
    negativeNetflowCount: number;
    strongestInflow: TokenScreenerItem | null;
  };
  pagination: NansenPagination;
  tokens: TokenScreenerItem[];
  providers: ProviderStatus[];
};

export type AddressRelatedWalletItem = {
  address: string | null;
  addressLabel: string | null;
  relation: string | null;
  transactionHash: string | null;
  blockTimestamp: string | null;
  order: number | null;
  chain: string | null;
};

export type AddressRelatedWalletsResponse = {
  endpoint: "addressRelatedWallets";
  status: "live" | "partial";
  address: string;
  chain: string;
  count: number;
  summary: {
    relationTypes: string[];
    latestInteractionAt: string | null;
  };
  pagination: NansenPagination;
  relatedWallets: AddressRelatedWalletItem[];
  providers: ProviderStatus[];
};

export type JupiterDcaItem = {
  sinceTimestamp: string | null;
  lastTimestamp: string | null;
  traderAddress: string | null;
  creationHash: string | null;
  traderLabel: string | null;
  dcaVaultAddress: string | null;
  inputMintAddress: string | null;
  outputMintAddress: string | null;
  depositAmount: number | null;
  depositSpent: number | null;
  otherTokenRedeemed: number | null;
  statusLabel: string | null;
  tokenInput: string | null;
  tokenOutput: string | null;
  depositUsdValue: number | null;
};

export type JupiterDcasResponse = {
  endpoint: "jupiterDcas";
  status: "live" | "partial";
  chain: "solana";
  tokenAddress: string;
  presetApplied?: string | null;
  count: number;
  summary: {
    activeCount: number;
    closedCount: number;
    totalDepositUsdValue: number;
  };
  pagination: NansenPagination;
  orders: JupiterDcaItem[];
  providers: ProviderStatus[];
};

export type SmartMoneyNetflowItem = {
  tokenAddress: string | null;
  tokenSymbol: string | null;
  netFlow1hUsd: number | null;
  netFlow24hUsd: number | null;
  netFlow7dUsd: number | null;
  netFlow30dUsd: number | null;
  chain: string | null;
  tokenSectors: string[];
  traderCount: number | null;
  tokenAgeDays: number | null;
  marketCapUsd: number | null;
};

export type SmartMoneyNetflowResponse = {
  endpoint: "smartMoneyNetflow";
  status: "live" | "partial";
  chains: string[];
  presetApplied?: string | null;
  count: number;
  summary: {
    accumulationCount: number;
    distributionCount: number;
    strongestInflow: SmartMoneyNetflowItem | null;
    strongestOutflow: SmartMoneyNetflowItem | null;
  };
  pagination: NansenPagination;
  tokens: SmartMoneyNetflowItem[];
  providers: ProviderStatus[];
};

export type NansenPresetTemplate = {
  id: "buyCandidates" | "avoidTokens" | "solDcaAccumulation";
  endpoint: "tokenScreener" | "smartMoneyNetflow" | "jupiterDcas";
  label: string;
  intent: string;
  requestTemplate: Record<string, unknown>;
};

export type NansenPresetsResponse = {
  endpoint: "nansenPresets";
  status: "live";
  count: number;
  presets: NansenPresetTemplate[];
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
  isLatestPrice?: boolean;
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

export type DetailedTokenStatsMetric = {
  currentValue: number | null;
  previousValue: number | null;
  change: number | null;
};

export type DetailedTokenStatsWindow = {
  duration: string | null;
  start: number | null;
  end: number | null;
  statsUsd: {
    volume: DetailedTokenStatsMetric | null;
    buyVolume: DetailedTokenStatsMetric | null;
    sellVolume: DetailedTokenStatsMetric | null;
    open: DetailedTokenStatsMetric | null;
    highest: DetailedTokenStatsMetric | null;
    lowest: DetailedTokenStatsMetric | null;
    close: DetailedTokenStatsMetric | null;
    liquidity: DetailedTokenStatsMetric | null;
  };
  statsNonCurrency: {
    transactions: DetailedTokenStatsMetric | null;
    buys: DetailedTokenStatsMetric | null;
    sells: DetailedTokenStatsMetric | null;
    traders: DetailedTokenStatsMetric | null;
    buyers: DetailedTokenStatsMetric | null;
    sellers: DetailedTokenStatsMetric | null;
  };
};

export type DetailedTokenStatsResponse = {
  endpoint: "detailedTokenStats";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  cached: boolean;
  bucketCount: number;
  statsType: "FILTERED" | "UNFILTERED" | null;
  lastTransactionAt: number | null;
  durations: {
    min5: DetailedTokenStatsWindow | null;
    hour1: DetailedTokenStatsWindow | null;
    hour4: DetailedTokenStatsWindow | null;
    hour12: DetailedTokenStatsWindow | null;
    day1: DetailedTokenStatsWindow | null;
  };
  providers: ProviderStatus[];
};

export type RateMyEntryFactor = {
  name: string;
  status: "bullish" | "bearish" | "neutral";
  score: number;
  maxScore: number;
  detail: string;
};

export type RateMyEntryResponse = {
  endpoint: "rateMyEntry";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  indicatorTimeFrame: string;
  cached: boolean;
  rating: {
    score: number;
    maxScore: 10;
    label: "strong" | "good" | "mixed" | "poor";
    action: "enter_now" | "wait_for_pullback" | "avoid";
    summary: string;
    betterEntryPriceUsd: number | null;
    betterEntryDiscountPct: number | null;
    suggestedTakeProfitUsd: number | null;
    estimatedUpsidePct: number | null;
    requiredConfirmations: string[];
    hardStops: string[];
  };
  market: {
    currentPriceUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    priceChange24hPct: number | null;
  };
  range: {
    supportUsd: number | null;
    resistanceUsd: number | null;
    currentPosition: number | null;
    rangeWidthPct: number | null;
  };
  indicators: {
    summarySignal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    rsi: number | null;
    rsiSignal: "overbought" | "oversold" | "neutral" | null;
    macdHistogram: number | null;
    macdTrend: "bullish" | "bearish" | "neutral" | null;
    bollingerPercentB: number | null;
    vwapUsd: number | null;
    emaShortUsd: number | null;
    emaMediumUsd: number | null;
    emaLongUsd: number | null;
    emaStack: "bullish" | "bearish" | "mixed" | "unknown";
    latestCandle: "bullish" | "bearish" | "flat" | "unknown";
  };
  volume: {
    threshold24hUsd: number;
    thresholdLiquidityUsd: number;
    hour1VolumeUsd: number | null;
    hour4VolumeUsd: number | null;
    volumeConsistencyPct: number | null;
    latestCandleVolume: number | null;
    recentAverageCandleVolume: number | null;
    volumeVsRecentAveragePct: number | null;
    buySellRatio: number | null;
    buyers: number | null;
    sellers: number | null;
  };
  risk: {
    isScam: boolean | null;
    riskLevel: number | null;
    warnings: string[];
  };
  factors: RateMyEntryFactor[];
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
  amountOutMin: string | null;
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

export type ApproveStep = {
  kind: "erc20" | "permit2";
  label: string;
  spender: string;
  tx: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    from: string;
    gasLimit?: string;
  };
};

export type ApproveResponse = {
  endpoint: "approve";
  status: "live" | "partial";
  chain: string;
  dex: string;
  tokenIn: string;
  tokenOut: string;
  approvalMode: "auto" | "erc20" | "permit2";
  resolvedMode: "erc20" | "permit2" | "none";
  spender: string | null;
  steps: ApproveStep[];
  notes: string[];
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

export type GetTopEthTokenPrice = {
  rate: number | null;
  currency: string | null;
  diff: number | null;
  diff7d: number | null;
  diff30d: number | null;
  marketCapUsd: number | null;
  availableSupply: number | null;
  volume24h: number | null;
  ts: number | null;
};

export type GetTopEthTokenContractInfo = {
  creatorAddress: string | null;
  creationTransactionHash: string | null;
  creationTimestamp: number | null;
};

export type GetTopEthToken = {
  address: string | null;
  totalSupply: string | null;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  price: GetTopEthTokenPrice | null;
  owner: string | null;
  contractInfo: GetTopEthTokenContractInfo | null;
  countOps: number | null;
  txsCount: number | null;
  totalIn: string | number | null;
  totalOut: string | number | null;
  transfersCount: number | null;
  ethTransfersCount: number | null;
  holdersCount: number | null;
  image: string | null;
  website: string | null;
  lastUpdated: number | null;
  [key: string]: unknown;
};

export type GetTopEthTokensResponse = {
  endpoint: "getTopEthTokens";
  status: "live" | "partial";
  criteria: "trade" | "cap" | "count";
  limit: number;
  cached: boolean;
  tokens: GetTopEthToken[];
  providers: ProviderStatus[];
};

export type NewEthTradableToken = GetTopEthToken & {
  added: number | null;
};

export type GetNewEthTradableTokensResponse = {
  endpoint: "getNewEthTradableTokens";
  status: "live" | "partial";
  cached: boolean;
  tokens: NewEthTradableToken[];
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
  firstAcquired: string | null;
  hasInitiatedTransfer: boolean | null;
};

export type TokenHoldersResponse = {
  endpoint: "tokenHolders";
  status: "live" | "partial";
  cached: boolean;
  tokenAddress: string;
  network: string;
  holderCount: number | null;
  top10HoldersPercent: number | null;
  nextOffset: string | null;
  holders: TokenHolderItem[];
  providers: ProviderStatus[];
};

export type HolderListItem = {
  address: string | null;
  label: string | null;
  entity: string | null;
  isContract: boolean | null;
  balance: string | null;
  balanceFormatted: string | null;
  percentOfSupply: number | null;
};

export type HoldersResponse = {
  endpoint: "holders";
  status: "live" | "partial";
  cached: boolean;
  chain: string;
  tokenAddress: string;
  limit: number;
  holderCount: number | null;
  totalSupplyRaw: string | null;
  totalSupplyFormatted: string | null;
  holders: HolderListItem[];
  providers: ProviderStatus[];
};

export type ApiKeyGenerateResponse = {
  endpoint: "apiKeyGenerate";
  apiKey: string;
  keyId: string;
  prefix: string;
  label: string | null;
  agentId: string | null;
  agentWalletEvm: string | null;
  agentWalletSol: string | null;
  createdAt: string;
  totalGenerated: number;
  activeToday: number;
};

export type ApiKeyDeleteResponse = {
  endpoint: "apiKeyDelete";
  keyId: string;
  prefix: string;
  label: string | null;
  agentId: string | null;
  agentWalletEvm: string | null;
  agentWalletSol: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  totalRequests: number;
  deletedAt: string;
};

export type ApiStatsUserItem = {
  id: string;
  prefix: string;
  label: string | null;
  agentId: string | null;
  agentWalletEvm: string | null;
  agentWalletSol: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  totalRequests: number;
  activeToday: boolean;
  requestsToday: number;
  successfulToday: number;
  failedToday: number;
  clientErrorsToday: number;
  serverErrorsToday: number;
  successRatePctToday: number;
  failureRatePctToday: number;
  latencyToday: ApiStatsLatency;
};

export type ApiStatsAgentItem = {
  agentId: string;
  keyCount: number;
  activeKeysToday: number;
  totalRequests: number;
  requestsToday: number;
  successfulToday: number;
  failedToday: number;
  clientErrorsToday: number;
  serverErrorsToday: number;
  successRatePctToday: number;
  failureRatePctToday: number;
  latencyToday: ApiStatsLatency;
};

export type ApiAllTimeUserItem = {
  id: string;
  prefix: string;
  label: string | null;
  agentId: string | null;
  agentWalletEvm: string | null;
  agentWalletSol: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  totalRequests: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
};

export type ApiAllTimeAgentItem = {
  agentId: string;
  keyCount: number;
  totalRequests: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
};

export type ApiAllTimeUsers = {
  totalGenerated: number;
  totalEverUsed: number;
  totalAgents: number;
  totalEverUsedAgents: number;
  agents: ApiAllTimeAgentItem[];
  items: ApiAllTimeUserItem[];
};

export type ApiStatsSingleUserSummary = {
  matchedKeys: number;
  totalRequests: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
};

export type ApiStatsAgentAnalyticsItem = {
  agentId: string;
  daily: ApiStatsAgentItem;
  allTime: ApiAllTimeAgentItem;
  keys?: {
    daily: ApiStatsUserItem[];
    allTime: ApiAllTimeUserItem[];
  };
};

export type ApiStatsRequests = {
  total: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
  byEndpoint: Record<string, number>;
  byStatusCode: Record<string, number>;
  endpointBreakdown: ApiStatsRequestBreakdown[];
  providers: ApiStatsRequestProviderBreakdown[];
};

export type ApiStatsLatency = {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type ApiStatsRequestBreakdown = {
  key: string;
  total: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
};

export type ApiStatsRequestProviderBreakdown = {
  provider: string;
  total: number;
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
  successRatePct: number;
  failureRatePct: number;
  latency: ApiStatsLatency;
  endpoints: ApiStatsRequestBreakdown[];
};

export type ApiStatsUsers = {
  totalGenerated: number;
  totalEverUsed: number;
  activeToday: number;
  totalAgents: number;
  activeAgentsToday: number;
  agents: ApiStatsAgentItem[];
  items: ApiStatsUserItem[];
};

export type ApiStatsVolume = {
  chains: {
    eth: {
      unit: "wei";
      symbol: "ETH";
      buyRaw: string;
      sellRaw: string;
      buyNative: string;
      sellNative: string;
      totalRaw: string;
      totalNative: string;
      buyCount: number;
      sellCount: number;
      totalCount: number;
    };
    base: {
      unit: "wei";
      symbol: "ETH";
      buyRaw: string;
      sellRaw: string;
      buyNative: string;
      sellNative: string;
      totalRaw: string;
      totalNative: string;
      buyCount: number;
      sellCount: number;
      totalCount: number;
    };
    bsc: {
      unit: "wei";
      symbol: "BNB";
      buyRaw: string;
      sellRaw: string;
      buyNative: string;
      sellNative: string;
      totalRaw: string;
      totalNative: string;
      buyCount: number;
      sellCount: number;
      totalCount: number;
    };
    sol: {
      unit: "lamports";
      symbol: "SOL";
      buyRaw: string;
      sellRaw: string;
      buyNative: string;
      sellNative: string;
      totalRaw: string;
      totalNative: string;
      buyCount: number;
      sellCount: number;
      totalCount: number;
    };
  };
  buyCount: number;
  sellCount: number;
  totalCount: number;
};

export type ApiAllTimeVolume = ApiStatsVolume & {
  pricesUsd: {
    eth: number | null;
    bnb: number | null;
    sol: number | null;
  };
  totalVolumeUsd: number | null;
};

export type ApiStatsAllTime = {
  requests: ApiStatsRequests;
  users: ApiAllTimeUsers;
  volume: ApiAllTimeVolume;
};

export type ApiRuntimeStatsResponse = {
  endpoint: "adminStats";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  requests: ApiStatsRequests;
  users: ApiStatsUsers;
  volume: ApiStatsVolume;
  allTime: ApiStatsAllTime;
};

export type ApiStatsOverviewResponse = {
  endpoint: "stats";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  requests: {
    total: number;
    successful: number;
    failed: number;
    clientErrors: number;
    serverErrors: number;
    successRatePct: number;
    failureRatePct: number;
    latency: ApiStatsLatency;
    allTimeTotal: number;
    allTimeSuccessful: number;
    allTimeFailed: number;
    allTimeClientErrors: number;
    allTimeServerErrors: number;
    allTimeSuccessRatePct: number;
    allTimeFailureRatePct: number;
    allTimeLatency: ApiStatsLatency;
  };
  users: {
    totalGenerated: number;
    totalEverUsed: number;
    activeToday: number;
    totalAgents: number;
    activeAgentsToday: number;
  };
  volume: ApiStatsVolume;
  allTime: ApiStatsAllTime;
};

export type ApiStatsRequestsResponse = {
  endpoint: "statsRequests";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  requests: ApiStatsRequests;
  allTime: ApiStatsRequests;
};

export type ApiStatsUsersResponse = {
  endpoint: "statsUsers";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  users: ApiStatsUsers;
};

export type ApiStatsUserResponse = {
  endpoint: "statsUser";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  filter: {
    agentId: string | null;
    agentWalletEvm: string | null;
  };
  daily: {
    summary: ApiStatsSingleUserSummary;
    keys: ApiStatsUserItem[];
    apiKeys: Record<string, ApiStatsUserItem>;
  };
  allTime: {
    summary: ApiStatsSingleUserSummary;
    keys: ApiAllTimeUserItem[];
    apiKeys: Record<string, ApiAllTimeUserItem>;
  };
};

export type ApiStatsAgentsResponse = {
  endpoint: "statsAgents";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  filter: {
    agentId: string | null;
    includeKeys: boolean;
  };
  summary: {
    matchedAgents: number;
    totalAgents: number;
    activeAgentsToday: number;
    totalEverUsedAgents: number;
  };
  agents: ApiStatsAgentAnalyticsItem[];
};

export type ApiStatsVolumeResponse = {
  endpoint: "statsVolume";
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  volume: ApiStatsVolume;
  allTime: ApiAllTimeVolume;
};

export type ApiRequestsResponse = {
  endpoint: "requests";
  requests: ApiStatsRequests;
};

export type ApiVolumeResponse = {
  endpoint: "volume";
  volume: ApiAllTimeVolume;
};
