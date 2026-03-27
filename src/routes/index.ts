import type { FastifyInstance } from "fastify";
import {
  runArtificialVolumeScan,
} from "#services/signalSolEndpoints";
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
import { deleteApiKey, generateApiKey, getApiRuntimeStats, getStatsAgents, getStatsRequests, getStatsUser, getStatsUsers, getStatsVolume } from "#services/apiRuntime";
import { getHolders } from "#services/holders";
import { getWalletChart } from "#services/walletChart";
import { getWalletReview } from "#services/walletReview";
import { getPnl } from "#services/pnl";
import { getAddressRelatedWalletsData, getJupiterDcasData, getNansenPresetsData, getSmartMoneyNetflowData, getTokenScreenerData } from "#services/nansenSignals";
import { getProviderHealth } from "#services/providerHealth";
import { getApproveTx, getSwapTx, getSwapQuote, getSwapDexes } from "#services/swap";
import { buildUnwrapTx } from "#lib/evm";
import { getTrendingTokens, getTopEthTokens, getNewEthTradableTokens, getNewPairs, getTopTraders, getGasFeed, getTokenSearch } from "#services/discovery";
import { getFilteredTokens } from "#services/filterTokens";
// DISABLED — Codex paid plan only 
// import { getFilteredWallets } from "#services/filterWallets";
// import { getTokenWallets } from "#services/tokenWallets";
// import { getWalletStats } from "#services/walletStats";
import { getTokenHolders } from "#services/tokenHolders";
import { handleAgentStatsClient } from "#services/agentStatsStream";
import { handleChartHealthStreamClient } from "#services/chartHealthStream";
import { handleClient } from "#services/launchpadStream";
import { getGlobalSignalState } from "#services/signalBus";
import { handleSignalStreamClient } from "#services/signalStream";
import { handleXFilteredStreamClient } from "#services/xFilteredStream";
import { listStrategies, getStrategy } from "#services/strategies";
import { scanVolatility } from "#services/volatilityScanner";
import { getPriceHistoryIndicators } from "#services/indicators";
import { getRateMyEntry } from "#services/rateMyEntry";
import { getXCountRecent, getXKolVolumeData, getXSearch, getXUserByUsernameData, getXUserFollowersData, getXUserLikesData } from "#services/x";
import { addressRelatedWalletsSchema, approveSchema, apiKeyDeleteSchema, apiKeyGenerateSchema, detailedTokenStatsSchema, filterTokensSchema, fudSearchSchema, gasFeedSchema, getTopEthTokensSchema, holdersSchema, jupiterDcasSchema, marketOverviewSchema, nansenPresetCatalogSchema, newPairsSchema, parseQuery, pnlSchema, priceHistorySchema, priceHistoryIndicatorsSchema, rateMyEntrySchema, signalSolTokenSchema, smartMoneyNetflowSchema, statsAgentsSchema, statsUserSchema, swapDexesSchema, swapQuoteSchema, swapSchema, tokenHoldersSchema, tokenQuerySchema, tokenScreenerSchema, tokenSearchSchema, topTradersSchema, walletChartSchema, walletReviewSchema, unwrapSchema, volatilityScannerSchema, xCountRecentSchema, xKolVolumeSchema, xSearchSchema, xUserByUsernameSchema, xUserFollowersSchema, xUserLikesSchema } from "#routes/helpers";
import { recordSwapVolume } from "#services/apiRuntime";

type SignalSolHeaders = Record<string, string | string[] | undefined>;

