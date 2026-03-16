import { z } from "zod";

export const tokenQuerySchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  poolAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenName: z.string().optional()
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

export const priceHistorySchema = tokenQuerySchema.extend({
  limit: z.string().default("3m"),
  interval: z.string().default("1d")
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

export type TokenQuery = z.output<typeof tokenQuerySchema>;
export type MarketOverviewQuery = z.output<typeof marketOverviewSchema>;
export type PriceHistoryQuery = z.output<typeof priceHistorySchema>;
export type FudSearchQuery = z.output<typeof fudSearchSchema>;
export type WalletReviewQuery = z.output<typeof walletReviewSchema>;

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

export type SwapQuery = z.output<typeof swapSchema>;
export type SwapQuoteQuery = z.output<typeof swapQuoteSchema>;
export type SwapDexesQuery = z.output<typeof swapDexesSchema>;

/* ── Discovery & Market Schemas ─────────────────────────────── */

export const topTradersSchema = z.object({
  chain: z.string().min(1).default("sol"),
  tokenAddress: z.string().min(1),
  timeFrame: z.string().default("24h"),
});

export const gasFeedSchema = z.object({
  chain: z.string().min(1).default("eth"),
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

export function parseQuery<TSchema extends z.ZodTypeAny>(schema: TSchema, query: unknown): z.output<TSchema> {
  return schema.parse(query);
}