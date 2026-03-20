import type { FastifyInstance } from "fastify";
import {
  getDetailedTokenStats,
  getFullAudit,
  getFudSearch,
  getHolderAnalysis,
  getIsScam,
  getMarketOverview,
  getTokenPoolInfo,
  getTokenPriceHistory
} from "#services/liveEndpoints";
import { getApiRuntimeStats, getRequests, generateApiKey, getStatsOverview, getStatsRequests, getStatsUsers, getStatsVolume, getVolume } from "#services/apiRuntime";
import { getHolders } from "#services/holders";
import { getWalletReview } from "#services/walletReview";
import { getProviderHealth } from "#services/providerHealth";
import { getApproveTx, getSwapTx, getSwapQuote, getSwapDexes } from "#services/swap";
import { buildUnwrapTx } from "#lib/evm";
import { isNativeIn } from "#lib/evm";
import { getTrendingTokens, getNewPairs, getTopTraders, getGasFeed, getTokenSearch } from "#services/discovery";
import { getFilteredTokens } from "#services/filterTokens";
// DISABLED — Codex paid plan only 
// import { getFilteredWallets } from "#services/filterWallets";
// import { getTokenWallets } from "#services/tokenWallets";
// import { getWalletStats } from "#services/walletStats";
import { getTokenHolders } from "#services/tokenHolders";
import { handleClient } from "#services/launchpadStream";
import { listStrategies, getStrategy } from "#services/strategies";
import { scanVolatility } from "#services/volatilityScanner";
import { getPriceHistoryIndicators } from "#services/indicators";
import { approveSchema, apiKeyGenerateSchema, detailedTokenStatsSchema, filterTokensSchema, fudSearchSchema, gasFeedSchema, holdersSchema, marketOverviewSchema, newPairsSchema, parseQuery, priceHistorySchema, priceHistoryIndicatorsSchema, swapDexesSchema, swapQuoteSchema, swapSchema, tokenHoldersSchema, tokenQuerySchema, tokenSearchSchema, topTradersSchema, walletReviewSchema, unwrapSchema, volatilityScannerSchema } from "#routes/helpers";
import { recordEthSwapVolume } from "#services/apiRuntime";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "super-api" }));

  app.get("/providers", async () => ({ providers: getProviderHealth() }));

  app.post("/admin/apiKeys/generate", async (request) => {
    const query = parseQuery(apiKeyGenerateSchema, request.query);
    return generateApiKey(
      query.label ?? null,
      query.agentId ?? null,
      query.agentWalletEvm ?? null,
      query.agentWalletSol ?? null,
    );
  });
  app.get("/admin/stats/requests", async () => getRequests());
  app.get("/admin/stats", async () => getApiRuntimeStats());
  app.get("/stats", async () => getStatsOverview());
  app.get("/stats/requests", async () => getStatsRequests());
  app.get("/stats/users", async () => getStatsUsers());
  app.get("/stats/volume", async () => getStatsVolume());
  app.get("/admin/stats/volume", async () => getVolume());

  // Info routes 
  app.get("/tokenPoolInfo", async (request) => getTokenPoolInfo(parseQuery(tokenQuerySchema, request.query)));
  app.get("/tokenPriceHistory", async (request) => getTokenPriceHistory(parseQuery(priceHistorySchema, request.query)));
  app.get("/priceHistoryIndicators", async (request) => getPriceHistoryIndicators(parseQuery(priceHistoryIndicatorsSchema, request.query)));
  app.get("/detailedTokenStats", async (request) => getDetailedTokenStats(parseQuery(detailedTokenStatsSchema, request.query)));
  app.get("/isScam", async (request) => getIsScam(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fullAudit", async (request) => getFullAudit(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holderAnalysis", async (request) => getHolderAnalysis(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holders", async (request) => getHolders(parseQuery(holdersSchema, request.query)));
  app.get("/fudSearch", async (request) => getFudSearch(parseQuery(fudSearchSchema, request.query)));
  app.get("/marketOverview", async (request) => getMarketOverview(parseQuery(marketOverviewSchema, request.query)));
  app.get("/walletReview", async (request) => getWalletReview(parseQuery(walletReviewSchema, request.query)));

  // DEX swap routes
  app.get("/swap", async (request) => {
    const query = parseQuery(swapSchema, request.query);
    const response = await getSwapTx(query);

    if (response.status === "live" && response.chain === "eth") {
      let sellWei: string | null = null;
      if (isNativeIn(query.tokenOut)) {
        const quote = await getSwapQuote({
          chain: query.chain,
          dex: query.dex,
          tokenIn: query.tokenIn,
          tokenOut: query.tokenOut,
          amountIn: query.amountIn,
          slippageBps: query.slippageBps,
        });
        sellWei = quote.amountOut;
      }

      await recordEthSwapVolume({
        chain: response.chain,
        tokenIn: query.tokenIn,
        tokenOut: query.tokenOut,
        buyWei: query.amountIn,
        sellWei,
      });
    }

    return response;
  });
  app.get("/swapQuote", async (request) => getSwapQuote(parseQuery(swapQuoteSchema, request.query)));
  app.get("/swapDexes", async (request) => getSwapDexes(parseQuery(swapDexesSchema, request.query).chain));
  app.get("/approve", async (request) => getApproveTx(parseQuery(approveSchema, request.query)));

  // Unwrap WETH/WBNB → native ETH/BNB
  app.get("/unwrap", async (request) => {
    const { chain, walletAddress, amount } = parseQuery(unwrapSchema, request.query);
    return { endpoint: "unwrap", chain, tx: buildUnwrapTx(chain, walletAddress, amount) };
  });

  // Discovery & market routes
  app.get("/trendingTokens", async () => getTrendingTokens());
  app.get("/newPairs", async (request) => getNewPairs(parseQuery(newPairsSchema, request.query)));
  app.get("/topTraders", async (request) => getTopTraders(parseQuery(topTradersSchema, request.query)));
  app.get("/gasFeed", async (request) => getGasFeed(parseQuery(gasFeedSchema, request.query)));
  app.get("/tokenSearch", async (request) => getTokenSearch(parseQuery(tokenSearchSchema, request.query)));

  // Codex 
  app.get("/filterTokens", async (request) => getFilteredTokens(parseQuery(filterTokensSchema, request.query)));
  app.get("/volatilityScanner", async (request) => scanVolatility(parseQuery(volatilityScannerSchema, request.query)));
  // DISABLED — Codex paid plan only 
  // app.get("/filterWallets", async (request) => getFilteredWallets(parseQuery(filterWalletsSchema, request.query)));
  // app.get("/tokenWallets", async (request) => getTokenWallets(parseQuery(tokenWalletsSchema, request.query)));
  // app.get("/walletStats", async (request) => getWalletStats(parseQuery(walletStatsSchema, request.query)));
  app.get("/tokenHolders", async (request) => getTokenHolders(parseQuery(tokenHoldersSchema, request.query)));

  // Strategy guides
  app.get("/strats", async () => listStrategies());
  app.get("/strats/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = getStrategy(id);
    if (!result) {
      reply.status(404).send({ error: "Strategy not found", available: listStrategies().strategies.map(s => s.path) });
      return;
    }
    reply.type("text/markdown").send(result.content);
  });

  // WebSocket: Codex launchpad event stream
  app.get("/ws/launchpadEvents", { websocket: true }, (socket) => {
    handleClient(socket);
  });
}