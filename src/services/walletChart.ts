import {
  getWalletChart as getZerionWalletChart,
  getZerionChainId,
  isZerionConfigured,
} from "#providers/walletTracking/zerion";
import { normalizeChain } from "#providers/shared/chains";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import type { WalletChartQuery } from "#routes/helpers";
import type { ProviderStatus, WalletChartResponse } from "#types/api";

const WALLET_CHART_CHAINS: WalletChartResponse["chains"] = ["eth", "base", "bsc", "sol"];
const WALLET_CHART_DEFAULT_FILTER_CHAINS = ["eth", "base", "bsc"] as const;
const WALLET_CHART_CHAIN_IDS: WalletChartResponse["chainIds"] = {
  eth: "ethereum",
  base: "base",
  sol: "solana",
  bsc: "binance-smart-chain",
};

function isLikelySolanaWalletAddress(walletAddress: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress.trim());
}

function resolveAppliedChains(query: WalletChartQuery): WalletChartResponse["chains"] | null {
  const requestedChain = query.chain ? normalizeChain(query.chain) : null;

  if (requestedChain !== "sol") {
    return requestedChain ? [requestedChain] : null;
  }

  return isLikelySolanaWalletAddress(query.walletAddress)
    ? ["sol"]
    : [...WALLET_CHART_DEFAULT_FILTER_CHAINS];
}

export async function getWalletChart(query: WalletChartQuery): Promise<WalletChartResponse> {
  const providers: ProviderStatus[] = [];
  const requestedChain = query.chain ? normalizeChain(query.chain) : null;
  const appliedChains = resolveAppliedChains(query);
  const appliedChainIds = appliedChains?.map((chain) => getZerionChainId(chain) ?? chain) ?? null;

  const chart = await runProvider(
    providers,
    "zerionChart",
    isZerionConfigured(),
    () => getZerionWalletChart(query.walletAddress, appliedChainIds ?? undefined),
  );

  return {
    endpoint: "walletChart",
    status: summarizeStatus(providers),
    walletAddress: query.walletAddress,
    requestedChain,
    chartPeriod: "max",
    currency: "usd",
    chains: appliedChains ?? WALLET_CHART_CHAINS,
    chainIds: WALLET_CHART_CHAIN_IDS,
    appliedChainIds,
    chart,
    providers,
  };
}