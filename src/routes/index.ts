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
import { getTrendingTokens, getNewPairs, getTopTraders, getGasFeed, getTokenSearch } from "#services/discovery";
import { getFilteredTokens } from "#services/filterTokens";
import { handleClient } from "#services/launchpadStream";
import { filterTokensSchema, fudSearchSchema, gasFeedSchema, marketOverviewSchema, newPairsSchema, parseQuery, priceHistorySchema, swapDexesSchema, swapQuoteSchema, swapSchema, tokenQuerySchema, tokenSearchSchema, topTradersSchema, walletReviewSchema } from "#routes/helpers";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "super-api" }));

  app.get("/providers", async () => ({ providers: getProviderHealth() }));

  // Info routes 
  app.get("/tokenPoolInfo", async (request) => getTokenPoolInfo(parseQuery(tokenQuerySchema, request.query)));
  app.get("/tokenPriceHistory", async (request) => getTokenPriceHistory(parseQuery(priceHistorySchema, request.query)));
  app.get("/isScam", async (request) => getIsScam(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fullAudit", async (request) => getFullAudit(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holderAnalysis", async (request) => getHolderAnalysis(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fudSearch", async (request) => getFudSearch(parseQuery(fudSearchSchema, request.query)));
  app.get("/marketOverview", async (request) => getMarketOverview(parseQuery(marketOverviewSchema, request.query)));
  app.get("/walletReview", async (request) => getWalletReview(parseQuery(walletReviewSchema, request.query)));

  // DEX swap routes
  app.get("/swap", async (request) => getSwapTx(parseQuery(swapSchema, request.query)));
  app.get("/swapQuote", async (request) => getSwapQuote(parseQuery(swapQuoteSchema, request.query)));
  app.get("/swapDexes", async (request) => getSwapDexes(parseQuery(swapDexesSchema, request.query).chain));

  // Discovery & market routes
  app.get("/trendingTokens", async () => getTrendingTokens());
  app.get("/newPairs", async (request) => getNewPairs(parseQuery(newPairsSchema, request.query)));
  app.get("/topTraders", async (request) => getTopTraders(parseQuery(topTradersSchema, request.query)));
  app.get("/gasFeed", async (request) => getGasFeed(parseQuery(gasFeedSchema, request.query)));
  app.get("/tokenSearch", async (request) => getTokenSearch(parseQuery(tokenSearchSchema, request.query)));

  // Codex filterTokens (cached 5min)
  app.get("/filterTokens", async (request) => getFilteredTokens(parseQuery(filterTokensSchema, request.query)));

  // WebSocket: Codex launchpad event stream
  app.get("/ws/launchpadEvents", { websocket: true }, (socket) => {
    handleClient(socket);
  });
}