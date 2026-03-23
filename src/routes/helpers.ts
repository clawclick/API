import { z } from "zod";

export const tokenQuerySchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  poolAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenName: z.string().optional(),
  fresh: z.preprocess((value) => value === "true" || value === true, z.boolean().default(false)),
});

export const marketOverviewSchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().optional(),
  poolAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenName: z.string().optional(),
  asset: z.string().optional()
}).refine((value) => Boolean(value.asset || value.tokenAddress), {
  message: "Provide asset for majors sentiment or tokenAddress for token market overview."
});

export const priceHistorySchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().optional(),
  asset: z.string().optional(),
  limit: z.string().default("3m"),
  interval: z.string().default("1d")
}).refine((value) => Boolean(value.asset || value.tokenAddress), {
  message: "Provide asset for majors price history or tokenAddress for token price history."
});

export const detailedTokenStatsSchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  durations: z.string().default("hour1,day1"),
  bucketCount: z.coerce.number().int().min(1).max(50).default(6),
  timestamp: z.coerce.number().int().optional(),
  statsType: z.enum(["FILTERED", "UNFILTERED"]).default("UNFILTERED"),
});

export const fudSearchSchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenName: z.string().optional()
}).refine((value) => Boolean(value.symbol || value.tokenName), {
  message: "Provide tokenName or symbol."
});

export const walletReviewSchema = z.object({
  chain: z.string().min(1).default("eth"),
  walletAddress: z.string().min(1),
  days: z.string().default("30"),
  pageCount: z.coerce.number().int().min(1).max(20).default(10)
});

export const walletChartSchema = z.object({
  walletAddress: z.string().min(1),
  chain: z.string().min(1).optional(),
});

const nansenPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(25),
});

const nansenSortOrderSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["ASC", "DESC"]),
});

const nansenPresetSchema = z.enum(["buyCandidates", "avoidTokens", "solDcaAccumulation"]);

export const tokenScreenerSchema = z.object({
  preset: nansenPresetSchema.optional(),
  chains: z.array(z.string().min(1)).min(1).max(5).optional(),
  timeframe: z.enum(["5m", "10m", "1h", "6h", "24h", "7d", "30d"]).optional(),
  date: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }).optional(),
  pagination: nansenPaginationSchema.optional(),
  filters: z.record(z.unknown()).optional(),
  order_by: z.array(nansenSortOrderSchema).optional(),
}).refine((value) => Boolean(value.preset || value.timeframe || value.date), {
  message: "Provide preset, timeframe, or date.",
}).refine((value) => !(value.timeframe && value.date), {
  message: "Use timeframe or date, not both.",
}).refine((value) => value.preset !== "solDcaAccumulation", {
  message: "solDcaAccumulation is only valid for /jupiterDcas.",
});

export const addressRelatedWalletsSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
  pagination: nansenPaginationSchema.optional(),
  order_by: z.array(nansenSortOrderSchema).optional(),
});

export const jupiterDcasSchema = z.object({
  preset: nansenPresetSchema.optional(),
  token_address: z.string().min(1).optional(),
  pagination: nansenPaginationSchema.optional(),
  filters: z.record(z.unknown()).optional(),
}).refine((value) => Boolean(value.preset || value.token_address), {
  message: "Provide preset or token_address.",
}).refine((value) => !value.preset || value.preset === "solDcaAccumulation", {
  message: "Only solDcaAccumulation is valid for /jupiterDcas.",
});

export const smartMoneyNetflowSchema = z.object({
  preset: nansenPresetSchema.optional(),
  chains: z.array(z.string().min(1)).min(1).optional(),
  filters: z.record(z.unknown()).optional(),
  premium_labels: z.boolean().optional(),
  pagination: nansenPaginationSchema.optional(),
  order_by: z.array(nansenSortOrderSchema).optional(),
}).refine((value) => Boolean(value.preset || value.chains), {
  message: "Provide preset or chains.",
}).refine((value) => value.preset !== "solDcaAccumulation", {
  message: "solDcaAccumulation is only valid for /jupiterDcas.",
});

export const nansenPresetCatalogSchema = z.object({
  endpoint: z.enum(["tokenScreener", "smartMoneyNetflow", "jupiterDcas"]).optional(),
});

