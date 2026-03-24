import {
  getWalletPnlSummary as getBirdeyeWalletPnlSummary,
  isBirdeyeConfigured,
} from "#providers/market/birdeye";
import {
  getWalletPnl as getZerionWalletPnl,
  isZerionConfigured,
} from "#providers/walletTracking/zerion";
import { normalizeChain } from "#providers/shared/chains";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import type { PnlQuery } from "#routes/helpers";
import type { PnlResponse, ProviderStatus } from "#types/api";

function parseNumber(value: number | string | undefined | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function getPnl(query: PnlQuery): Promise<PnlResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  if (chain === "sol") {
    const birdeye = await runProvider(
      providers,
      "birdeyePnl",
      isBirdeyeConfigured(),
      () => getBirdeyeWalletPnlSummary(query.walletAddress, `${query.days}d`),
    );

    return {
      endpoint: "pnl",
      status: summarizeStatus(providers),
      chain,
      walletAddress: query.walletAddress,
      source: "birdeye",
      summary: {
        realizedPnlUsd: parseNumber(birdeye?.data?.summary?.pnl?.realized_profit_usd),
        realizedPnlPct: parseNumber(birdeye?.data?.summary?.pnl?.realized_profit_percent),
        unrealizedPnlUsd: parseNumber(birdeye?.data?.summary?.pnl?.unrealized_usd),
        totalPnlUsd: parseNumber(birdeye?.data?.summary?.pnl?.total_usd),
        avgProfitPerTradeUsd: parseNumber(birdeye?.data?.summary?.pnl?.avg_profit_per_trade_usd),
        totalTrades: birdeye?.data?.summary?.counts?.total_trade ?? null,
        totalBuys: birdeye?.data?.summary?.counts?.total_buy ?? null,
        totalSells: birdeye?.data?.summary?.counts?.total_sell ?? null,
        winRate: parseNumber(birdeye?.data?.summary?.counts?.win_rate),
        uniqueTokens: birdeye?.data?.summary?.unique_tokens ?? null,
      },
      providers,
    };
  }

  const zerion = await runProvider(
    providers,
    "zerionPnl",
    isZerionConfigured(),
    () => getZerionWalletPnl(query.walletAddress, chain),
  );

  return {
    endpoint: "pnl",
    status: summarizeStatus(providers),
    chain,
    walletAddress: query.walletAddress,
    source: "zerion",
    summary: {
      realizedPnlUsd: parseNumber(zerion?.data?.attributes?.realized_absolute),
      realizedPnlPct: parseNumber(zerion?.data?.attributes?.changes_percent),
      unrealizedPnlUsd: parseNumber(zerion?.data?.attributes?.unrealized_absolute),
      totalPnlUsd: parseNumber(zerion?.data?.attributes?.changes_absolute),
      avgProfitPerTradeUsd: null,
      totalTrades: null,
      totalBuys: null,
      totalSells: null,
      winRate: null,
      uniqueTokens: null,
    },
    providers,
  };
}
