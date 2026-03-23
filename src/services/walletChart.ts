import {
  getWalletChart as getZerionWalletChart,
  isZerionConfigured,
} from "#providers/walletTracking/zerion";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import type { WalletChartQuery } from "#routes/helpers";
import type { ProviderStatus, WalletChartResponse } from "#types/api";

const WALLET_CHART_CHAINS: WalletChartResponse["chains"] = ["eth", "base", "bsc"];
const WALLET_CHART_CHAIN_IDS: WalletChartResponse["chainIds"] = {
  eth: "ethereum",
  base: "base",
  sol: "solana",
  bsc: "binance-smart-chain",
};

export async function getWalletChart(query: WalletChartQuery): Promise<WalletChartResponse> {
  const providers: ProviderStatus[] = [];

  const chart = await runProvider(
    providers,
    "zerionChart",
    isZerionConfigured(),
    () => getZerionWalletChart(query.walletAddress),
  );

  return {
    endpoint: "walletChart",
    status: summarizeStatus(providers),
    walletAddress: query.walletAddress,
    chartPeriod: "max",
    currency: "usd",
    chains: WALLET_CHART_CHAINS,
    chainIds: WALLET_CHART_CHAIN_IDS,
    chart,
    providers,
  };
}