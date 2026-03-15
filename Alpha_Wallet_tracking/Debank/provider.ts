import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type DebankChainBalance = {
  id?: string;
  usd_value?: number;
  name?: string;
};

type DebankTotalBalanceResponse = {
  total_usd_value?: number;
  chain_list?: DebankChainBalance[];
};

type DebankProtocol = {
  id?: string;
  chain?: string;
  name?: string | null;
  site_url?: string | null;
  net_usd_value?: number;
  asset_usd_value?: number;
  debt_usd_value?: number;
};

type DebankToken = {
  id?: string;
  chain?: string;
  name?: string | null;
  symbol?: string | null;
  logo_url?: string | null;
  price?: number;
  amount?: number;
};

type DebankHistoryItem = {
  cate_id?: string;
  chain?: string;
  id?: string;
  project_id?: string | null;
  cex_id?: string | null;
  time_at?: number;
  sends?: unknown[];
  receives?: unknown[];
  tx?: {
    usd_gas_fee?: number;
  };
};

type DebankHistoryResponse = {
  history_list?: DebankHistoryItem[];
};

type DebankAuthorizedToken = {
  id?: string;
  name?: string | null;
  symbol?: string | null;
  chain?: string;
  sum_exposure_usd?: number;
  spenders?: unknown[];
};

function getHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    AccessKey: getRequiredEnv("DEBANK_API_KEY")
  };
}

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const baseUrl = getOptionalEnv("DEBANK_API_BASE_URL", "https://pro-openapi.debank.com");
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  return `${baseUrl}${path}?${search.toString()}`;
}

export function isDebankConfigured(): boolean {
  return isConfigured(getOptionalEnv("DEBANK_API_KEY"));
}

export async function getTotalBalance(walletAddress: string): Promise<DebankTotalBalanceResponse> {
  return requestJson<DebankTotalBalanceResponse>(buildUrl("/v1/user/total_balance", { id: walletAddress }), {
    headers: getHeaders()
  });
}

export async function getSimpleProtocolList(walletAddress: string, chainId: string): Promise<DebankProtocol[]> {
  return requestJson<DebankProtocol[]>(buildUrl("/v1/user/simple_protocol_list", { id: walletAddress, chain_id: chainId }), {
    headers: getHeaders()
  });
}

export async function getTokenList(walletAddress: string, chainId: string): Promise<DebankToken[]> {
  return requestJson<DebankToken[]>(buildUrl("/v1/user/token_list", { id: walletAddress, chain_id: chainId, is_all: false }), {
    headers: getHeaders()
  });
}

export async function getHistoryList(walletAddress: string, chainId: string, pageCount: number): Promise<DebankHistoryResponse> {
  return requestJson<DebankHistoryResponse>(buildUrl("/v1/user/history_list", { id: walletAddress, chain_id: chainId, page_count: pageCount }), {
    headers: getHeaders()
  });
}

export async function getTokenAuthorizedList(walletAddress: string, chainId: string): Promise<DebankAuthorizedToken[]> {
  return requestJson<DebankAuthorizedToken[]>(buildUrl("/v1/user/token_authorized_list", { id: walletAddress, chain_id: chainId }), {
    headers: getHeaders()
  });
}