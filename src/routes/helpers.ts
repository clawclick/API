import { z } from "zod";

export const tokenQuerySchema = z.object({
  chain: z.string().min(1).default("eth"),
  tokenAddress: z.string().min(1),
  poolAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenName: z.string().optional()
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

export function parseQuery<TSchema extends z.ZodTypeAny>(schema: TSchema, query: unknown): z.output<TSchema> {
  return schema.parse(query);
}