export type TokenQuery = z.output<typeof tokenQuerySchema>;
export type MarketOverviewQuery = z.output<typeof marketOverviewSchema>;
export type PriceHistoryQuery = z.output<typeof priceHistorySchema>;
export type DetailedTokenStatsQuery = z.output<typeof detailedTokenStatsSchema>;
export type FudSearchQuery = z.output<typeof fudSearchSchema>;
export type WalletReviewQuery = z.output<typeof walletReviewSchema>;
export type WalletChartQuery = z.output<typeof walletChartSchema>;
export type TokenScreenerQuery = z.output<typeof tokenScreenerSchema>;
export type AddressRelatedWalletsQuery = z.output<typeof addressRelatedWalletsSchema>;
export type JupiterDcasQuery = z.output<typeof jupiterDcasSchema>;
export type SmartMoneyNetflowQuery = z.output<typeof smartMoneyNetflowSchema>;
export type NansenPresetCatalogQuery = z.output<typeof nansenPresetCatalogSchema>;

export const swapSchema = z.object({
  chain: z.string().min(1),
  dex: z.string().min(1),
  walletAddress: z.string().min(1),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amountIn: z.string().min(1),
  slippageBps: z.coerce.number().int().min(1).max(5000).default(50),
  deadline: z.coerce.number().int().optional(),
});

export const swapQuoteSchema = z.object({
  chain: z.string().min(1),
  dex: z.string().min(1),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amountIn: z.string().min(1),
  slippageBps: z.coerce.number().int().min(1).max(5000).default(50),
});

export const swapDexesSchema = z.object({
  chain: z.string().min(1),
});

export const approveSchema = z.object({
  chain: z.string().min(1),
  dex: z.string().min(1),
  walletAddress: z.string().min(1),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amount: z.string().optional(),
  approvalMode: z.enum(["auto", "erc20", "permit2"]).default("auto"),
  spender: z.string().optional(),
  expiration: z.coerce.number().int().optional(),
});

export type SwapQuery = z.output<typeof swapSchema>;
export type SwapQuoteQuery = z.output<typeof swapQuoteSchema>;
export type SwapDexesQuery = z.output<typeof swapDexesSchema>;
export type ApproveQuery = z.output<typeof approveSchema>;

export const unwrapSchema = z.object({
  chain: z.string().min(1),
  walletAddress: z.string().min(1),
  amount: z.string().min(1),
});

export type UnwrapQuery = z.output<typeof unwrapSchema>;

/* ── Discovery & Market Schemas ─────────────────────────────── */

export const topTradersSchema = z.object({
  chain: z.string().min(1).default("sol"),
  tokenAddress: z.string().min(1),
  timeFrame: z.string().default("24h"),
});

export const gasFeedSchema = z.object({
  chain: z.string().min(1).default("eth"),
});

