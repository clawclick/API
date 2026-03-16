import {
  getHistoryList,
  getSimpleProtocolList,
  getTokenAuthorizedList,
  getTokenList,
  getTotalBalance,
  isDebankConfigured
} from "#providers/walletTracking/debank";
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
  getWalletPnl as getZerionWalletPnl,
  isZerionConfigured,
} from "#providers/walletTracking/zerion";
import { isEvmChain, normalizeChain } from "#providers/shared/chains";
import { runProvider, summarizeStatus } from "#lib/runProvider";
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

function firstNumber(...values: Array<number | string | undefined | null>): number | null {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}


export async function getWalletReview(query: WalletReviewQuery): Promise<WalletReviewResponse> {
  const chain = normalizeChain(query.chain);
  const providers: ProviderStatus[] = [];

  const [debankTotalBalance, debankProtocols, debankTokens, debankHistory, debankApprovals, moralisProfitability, moralisTokens, birdeyeNetWorth, birdeyePnlSummary, birdeyeTxList, zerionPnl] = await Promise.all([
    runProvider(providers, "debank", isDebankConfigured() && isEvmChain(chain), () => getTotalBalance(query.walletAddress)),
    runProvider(providers, "debankProtocols", isDebankConfigured() && isEvmChain(chain), () => getSimpleProtocolList(query.walletAddress, chain)),
    runProvider(providers, "debankTokens", isDebankConfigured() && isEvmChain(chain), () => getTokenList(query.walletAddress, chain)),
    runProvider(providers, "debankHistory", isDebankConfigured() && isEvmChain(chain), () => getHistoryList(query.walletAddress, chain, query.pageCount)),
    runProvider(providers, "debankApprovals", isDebankConfigured() && isEvmChain(chain), () => getTokenAuthorizedList(query.walletAddress, chain)),
    runProvider(providers, "moralisProfitability", isMoralisConfigured() && isEvmChain(chain), () => getWalletProfitabilitySummary(query.walletAddress, chain, query.days)),
    runProvider(providers, "moralisBalances", isMoralisConfigured() && isEvmChain(chain), () => getWalletTokenBalances(query.walletAddress, chain)),
    runProvider(providers, "birdeyeNetWorth", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletCurrentNetWorth(query.walletAddress, 20)),
    runProvider(providers, "birdeyePnl", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletPnlSummary(query.walletAddress, `${query.days}d`)),
    runProvider(providers, "birdeyeTxList", isBirdeyeConfigured() && chain === "sol", () => getBirdeyeWalletTxList(query.walletAddress, query.pageCount)),
    runProvider(providers, "zerionPnl", isZerionConfigured(), () => getZerionWalletPnl(query.walletAddress, chain)),
  ]);

  const moralisTokenList = Array.isArray(moralisTokens) ? moralisTokens : [];
  const birdeyeTokenList = birdeyeNetWorth?.data?.items ?? [];

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
  const birdeyeRealizedProfitPct = parseNumber(birdeyePnlSummary?.data?.summary?.pnl?.realized_profit_percent);
  const zerionRealizedProfitPct = parseNumber(zerionPnl?.data?.attributes?.changes_percent);
  const zerionRealizedProfitUsd = parseNumber(zerionPnl?.data?.attributes?.realized_absolute);
  const totalNetWorthUsd = firstNumber(debankTotalBalance?.total_usd_value, birdeyeNetWorth?.data?.total_value);
  const finalRealizedProfitPct = realizedProfitPct ?? birdeyeRealizedProfitPct ?? zerionRealizedProfitPct;
  const birdeyeTradeVolumeUsd = (() => {
    const invested = parseNumber(birdeyePnlSummary?.data?.summary?.cashflow_usd?.total_invested) ?? 0;
    const sold = parseNumber(birdeyePnlSummary?.data?.summary?.cashflow_usd?.total_sold) ?? 0;
    const total = invested + sold;
    return total > 0 ? total : null;
  })();
  const activeChains = new Set((debankTotalBalance?.chain_list ?? []).flatMap((chainBalance) => chainBalance.id ? [chainBalance.id] : []));
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
      chainNetWorthUsd: firstNumber(chainNetWorthUsd, birdeyeNetWorth?.data?.total_value),
      realizedProfitUsd: firstNumber(moralisProfitability?.total_realized_profit_usd, birdeyePnlSummary?.data?.summary?.pnl?.realized_profit_usd, zerionRealizedProfitUsd),
      realizedProfitPct: finalRealizedProfitPct,
      totalTradeVolumeUsd: firstNumber(moralisProfitability?.total_trade_volume, birdeyeTradeVolumeUsd),
      totalTrades: moralisProfitability?.total_count_of_trades ?? birdeyePnlSummary?.data?.summary?.counts?.total_trade ?? null,
      totalBuys: moralisProfitability?.total_buys ?? birdeyePnlSummary?.data?.summary?.counts?.total_buy ?? null,
      totalSells: moralisProfitability?.total_sells ?? birdeyePnlSummary?.data?.summary?.counts?.total_sell ?? null,
      profitable: finalRealizedProfitPct !== null ? finalRealizedProfitPct > 0 : null,
      tokenCount: topHoldings.length,
      protocolCount: topProtocols.length,
      activeChains: [...activeChains],
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