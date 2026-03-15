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
  symbol: z.string().min(1),
  tokenName: z.string().min(1)
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

export function parseQuery<TSchema extends z.ZodTypeAny>(schema: TSchema, query: unknown): z.output<TSchema> {
  return schema.parse(query);
}