import { getOptionalEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import { toAlchemyNetwork, type SupportedChain } from "#providers/shared/chains";

type AlchemyPricePoint = {
  value: string;
  timestamp: string;
};

type AlchemyHistoricalResponse = {
  data?: AlchemyPricePoint[];
};

export function isAlchemyConfigured(): boolean {
  return isConfigured(getOptionalEnv("ALCHEMY_API_KEY"));
}

export async function getHistoricalPrices(
  chain: SupportedChain,
  tokenAddress: string,
  startTime: string,
  endTime: string,
  interval = "1d"
): Promise<AlchemyHistoricalResponse> {
  const apiKey = getOptionalEnv("ALCHEMY_API_KEY");
  const network = toAlchemyNetwork(chain);

  return requestJson<AlchemyHistoricalResponse>(
    `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network,
        address: tokenAddress,
        startTime,
        endTime,
        interval
      })
    }
  );
}
