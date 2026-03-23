import { getOptionalEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import { toCoinGeckoPlatform, type SupportedChain } from "#providers/shared/chains";

type TokenPriceRecord = {
  usd?: number;
  usd_market_cap?: number;
  usd_24h_vol?: number;
  usd_24h_change?: number;
};

type MarketChartResponse = {
  prices?: Array<[number, number]>;
};

function buildHeaders(): Record<string, string> | undefined {
  const apiKey = getOptionalEnv("COINGECKO_PRO_API_KEY");
  if (!isConfigured(apiKey)) {
    return undefined;
  }

  return {
    "x-cg-pro-api-key": apiKey
  };
}

function getBaseUrl(): string {
  return isConfigured(getOptionalEnv("COINGECKO_PRO_API_KEY"))
    ? "https://api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";
}

export async function getTokenPrice(chain: SupportedChain, tokenAddress: string): Promise<TokenPriceRecord | null> {
  const platform = toCoinGeckoPlatform(chain);
  if (!platform) {
    return null;
  }

  const response = await requestJson<Record<string, TokenPriceRecord>>(
    `${getBaseUrl()}/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`,
    { headers: buildHeaders() }
  );

  return response[tokenAddress.toLowerCase()] ?? null;
}

export async function getTokenMarketChart(chain: SupportedChain, tokenAddress: string, days: number): Promise<MarketChartResponse | null> {
  const platform = toCoinGeckoPlatform(chain);
  if (!platform) {
    return null;
  }

  return requestJson<MarketChartResponse>(
    `${getBaseUrl()}/coins/${platform}/contract/${tokenAddress}/market_chart/?vs_currency=usd&days=${days}`,
    { headers: buildHeaders() }
  );
}

export async function getCoinMarketChart(coinId: string, days: number): Promise<MarketChartResponse | null> {
  return requestJson<MarketChartResponse>(
    `${getBaseUrl()}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
    { headers: buildHeaders() }
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type CoinGeckoCoinDetail = {
  id?: string;
  symbol?: string;
  name?: string;
  market_cap_rank?: number;
  market_data?: {
    current_price?: Record<string, number>;
    market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
    ath?: Record<string, number>;
    ath_change_percentage?: Record<string, number>;
    price_change_percentage_24h?: number;
    price_change_percentage_7d?: number;
    price_change_percentage_30d?: number;
  };
  categories?: string[];
  description?: { en?: string };
  links?: { homepage?: string[]; twitter_screen_name?: string };
  sentiment_votes_up_percentage?: number;
  last_updated?: string;
};

/** GET /coins/{id} – full metadata + market data for a coin by CoinGecko ID. */
export async function getCoinDetails(coinId: string): Promise<CoinGeckoCoinDetail> {
  return requestJson<CoinGeckoCoinDetail>(
    `${getBaseUrl()}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
    { headers: buildHeaders() },
  );
}

type CoinGeckoMarketItem = {
  id?: string;
  symbol?: string;
  name?: string;
  image?: string;
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  fully_diluted_valuation?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
  circulating_supply?: number;
  total_supply?: number;
  ath?: number;
  ath_change_percentage?: number;
};

/** GET /coins/markets – paginated list of coins with market data, sorted by market cap. */
export async function getCoinsMarkets(vsCurrency = "usd", perPage = 100, page = 1, ids?: string): Promise<CoinGeckoMarketItem[]> {
  let url = `${getBaseUrl()}/coins/markets?vs_currency=${vsCurrency}&per_page=${perPage}&page=${page}&sparkline=false`;
  if (ids) url += `&ids=${ids}`;
  return requestJson<CoinGeckoMarketItem[]>(url, { headers: buildHeaders() });
}

type CoinGeckoListItem = {
  id?: string;
  symbol?: string;
  name?: string;
  platforms?: Record<string, string>;
};

/** GET /coins/list – lightweight list of all coins (id, name, symbol, platforms). */
export async function getCoinsList(includePlatform = true): Promise<CoinGeckoListItem[]> {
  return requestJson<CoinGeckoListItem[]>(
    `${getBaseUrl()}/coins/list?include_platform=${includePlatform}`,
    { headers: buildHeaders() },
  );
}