export const getTopEthTokensSchema = z.object({
  criteria: z.enum(["trade", "cap", "count"]).default("trade"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const tokenSearchSchema = z.object({
  query: z.string().min(1),
});

export const newPairsSchema = z.object({
  source: z.enum(["all", "dexscreener", "pumpfun", "raydium", "uniswap"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type TopTradersQuery = z.output<typeof topTradersSchema>;
export type GasFeedQuery = z.output<typeof gasFeedSchema>;
export type GetTopEthTokensQuery = z.output<typeof getTopEthTokensSchema>;
export type TokenSearchQuery = z.output<typeof tokenSearchSchema>;
export type NewPairsQuery = z.output<typeof newPairsSchema>;

/* ── Codex filterTokens Schema ──────────────────────────────── */

export const filterTokensSchema = z.object({
  network: z.string().optional(),
  phrase: z.string().optional(),
  minLiquidity: z.coerce.number().optional(),
  minVolume24: z.coerce.number().optional(),
  minMarketCap: z.coerce.number().optional(),
  maxMarketCap: z.coerce.number().optional(),
  minHolders: z.coerce.number().int().optional(),
  minWalletAgeAvg: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).optional(),
  includeScams: z.preprocess((v) => v === "true" || v === true, z.boolean().optional()),
  launchpadName: z.string().optional(),
  launchpadCompleted: z.preprocess((v) => v === "true" || v === true ? true : v === "false" || v === false ? false : undefined, z.boolean().optional()),
  statsType: z.enum(["FILTERED", "UNFILTERED"]).optional(),
});

export type FilterTokensQuery = z.output<typeof filterTokensSchema>;

/* ── Codex filterWallets Schema ──────────────────────────────── */

export const filterWalletsSchema = z.object({
  network: z.string().optional(),
  timeFrame: z.enum(["1d", "1w", "30d", "1y"]).default("1w"),
  minPnl: z.coerce.number().optional(),
  minWinRate: z.coerce.number().optional(),
  minSwaps: z.coerce.number().int().optional(),
  minVolume: z.coerce.number().optional(),
  labels: z.string().optional(),
  excludeLabels: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).optional(),
});

export type FilterWalletsQuery = z.output<typeof filterWalletsSchema>;

/* ── Codex tokenWallets Schema ──────────────────────────────── */

export const tokenWalletsSchema = z.object({
  tokenAddress: z.string().min(1),
  network: z.string().min(1).default("eth"),
  timeFrame: z.enum(["1d", "1w", "30d", "1y"]).default("30d"),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).optional(),
});

export type TokenWalletsQuery = z.output<typeof tokenWalletsSchema>;

/* ── Codex walletStats Schema ───────────────────────────────── */

export const walletStatsSchema = z.object({
  walletAddress: z.string().min(1),
});

export type WalletStatsQuery = z.output<typeof walletStatsSchema>;

/* ── Codex tokenHolders Schema ──────────────────────────────── */

export const tokenHoldersSchema = z.object({
  tokenAddress: z.string().min(1),
  network: z.string().min(1).default("eth"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type TokenHoldersQuery = z.output<typeof tokenHoldersSchema>;

export const holdersSchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(150).default(150),
});

export type HoldersQuery = z.output<typeof holdersSchema>;

export const apiKeyGenerateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  agentId: z.string().trim().min(1).max(120).optional(),
  agentWalletEvm: z.string().trim().min(1).max(120).optional(),
  agentWalletSol: z.string().trim().min(1).max(120).optional(),
});

export type ApiKeyGenerateQuery = z.output<typeof apiKeyGenerateSchema>;

export const apiKeyDeleteSchema = z.object({
  keyId: z.string().trim().min(1).max(120),
});

export type ApiKeyDeleteQuery = z.output<typeof apiKeyDeleteSchema>;

export const statsAgentsSchema = z.object({
  agentId: z.string().trim().min(1).max(120).optional(),
  includeKeys: z.preprocess((value) => value === "true" || value === true, z.boolean().default(false)),
});

export type StatsAgentsQuery = z.output<typeof statsAgentsSchema>;

export const statsUserSchema = z.object({
  agentId: z.string().trim().min(1).max(120).optional(),
  agentWalletEvm: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Boolean(value.agentId || value.agentWalletEvm), {
  message: "Provide agentId and/or agentWalletEvm.",
});

export type StatsUserQuery = z.output<typeof statsUserSchema>;

/* ── Volatility Scanner Schema ──────────────────────────────── */

export const volatilityScannerSchema = z.object({
  chain: z.string().min(1).default("sol"),
  minVolume: z.coerce.number().min(0).default(100_000),
  minSwingPct: z.coerce.number().min(0).default(10),
  duration: z.string().default("hour4,day1"),
  maxResults: z.coerce.number().int().min(1).max(50).default(20),
});

export type VolatilityScannerQuery = z.output<typeof volatilityScannerSchema>;

/* ── Price History Indicators Schema ─────────────────────────── */

export const priceHistoryIndicatorsSchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  indicatorTimeFrame: z.enum(["1m", "5m", "10m", "15m", "30m", "1h", "4h", "1d"]).default("1h"),
});

export type PriceHistoryIndicatorsQuery = z.output<typeof priceHistoryIndicatorsSchema>;

export const rateMyEntrySchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  indicatorTimeFrame: z.enum(["1m", "5m", "10m", "15m", "30m", "1h", "4h", "1d"]).default("1h"),
});

export type RateMyEntryQuery = z.output<typeof rateMyEntrySchema>;

export function parseQuery<TSchema extends z.ZodTypeAny>(schema: TSchema, query: unknown): z.output<TSchema> {
  return schema.parse(query);
}