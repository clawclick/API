import {
  getWalletCurrentNetWorth as getBirdeyeWalletCurrentNetWorth,
  isBirdeyeConfigured,
} from "#providers/market/birdeye";
import {
  getWalletTokenBalances,
  isMoralisConfigured
} from "#providers/walletTracking/moralis";
import {
  getAddressPnlSummary,
  isNansenConfigured,
} from "#providers/walletTracking/nansen";
import {
  getWalletPnl as getZerionWalletPnl,
  isZerionConfigured,
} from "#providers/walletTracking/zerion";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import type { WalletReviewQuery } from "#routes/helpers";
import type { ProviderStatus, WalletApproval, WalletHolding, WalletPerformanceToken, WalletProtocol, WalletReviewResponse } from "#types/api";

function parseNumber(value: number | string | undefined | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstNumber(...values: Array<number | string | undefined | null>): number | null {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function toNansenChain(chain: string): string {
  const normalized = normalizeChain(chain);
  if (normalized === "eth") return "ethereum";
  if (normalized === "bsc") return "bnb";
  if (normalized === "sol") return "solana";
  return normalized;
}

function buildDateRange(days: string): { from: string; to: string } {
  const parsedDays = Number(days);
  const durationDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
  const to = new Date();
  const from = new Date(to.getTime() - durationDays * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export async function getWalletReview(query: WalletReviewQuery): Promise<WalletReviewResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];
  const dateRange = buildDateRange(query.days);
  const nansenChain = toNansenChain(chain);

  const [nansenSummary, moralisTokens, birdeyeNetWorth] = await Promise.all([
    runProvider(providers, "nansenPnlSummary", isNansenConfigured(), () => getAddressPnlSummary({
      address: query.walletAddress,
      chain: nansenChain,
      date: dateRange,
    })),
    runProvider(providers, "moralisBalances", isMoralisConfigured() && isEvmChain(chain), () => getWalletTokenBalances(query.walletAddress, chain)),
    runProvider(providers, "birdeyeNetWorth", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletCurrentNetWorth(query.walletAddress, 20)),
  ]);

  const needsZerionFallback =
    firstNumber(nansenSummary?.realized_pnl_usd, nansenSummary?.realized_pnl_percent) === null;
  const zerionPnl = await runProvider(
    providers,
    "zerionPnl",
    isZerionConfigured() && needsZerionFallback,
    () => getZerionWalletPnl(query.walletAddress, chain),
  );

  const moralisTokenList = Array.isArray(moralisTokens) ? moralisTokens : [];
  const birdeyeTokenList = birdeyeNetWorth?.data?.items ?? [];
  const nansenTokenPerformance: WalletPerformanceToken[] = (nansenSummary?.top5_tokens ?? []).map((item) => ({
    tokenAddress: item.token_address ?? null,
    tokenSymbol: item.token_symbol ?? null,
    tokenName: null,
    chain: item.chain ?? null,
    realizedPnlUsd: parseNumber(item.realized_pnl),
    realizedRoiPct: parseNumber(item.realized_roi),
    unrealizedPnlUsd: null,
    unrealizedRoiPct: null,
    averageBuyPrice: null,
    averageSellPrice: null,
    amountBought: null,
    amountSold: null,
    amountHeld: null,
    costBasisUsd: null,
    lastTradeAt: null,
  }));

  const topHoldings: WalletHolding[] = [];

  if (topHoldings.length === 0) {
    topHoldings.push(...moralisTokenList.map((token) => ({
      tokenAddress: token.token_address ?? null,
      chain,
      symbol: token.symbol ?? null,
      name: token.name ?? null,
      amount: parseNumber(token.balance_formatted),
      priceUsd: parseNumber(token.usd_price),
      valueUsd: parseNumber(token.usd_value),
      logoUrl: token.logo ?? null,
      source: "moralis"
    })).sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0)).slice(0, 10));
  }

  if (topHoldings.length === 0) {
    topHoldings.push(...birdeyeTokenList.map((token) => ({
      tokenAddress: token.address ?? null,
      chain,
      symbol: token.symbol ?? null,
      name: token.name ?? null,
      amount: parseNumber(token.amount),
      priceUsd: parseNumber(token.price),
      valueUsd: parseNumber(token.value),
      logoUrl: token.logo_uri ?? null,
      source: "birdeye"
    })).sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0)).slice(0, 10));
  }

  const topProtocols: WalletProtocol[] = [];

  const recentActivity = [];

  const riskyApprovals: WalletApproval[] = [];

  const approvalExposureUsd = riskyApprovals.reduce<number | null>((sum, approval) => {
    if (approval.exposureUsd === null) {
      return sum;
    }

    return (sum ?? 0) + approval.exposureUsd;
  }, 0);
  const zerionRealizedProfitPct = parseNumber(zerionPnl?.data?.attributes?.changes_percent);
  const zerionRealizedProfitUsd = parseNumber(zerionPnl?.data?.attributes?.realized_absolute);
  const nansenRealizedProfitUsd = parseNumber(nansenSummary?.realized_pnl_usd);
  const nansenRealizedProfitPct = parseNumber(nansenSummary?.realized_pnl_percent);
  const nansenWinRate = parseNumber(nansenSummary?.win_rate);
  const totalNetWorthUsd = firstNumber(birdeyeNetWorth?.data?.total_value);
  const activeChains = new Set<string>();
  if (nansenSummary || (isEvmChain(chain) && (moralisTokenList.length > 0 || zerionPnl?.data?.attributes)) || (chain === "sol" && birdeyeTokenList.length > 0)) {
    activeChains.add(chain);
  }
  if (chain === "sol" && totalNetWorthUsd !== null) {
    activeChains.add("sol");
  }

  return {
    endpoint: "walletReview",
    status: summarizeStatus(providers),
    chain,
    walletAddress: query.walletAddress,
    days: query.days,
    summary: {
      totalNetWorthUsd,
      chainNetWorthUsd: totalNetWorthUsd,
      realizedProfitUsd: firstNumber(nansenRealizedProfitUsd, zerionRealizedProfitUsd),
      realizedProfitPct: nansenRealizedProfitPct ?? zerionRealizedProfitPct,
      totalTradeVolumeUsd: null,
      totalTrades: nansenSummary?.traded_times ?? null,
      totalBuys: null,
      totalSells: null,
      profitable: (nansenRealizedProfitPct ?? zerionRealizedProfitPct) !== null ? (nansenRealizedProfitPct ?? zerionRealizedProfitPct)! > 0 : null,
      tokenCount: topHoldings.length,
      protocolCount: topProtocols.length,
      activeChains: [...activeChains],
      approvalExposureUsd,
      recentTransfers: recentActivity.filter((item) => item.category === "send" || item.category === "receive").length,
      recentApprovals: recentActivity.filter((item) => item.category === "approve").length,
      recentInteractions: recentActivity.length
    },
    performance: {
      winRate: nansenWinRate,
      tradedTokenCount: nansenSummary?.traded_token_count ?? null,
      tradedTimes: nansenSummary?.traded_times ?? null,
      realizedPnlUsd: nansenRealizedProfitUsd,
      realizedPnlPercent: nansenRealizedProfitPct,
      pagination: nansenSummary?.pagination ? {
        page: nansenSummary.pagination.page ?? null,
        perPage: nansenSummary.pagination.per_page ?? null,
        isLastPage: nansenSummary.pagination.is_last_page ?? null,
      } : null,
      topTokens: (nansenSummary?.top5_tokens ?? []).map((token) => ({
        tokenAddress: token.token_address ?? null,
        tokenSymbol: token.token_symbol ?? null,
        chain: token.chain ?? null,
        realizedPnlUsd: parseNumber(token.realized_pnl),
        realizedRoiPct: parseNumber(token.realized_roi),
      })),
    },
    tokenPerformance: nansenTokenPerformance,
    topHoldings,
    topProtocols,
    recentActivity,
    riskyApprovals,
    providers
  };
}
