import { getProviderHealth } from "#services/providerHealth";
import type { EndpointName } from "#types/domain";

const descriptions: Record<EndpointName, string> = {
  approve: "Builds unsigned approval transactions for router, fee-wrapper, or Permit2-based sell flows.",
  walletReview: "Returns wallet profitability, holdings, protocol exposure, approvals, and recent activity for copy-trading analysis.",
  tokenPoolInfo: "Returns market cap, price, liquidity, holder summary, and 24h movement for a token or pool.",
  tokenPriceHistory: "Returns normalized price history for a token using an adjustable timeframe.",
  detailedTokenStats: "Returns cached bucketed token stats from Codex for volume, price, liquidity, and trader-count changes across short windows.",
  isScam: "Runs the fast scam triage pass using Honeypot and related contract-security signals.",
  fullAudit: "Builds the deeper risk profile using GoPlus, Honeypot, BubbleMaps, Quick Intel, and chain data.",
  holderAnalysis: "Returns holder concentration, top-wallet breakdowns, and cached distribution context.",
  fudSearch: "Searches social surfaces for scam or exploit concerns tied to a token name, symbol, or address.",
  marketOverview: "Composes chain context, pool info, risk signals, and social data into one response.",
  filterTokens: "Filters tokens across chains by liquidity, volume, market cap, holders, and other on-chain criteria via Codex.",
  filterWallets: "Discovers wallets by realized PnL, win rate, volume, and swap count across configurable time frames via Codex.",
  tokenWallets: "Lists wallets trading a specific token with PnL, balance, and buy/sell stats via Codex.",
  walletStats: "Returns detailed PnL and trading stats for a wallet across 1d/1w/30d/1y time periods via Codex.",
  tokenHolders: "Returns raw holder rows for EVM tokens via Sim by Dune, including first-acquired time and whether each wallet has initiated transfers.",
  unwrap: "Builds an unsigned wrapped-native withdraw transaction so a wallet can unwrap WETH/WBNB back into native gas token.",
};

const cacheHints: Record<EndpointName, number> = {
  approve: 0,
  walletReview: 180,
  tokenPoolInfo: 60,
  tokenPriceHistory: 300,
  detailedTokenStats: 1800,
  isScam: 120,
  fullAudit: 900,
  holderAnalysis: 21600,
  fudSearch: 180,
  marketOverview: 120,
  filterTokens: 300,
  filterWallets: 1800,
  tokenWallets: 1800,
  walletStats: 180,
  tokenHolders: 120,
  unwrap: 0,
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