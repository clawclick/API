import { requestJson } from "#lib/http";

type PolymarketMarket = {
  id: string;
  question?: string;
  slug?: string;
  category?: string;
  endDate?: string;
  volume?: string;
  liquidity?: string;
};

export async function searchMarkets(query: string): Promise<PolymarketMarket[]> {
  const markets = await requestJson<PolymarketMarket[]>("https://gamma-api.polymarket.com/markets?limit=100");
  const lowered = query.toLowerCase();

  return markets.filter((market) => {
    const haystack = `${market.question ?? ""} ${market.slug ?? ""} ${market.category ?? ""}`.toLowerCase();
    return haystack.includes(lowered);
  }).slice(0, 5);
}