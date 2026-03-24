import {
  getWalletCurrentNetWorth as getBirdeyeWalletCurrentNetWorth,
  getWalletPnlSummary as getBirdeyeWalletPnlSummary,
  getWalletTxList as getBirdeyeWalletTxList,
  isBirdeyeConfigured,
} from "#providers/market/birdeye";
import {
  getWalletProfitabilitySummary,
  getWalletTokenBalances,
  isMoralisConfigured
} from "#providers/walletTracking/moralis";
import {
  getAddressPnl,
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

  const [nansenSummary, nansenPnl, moralisProfitability, moralisTokens, birdeyeNetWorth, birdeyePnlSummary, birdeyeTxList, zerionPnl] = await Promise.all([
    runProvider(providers, "nansenPnlSummary", isNansenConfigured(), () => getAddressPnlSummary({
      address: query.walletAddress,
      chain: nansenChain,
      date: dateRange,
    })),
    runProvider(providers, "nansenPnl", isNansenConfigured(), () => getAddressPnl({
      address: query.walletAddress,
      chain: nansenChain,
      date: dateRange,
      pagination: { page: 1, per_page: Math.min(query.pageCount * 10, 100) },
    })),
    runProvider(providers, "moralisProfitability", isMoralisConfigured() && isEvmChain(chain), () => getWalletProfitabilitySummary(query.walletAddress, chain, query.days)),
    runProvider(providers, "moralisBalances", isMoralisConfigured() && isEvmChain(chain), () => getWalletTokenBalances(query.walletAddress, chain)),
    runProvider(providers, "birdeyeNetWorth", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletCurrentNetWorth(query.walletAddress, 20)),
    runProvider(providers, "birdeyePnl", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletPnlSummary(query.walletAddress, `${query.days}d`)),
    runProvider(providers, "birdeyeTxList", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletTxList(query.walletAddress, query.pageCount)),
    runProvider(providers, "zerionPnl", isZerionConfigured(), () => getZerionWalletPnl(query.walletAddress, chain)),
  ]);

  const moralisTokenList = Array.isArray(moralisTokens) ? moralisTokens : [];
  const birdeyeTokenList = birdeyeNetWorth?.data?.items ?? [];
  const nansenTokenPerformance: WalletPerformanceToken[] = (nansenPnl?.data ?? []).map((item) => ({
    tokenAddress: item.token_address ?? null,
    tokenSymbol: item.token_symbol ?? null,
    tokenName: item.token_name ?? null,
    chain: item.chain ?? null,
    realizedPnlUsd: firstNumber(item.realized_pnl, item.pnl_usd_realised),
    realizedRoiPct: firstNumber(item.realized_roi, item.pnl_percent_realised),
    unrealizedPnlUsd: firstNumber(item.unrealized_pnl, item.pnl_usd_unrealised),
    unrealizedRoiPct: firstNumber(item.unrealized_roi, item.pnl_percent_unrealised),
    averageBuyPrice: parseNumber(item.average_buy_price),
    averageSellPrice: parseNumber(item.average_sell_price),
    amountBought: parseNumber(item.amount_bought),
    amountSold: parseNumber(item.amount_sold),
    amountHeld: parseNumber(item.amount_held),
    costBasisUsd: parseNumber(item.cost_basis),
    lastTradeAt: item.last_trade_at ?? null,
  }));

  const topHoldings: WalletHolding[] = [];

  if (topHoldings.length === 0) {
    topHoldings.push(...nansenTokenPerformance.map((token) => ({
      tokenAddress: token.tokenAddress,
      chain: token.chain ?? chain,
      symbol: token.tokenSymbol,
      name: token.tokenName,
      amount: token.amountHeld,
      priceUsd: null,
      valueUsd: token.unrealizedPnlUsd,
      logoUrl: null,
      source: "nansen",
    })).sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0)).slice(0, 10));
  }

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

  if (recentActivity.length === 0) {
    recentActivity.push(...(birdeyeTxList?.data?.solana ?? []).flatMap((item) => {
      if (!item.txHash) {
        return [];
      }

      return [{
        txHash: item.txHash,
        category: item.mainAction ?? "unknown",
        chain,
        timestamp: item.blockTime ? Date.parse(item.blockTime) : null,
        gasUsd: parseNumber(item.fee),
        projectId: null,
        cexId: null,
        sendCount: item.mainAction === "send" ? 1 : 0,
        receiveCount: item.mainAction === "receive" ? 1 : 0
      }];
    }));
  }

  const riskyApprovals: WalletApproval[] = [];

  const approvalExposureUsd = riskyApprovals.reduce<number | null>((sum, approval) => {
    if (approval.exposureUsd === null) {
      return sum;
    }

    return (sum ?? 0) + approval.exposureUsd;
  }, 0);
  const realizedProfitPct = parseNumber(moralisProfitability?.total_realized_profit_percentage);
  const birdeyeRealizedProfitPct = parseNumber(birdeyePnlSummary?.data?.summary?.pnl?.realized_profit_percent);
  const zerionRealizedProfitPct = parseNumber(zerionPnl?.data?.attributes?.changes_percent);
  const zerionRealizedProfitUsd = parseNumber(zerionPnl?.data?.attributes?.realized_absolute);
  const finalRealizedProfitPct = realizedProfitPct ?? birdeyeRealizedProfitPct ?? zerionRealizedProfitPct;
  const nansenRealizedProfitUsd = parseNumber(nansenSummary?.realized_pnl_usd);
  const nansenRealizedProfitPct = parseNumber(nansenSummary?.realized_pnl_percent);
  const nansenWinRate = parseNumber(nansenSummary?.win_rate);
  const birdeyeTradeVolumeUsd = (() => {
    const invested = parseNumber(birdeyePnlSummary?.data?.summary?.cashflow_usd?.total_invested) ?? 0;
    const sold = parseNumber(birdeyePnlSummary?.data?.summary?.cashflow_usd?.total_sold) ?? 0;
    const total = invested + sold;
    return total > 0 ? total : null;
  })();
  const totalNetWorthUsd = firstNumber(birdeyeNetWorth?.data?.total_value);
  const activeChains = new Set<string>();
  if (nansenSummary || nansenTokenPerformance.length > 0 || (isEvmChain(chain) && (moralisTokenList.length > 0 || zerionPnl?.data?.attributes))) {
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
      realizedProfitUsd: firstNumber(nansenRealizedProfitUsd, moralisProfitability?.total_realized_profit_usd, birdeyePnlSummary?.data?.summary?.pnl?.realized_profit_usd, zerionRealizedProfitUsd),
      realizedProfitPct: nansenRealizedProfitPct ?? finalRealizedProfitPct,
      totalTradeVolumeUsd: firstNumber(moralisProfitability?.total_trade_volume, birdeyeTradeVolumeUsd),
      totalTrades: nansenSummary?.traded_times ?? moralisProfitability?.total_count_of_trades ?? birdeyePnlSummary?.data?.summary?.counts?.total_trade ?? null,
      totalBuys: moralisProfitability?.total_buys ?? birdeyePnlSummary?.data?.summary?.counts?.total_buy ?? null,
      totalSells: moralisProfitability?.total_sells ?? birdeyePnlSummary?.data?.summary?.counts?.total_sell ?? null,
      profitable: (nansenRealizedProfitPct ?? finalRealizedProfitPct) !== null ? (nansenRealizedProfitPct ?? finalRealizedProfitPct)! > 0 : null,
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
