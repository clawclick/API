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
  return requestJson<MoralisTokenBalance[]>(
    `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/tokens?chain=${chain}`,
    {
      headers: getHeaders()
    }
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

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