function getSignalSolApiKey(headers: SignalSolHeaders): string | null {
  const directHeader = headers["x-api-key"];
  const xApiKey = Array.isArray(directHeader) ? directHeader[0]?.trim() : directHeader?.trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authorizationHeader = headers.authorization;
  const authorization = Array.isArray(authorizationHeader) ? authorizationHeader[0]?.trim() : authorizationHeader?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() ?? null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "super-api" }));

  // SIGNAL_SOL endpoints
  app.get("/artificialVolumeScan", async (request, reply) => {
    const query = parseQuery(signalSolTokenSchema, request.query);
    try {
      return await runArtificialVolumeScan(query.tokenAddress, {
        apiKey: getSignalSolApiKey(request.headers as SignalSolHeaders),
      });
    } catch (error) {
      reply.status(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/bottomsUp", async (request, reply) => {
    try {
      return await getGlobalSignalState("bottomsUp");
    } catch (error) {
      reply.status(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/momentumGains", async (request, reply) => {
    try {
      return await getGlobalSignalState("momentumGains");
    } catch (error) {
      reply.status(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/momentumStart", async (request, reply) => {
    try {
      return await getGlobalSignalState("momentumStart");
    } catch (error) {
      reply.status(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/newPump", async (request, reply) => {
    try {
      return await getGlobalSignalState("newPump");
    } catch (error) {
      reply.status(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/providers", async () => ({ providers: getProviderHealth() }));

  app.post("/admin/apiKeys/generate", async (request) => {
    const body = parseQuery(apiKeyGenerateSchema, request.body);
    return generateApiKey(
      body.label ?? null,
      body.agentId ?? null,
      body.agentWalletEvm ?? null,
      body.agentWalletSol ?? null,
    );
  });
  app.delete("/admin/apiKeys", async (request) => deleteApiKey(parseQuery(apiKeyDeleteSchema, request.query).keyId));
  app.get("/admin/stats", async () => getApiRuntimeStats());
  app.get("/admin/stats/requests", async () => getStatsRequests());
  app.get("/admin/stats/users", async () => getStatsUsers());
  app.get("/admin/stats/user", async (request) => getStatsUser(parseQuery(statsUserSchema, request.query)));
  app.get("/admin/stats/agents", async (request) => getStatsAgents(parseQuery(statsAgentsSchema, request.query)));
  app.get("/admin/stats/volume", async () => getStatsVolume());

  // Info routes 
  app.get("/tokenPoolInfo", async (request) => getTokenPoolInfo(parseQuery(tokenQuerySchema, request.query)));
  app.get("/tokenPriceHistory", async (request) => getTokenPriceHistory(parseQuery(priceHistorySchema, request.query)));
  app.get("/priceHistoryIndicators", async (request) => getPriceHistoryIndicators(parseQuery(priceHistoryIndicatorsSchema, request.query)));
  app.get("/rateMyEntry", async (request) => getRateMyEntry(parseQuery(rateMyEntrySchema, request.query)));
  app.get("/detailedTokenStats", async (request) => getDetailedTokenStats(parseQuery(detailedTokenStatsSchema, request.query)));
  app.get("/isScam", async (request) => getIsScam(parseQuery(tokenQuerySchema, request.query)));
  app.get("/fullAudit", async (request) => getFullAudit(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holderAnalysis", async (request) => getHolderAnalysis(parseQuery(tokenQuerySchema, request.query)));
  app.get("/holders", async (request) => getHolders(parseQuery(holdersSchema, request.query)));
  app.get("/fudSearch", async (request) => getFudSearch(parseQuery(fudSearchSchema, request.query)));
  app.get("/marketOverview", async (request) => getMarketOverview(parseQuery(marketOverviewSchema, request.query)));
  app.get("/xSearch", async (request) => getXSearch(parseQuery(xSearchSchema, request.query)));
  app.get("/xCountRecent", async (request) => getXCountRecent(parseQuery(xCountRecentSchema, request.query)));
  app.get("/xUserByUsername", async (request) => getXUserByUsernameData(parseQuery(xUserByUsernameSchema, request.query)));
  app.get("/xUserLikes", async (request) => getXUserLikesData(parseQuery(xUserLikesSchema, request.query)));
  app.get("/xUserFollowers", async (request) => getXUserFollowersData(parseQuery(xUserFollowersSchema, request.query)));
  app.get("/xKolVolume", async (request) => getXKolVolumeData(parseQuery(xKolVolumeSchema, request.query)));
  app.get("/admin/walletChart", async (request) => getWalletChart(parseQuery(walletChartSchema, request.query)));
  app.get("/walletReview", async (request) => getWalletReview(parseQuery(walletReviewSchema, request.query)));
  app.get("/pnl", async (request) => getPnl(parseQuery(pnlSchema, request.query)));
  app.post("/tokenScreener", async (request) => getTokenScreenerData(parseQuery(tokenScreenerSchema, request.body)));
  app.post("/addressRelatedWallets", async (request) => getAddressRelatedWalletsData(parseQuery(addressRelatedWalletsSchema, request.body)));
  app.post("/jupiterDcas", async (request) => getJupiterDcasData(parseQuery(jupiterDcasSchema, request.body)));
  app.post("/smartMoneyNetflow", async (request) => getSmartMoneyNetflowData(parseQuery(smartMoneyNetflowSchema, request.body)));
  app.get("/nansenPresets", async (request) => getNansenPresetsData(parseQuery(nansenPresetCatalogSchema, request.query)));

  // DEX swap routes
  app.get("/swap", async (request) => {
    const query = parseQuery(swapSchema, request.query);
    const response = await getSwapTx(query);

    if (response.status === "live") {
      await recordSwapVolume({
        chain: response.chain,
        tokenIn: query.tokenIn,
        tokenOut: query.tokenOut,
        buyWei: query.amountIn,
        sellWei: response.amountOutMin,
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
  app.get("/getTopEthTokens", async (request) => getTopEthTokens(parseQuery(getTopEthTokensSchema, request.query)));
  app.get("/getNewEthTradableTokens", async () => getNewEthTradableTokens());
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

  app.get("/ws/agentStats", { websocket: true }, (socket) => {
    handleAgentStatsClient(socket);
  });

  app.get("/ws/chartHealth", { websocket: true }, (socket) => {
    void handleChartHealthStreamClient(socket).catch((error) => {
      console.error("[ws/chartHealth] initialization failed:", error);
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: "error",
          data: error instanceof Error ? error.message : "Failed to initialize chartHealth stream.",
        }));
      }
      socket.close(1011, "init_failed");
    });
  });

  app.get("/ws/xFilteredStream", { websocket: true }, (socket) => {
    handleXFilteredStreamClient(socket);
  });

  app.get("/ws/signals", { websocket: true }, (socket) => {
    void handleSignalStreamClient(socket).catch((error) => {
      console.error("[ws/signals] initialization failed:", error);
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: "error",
          data: error instanceof Error ? error.message : "Failed to initialize signal stream.",
        }));
      }
      socket.close(1011, "init_failed");
    });
  });
}
