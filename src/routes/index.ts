import type { FastifyInstance } from "fastify";
import {
  getFullAudit,
  getFudSearch,
  getHolderAnalysis,
  getIsScam,
  getMarketOverview,
  getTokenPoolInfo,
  getTokenPriceHistory
} from "#services/liveEndpoints";
import { getWalletReview } from "#services/walletReview";
import { getProviderHealth } from "#services/providerHealth";
import { getSwapTx, getSwapQuote, getSwapDexes } from "#services/swap";
import { fudSearchSchema, parseQuery, priceHistorySchema, swapDexesSchema, swapQuoteSchema, swapSchema, tokenQuerySchema, walletReviewSchema } from "#routes/helpers";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "super-api" }));

  app.get("/providers", async () => ({ providers: getProviderHealth() }));

  app.get("/tokenPoolInfo", async (request) => getTokenPoolInfo(parseQuery(tokenQuerySchema, request.query)));
  app.get("/tokenPriceHistory", async (request) => getTokenPriceHistory(parseQuery(priceHistorySchema, request.query)));
  app.get("/isScam", async (request) => getIsScam(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fullAudit", async (request) => getFullAudit(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holderAnalysis", async (request) => getHolderAnalysis(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fudSearch", async (request) => getFudSearch(parseQuery(fudSearchSchema, request.query)));
  app.get("/marketOverview", async (request) => getMarketOverview(parseQuery(tokenQuerySchema, request.query)));
  app.get("/walletReview", async (request) => getWalletReview(parseQuery(walletReviewSchema, request.query)));

  // ── DEX swap routes ──
  app.get("/swap", async (request) => getSwapTx(parseQuery(swapSchema, request.query)));
  app.get("/swapQuote", async (request) => getSwapQuote(parseQuery(swapQuoteSchema, request.query)));
  app.get("/swapDexes", async (request) => getSwapDexes(parseQuery(swapDexesSchema, request.query).chain));
}