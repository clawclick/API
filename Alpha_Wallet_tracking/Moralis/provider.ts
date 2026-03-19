import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import type { SupportedChain } from "#providers/shared/chains";

type MoralisProfitabilitySummary = {
  total_count_of_trades?: number;
  total_trade_volume?: string;
  total_realized_profit_usd?: string;
  total_realized_profit_percentage?: number;
  total_buys?: number;
  total_sells?: number;
  total_sold_volume_usd?: string;
  total_bought_volume_usd?: string;
};

type MoralisTokenBalance = {
  token_address?: string;
  symbol?: string | null;
  name?: string | null;
  logo?: string | null;
  balance_formatted?: string;
  usd_price?: number;
  usd_value?: number;
};

type MoralisTokenBalancesResponse = {
  result?: MoralisTokenBalance[];
};

function getHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "X-API-Key": getRequiredEnv("MORALIS_API_KEY")
  };
}

export function isMoralisConfigured(): boolean {
  return isConfigured(getOptionalEnv("MORALIS_API_KEY"));
}

export async function getWalletProfitabilitySummary(walletAddress: string, chain: SupportedChain, days: string): Promise<MoralisProfitabilitySummary> {
  return requestJson<MoralisProfitabilitySummary>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/profitability/summary?chain=${chain}&days=${days}`,
    {
      headers: getHeaders()
    }
  );
}

export async function getWalletTokenBalances(walletAddress: string, chain: SupportedChain): Promise<MoralisTokenBalance[]> {
  const response = await requestJson<MoralisTokenBalance[] | MoralisTokenBalancesResponse>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/tokens?chain=${chain}`,
    {
      headers: getHeaders()
    }
  );

  if (Array.isArray(response)) {
    return response;
  }

  return Array.isArray(response.result) ? response.result : [];
}


type MoralisNetWorth = {
  total_networth_usd?: string;
  chains?: Array<{
    chain?: string;
    native_balance?: string;
    native_balance_formatted?: string;
    native_balance_usd?: string;
    token_balance_usd?: string;
    networth_usd?: string;
  }>;
};

/** GET /wallets/{address}/net-worth – total USD net-worth with per-chain breakdown. */
export async function getWalletNetWorth(walletAddress: string): Promise<MoralisNetWorth> {
  return requestJson<MoralisNetWorth>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/net-worth`,
    { headers: getHeaders() },
  );
}

type MoralisHistoryItem = {
  hash?: string;
  from_address?: string;
  to_address?: string;
  value?: string;
  block_timestamp?: string;
  category?: string;
  summary?: string;
  erc20_transfers?: Array<{
    token_name?: string;
    token_symbol?: string;
    value_formatted?: string;
    direction?: string;
  }>;
  nft_transfers?: Array<{
    token_name?: string;
    token_id?: string;
    direction?: string;
  }>;
};

type MoralisHistoryResponse = {
  cursor?: string;
  result?: MoralisHistoryItem[];
};

/** GET /wallets/{address}/history – decoded transaction history with ERC-20 & NFT transfers. */
export async function getWalletHistory(walletAddress: string, chain: SupportedChain, limit = 25): Promise<MoralisHistoryResponse> {
  return requestJson<MoralisHistoryResponse>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/history?chain=${chain}&limit=${limit}`,
    { headers: getHeaders() },
  );
}

type MoralisPnlToken = {
  token_address?: string;
  name?: string;
  symbol?: string;
  avg_buy_price_usd?: string;
  avg_sell_price_usd?: string;
  total_tokens_bought?: string;
  total_tokens_sold?: string;
  realized_profit_usd?: string;
  realized_profit_percentage?: number;
  count_of_trades?: number;
};

type MoralisPnlResponse = {
  result?: MoralisPnlToken[];
  cursor?: string;
};

/** GET /wallets/{address}/profitability – per-token PnL breakdown (buy/sell prices, win rate). */
export async function getWalletPnlBreakdown(walletAddress: string, chain: SupportedChain, days = "all"): Promise<MoralisPnlResponse> {
  return requestJson<MoralisPnlResponse>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/profitability?chain=${chain}&days=${days}`,
    { headers: getHeaders() },
  );
}

type MoralisTokenOwner = {
  owner_address?: string;
  owner_address_label?: string | null;
  balance?: string;
  balance_formatted?: string;
  usd_value?: string;
  is_contract?: boolean;
  percentage_relative_to_total_supply?: number;
  entity?: string | null;
  entity_logo?: string | null;
};

type MoralisTokenOwnersResponse = {
  result?: MoralisTokenOwner[];
  page?: number;
  page_size?: number;
  cursor?: string;
  total_supply?: string;
};

/** GET /erc20/{token_address}/owners – top ERC20 holders with labels/entity data. */
export async function getTokenOwners(tokenAddress: string, chain: SupportedChain, limit = 10): Promise<MoralisTokenOwnersResponse> {
  return requestJson<MoralisTokenOwnersResponse>(
    `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/owners?chain=${chain}&order=DESC&limit=${limit}`,
    { headers: getHeaders() },
  );
}

type MoralisHolderBucket = {
  supply?: string;
  supplyPercent?: string;
};

type MoralisHolderChange = {
  change?: string;
  changePercent?: string;
};

type MoralisTokenHolderStats = {
  totalHolders?: number;
  holderSupply?: {
    top10?: MoralisHolderBucket;
    top25?: MoralisHolderBucket;
    top50?: MoralisHolderBucket;
    top100?: MoralisHolderBucket;
    top250?: MoralisHolderBucket;
    top500?: MoralisHolderBucket;
  };
  holderChange?: {
    "5min"?: MoralisHolderChange;
    "1h"?: MoralisHolderChange;
    "6h"?: MoralisHolderChange;
    "24h"?: MoralisHolderChange;
    "3d"?: MoralisHolderChange;
    "7d"?: MoralisHolderChange;
    "30d"?: MoralisHolderChange;
  };
  holdersByAcquisition?: {
    swap?: string;
    transfer?: string;
    airdrop?: string;
  };
  holderDistribution?: {
    whales?: string;
    sharks?: string;
    dolphins?: string;
    fish?: string;
    octopus?: string;
    crabs?: string;
    shrimps?: string;
  };
};

/** GET /erc20/{tokenAddress}/holders – aggregated holder metrics and distribution buckets. */
export async function getTokenHolderStats(tokenAddress: string, chain: SupportedChain): Promise<MoralisTokenHolderStats> {
  if (chain === "sol") {
    return requestJson<MoralisTokenHolderStats>(
      `https://solana-gateway.moralis.io/token/mainnet/holders/${tokenAddress}`,
      { headers: getHeaders() },
    );
  }

  return requestJson<MoralisTokenHolderStats>(
    `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/holders?chain=${chain}`,
    { headers: getHeaders() },
  );
}