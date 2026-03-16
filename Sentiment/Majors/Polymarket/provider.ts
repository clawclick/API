import { requestJson } from "#lib/http";

type PolymarketMarket = {
  id: string;
  question?: string;
  slug?: string;
  category?: string;
  endDate?: string;
  volume?: string;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
};

export async function searchMarkets(query: string): Promise<PolymarketMarket[]> {
  const markets = await requestJson<PolymarketMarket[]>("https://gamma-api.polymarket.com/markets?limit=500");
  const lowered = query.toLowerCase();
  const now = Date.now();
  const recentWindowMs = 30 * 24 * 60 * 60 * 1000;

  return markets
    .filter((market) => {
      const haystack = `${market.question ?? ""} ${market.slug ?? ""} ${market.category ?? ""}`.toLowerCase();
      if (!haystack.includes(lowered)) {
        return false;
      }

      if (market.archived === true || market.closed === true) {
        return false;
      }

      const endTime = market.endDate ? Date.parse(market.endDate) : NaN;
      if (Number.isFinite(endTime) && endTime < now - recentWindowMs) {
        return false;
      }

      return market.active !== false;
    })
    .sort((left, right) => {
      const rightScore = (right.volume24hr ?? 0) + (right.volume1wk ?? 0) + (right.volume1mo ?? 0);
      const leftScore = (left.volume24hr ?? 0) + (left.volume1wk ?? 0) + (left.volume1mo ?? 0);
      return rightScore - leftScore;
    })
    .slice(0, 5);
}