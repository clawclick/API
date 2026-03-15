import {
  getHistoryList,
  getSimpleProtocolList,
  getTokenAuthorizedList,
  getTokenList,
  getTotalBalance,
  isDebankConfigured
} from "#providers/walletTracking/debank";
import {
  getWalletProfitabilitySummary,
  getWalletTokenBalances,
  isMoralisConfigured
} from "#providers/walletTracking/moralis";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
import type { WalletReviewQuery } from "#routes/helpers";
import type { ProviderStatus, WalletApproval, WalletHolding, WalletProtocol, WalletReviewResponse } from "#types/api";

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

async function runProvider<T>(statuses: ProviderStatus[], provider: string, shouldRun: boolean, task: () => Promise<T>): Promise<T | null> {
  if (!shouldRun) {
    statuses.push({ provider, status: "skipped", detail: "Provider not configured or not supported for this chain." });
    return null;
  }

  try {
    const result = await task();
    statuses.push({ provider, status: "ok" });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    statuses.push({ provider, status: "error", detail });
    return null;
  }
}

function summarizeStatus(statuses: ProviderStatus[]): "live" | "partial" {
  return statuses.some((status) => status.status === "ok") ? "live" : "partial";
}

export async function getWalletReview(query: WalletReviewQuery): Promise<WalletReviewResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  const [debankTotalBalance, debankProtocols, debankTokens, debankHistory, debankApprovals, moralisProfitability, moralisTokens] = await Promise.all([
    runProvider(providers, "debank", isDebankConfigured() && isEvmChain(chain), () => getTotalBalance(query.walletAddress)),
    runProvider(providers, "debankProtocols", isDebankConfigured() && isEvmChain(chain), () => getSimpleProtocolList(query.walletAddress, chain)),
    runProvider(providers, "debankTokens", isDebankConfigured() && isEvmChain(chain), () => getTokenList(query.walletAddress, chain)),
    runProvider(providers, "debankHistory", isDebankConfigured() && isEvmChain(chain), () => getHistoryList(query.walletAddress, chain, query.pageCount)),
    runProvider(providers, "debankApprovals", isDebankConfigured() && isEvmChain(chain), () => getTokenAuthorizedList(query.walletAddress, chain)),
    runProvider(providers, "moralisProfitability", isMoralisConfigured() && isEvmChain(chain), () => getWalletProfitabilitySummary(query.walletAddress, chain, query.days)),
    runProvider(providers, "moralisBalances", isMoralisConfigured() && isEvmChain(chain), () => getWalletTokenBalances(query.walletAddress, chain))
  ]);

  const topHoldings: WalletHolding[] = (debankTokens ?? []).map((token) => ({
    tokenAddress: token.id ?? null,
    chain: token.chain ?? chain,
    symbol: token.symbol ?? null,
    name: token.name ?? null,
    amount: parseNumber(token.amount),
    priceUsd: parseNumber(token.price),
    valueUsd: (() => {
      const amount = parseNumber(token.amount);
      const price = parseNumber(token.price);
      return amount !== null && price !== null ? amount * price : null;
    })(),
    logoUrl: token.logo_url ?? null,
    source: "debank"
  })).sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0)).slice(0, 10);

  if (topHoldings.length === 0) {
    topHoldings.push(...(moralisTokens ?? []).map((token) => ({
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

  const topProtocols: WalletProtocol[] = (debankProtocols ?? []).map((protocol) => ({
    id: protocol.id ?? "unknown",
    chain: protocol.chain ?? chain,
    name: protocol.name ?? null,
    netUsdValue: parseNumber(protocol.net_usd_value),
    assetUsdValue: parseNumber(protocol.asset_usd_value),
    debtUsdValue: parseNumber(protocol.debt_usd_value),
    siteUrl: protocol.site_url ?? null
  })).sort((left, right) => (right.netUsdValue ?? 0) - (left.netUsdValue ?? 0)).slice(0, 10);

  const recentActivity = (debankHistory?.history_list ?? []).flatMap((item) => {
    if (!item.id || !item.chain) {
      return [];
    }

    return [{
      txHash: item.id,
      category: item.cate_id ?? "unknown",
      chain: item.chain,
      timestamp: item.time_at ?? null,
      gasUsd: parseNumber(item.tx?.usd_gas_fee),
      projectId: item.project_id ?? null,
      cexId: item.cex_id ?? null,
      sendCount: item.sends?.length ?? 0,
      receiveCount: item.receives?.length ?? 0
    }];
  });

  const riskyApprovals: WalletApproval[] = (debankApprovals ?? []).map((approval) => ({
    tokenId: approval.id ?? "unknown",
    symbol: approval.symbol ?? approval.name ?? null,
    chain: approval.chain ?? chain,
    exposureUsd: parseNumber(approval.sum_exposure_usd),
    spenderCount: approval.spenders?.length ?? 0
  })).sort((left, right) => (right.exposureUsd ?? 0) - (left.exposureUsd ?? 0)).slice(0, 10);

  const chainNetWorthUsd = debankTotalBalance?.chain_list?.find((chainBalance) => chainBalance.id === chain)?.usd_value ?? null;
  const approvalExposureUsd = riskyApprovals.reduce<number | null>((sum, approval) => {
    if (approval.exposureUsd === null) {
      return sum;
    }

    return (sum ?? 0) + approval.exposureUsd;
  }, 0);
  const realizedProfitPct = parseNumber(moralisProfitability?.total_realized_profit_percentage);

  return {
    endpoint: "walletReview",
    status: summarizeStatus(providers),
    chain,
    walletAddress: query.walletAddress,
    days: query.days,
    summary: {
      totalNetWorthUsd: parseNumber(debankTotalBalance?.total_usd_value),
      chainNetWorthUsd: parseNumber(chainNetWorthUsd),
      realizedProfitUsd: parseNumber(moralisProfitability?.total_realized_profit_usd),
      realizedProfitPct,
      totalTradeVolumeUsd: parseNumber(moralisProfitability?.total_trade_volume),
      totalTrades: moralisProfitability?.total_count_of_trades ?? null,
      totalBuys: moralisProfitability?.total_buys ?? null,
      totalSells: moralisProfitability?.total_sells ?? null,
      profitable: realizedProfitPct !== null ? realizedProfitPct > 0 : null,
      tokenCount: topHoldings.length,
      protocolCount: topProtocols.length,
      activeChains: (debankTotalBalance?.chain_list ?? []).flatMap((chainBalance) => chainBalance.id ? [chainBalance.id] : []),
      approvalExposureUsd,
      recentTransfers: recentActivity.filter((item) => item.category === "send" || item.category === "receive").length,
      recentApprovals: recentActivity.filter((item) => item.category === "approve").length,
      recentInteractions: recentActivity.length
    },
    topHoldings,
    topProtocols,
    recentActivity,
    riskyApprovals,
    providers
  };
}