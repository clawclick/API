import { getProviderHealth } from "#services/providerHealth";
import type { EndpointName } from "#types/domain";

const descriptions: Record<EndpointName, string> = {
  walletReview: "Returns wallet profitability, holdings, protocol exposure, approvals, and recent activity for copy-trading analysis.",
  tokenPoolInfo: "Returns market cap, price, liquidity, holder summary, and 24h movement for a token or pool.",
  tokenPriceHistory: "Returns normalized price history for a token using an adjustable timeframe.",
  isScam: "Runs the fast scam triage pass using Honeypot and related contract-security signals.",
  fullAudit: "Builds the deeper risk profile using GoPlus, Honeypot, BubbleMaps, Quick Intel, and chain data.",
  holderAnalysis: "Returns holder concentration, top-wallet breakdowns, and cached distribution context.",
  fudSearch: "Searches social surfaces for scam or exploit concerns tied to a token name, symbol, or address.",
  marketOverview: "Composes chain context, pool info, risk signals, and social data into one response."
};

const cacheHints: Record<EndpointName, number> = {
  walletReview: 180,
  tokenPoolInfo: 60,
  tokenPriceHistory: 300,
  isScam: 120,
  fullAudit: 900,
  holderAnalysis: 21600,
  fudSearch: 180,
  marketOverview: 120
};

export function buildEndpointScaffold(endpoint: EndpointName, request: Record<string, unknown>) {
  return {
    endpoint,
    status: "scaffold",
    description: descriptions[endpoint],
    request,
    recommendedCacheSeconds: cacheHints[endpoint],
    providers: getProviderHealth(endpoint),
    nextImplementationTargets: [
      "Replace scaffold data with normalized provider adapters.",
      "Cache expensive sources like BubbleMaps and holder snapshots.",
      "Add chain-aware routing so the same endpoint can fan out by network."
    ]
  };
}