// DOCS: https://thegraph.com/docs/en/ (Uniswap V3 Subgraph)

import { requestJson } from "#lib/http";

type UniswapPool = {
  id?: string;
  createdAtTimestamp?: string;
  token0?: { symbol?: string };
  token1?: { symbol?: string };
};

type UniswapSubgraphResponse = {
  data?: {
    pools?: UniswapPool[];
  };
  errors?: Array<{ message?: string }>;
};

const UNISWAP_V3_SUBGRAPH = "https://gateway.thegraph.com/api/subgraphs/id/ELUcwgpm14LKPLrBRuVvPvNKHQ9HvwmtKgKSH6123cr7";

/** POST subgraph – latest pool creation events on Uniswap V3. No auth required. */
export async function getLatestPools(first = 10): Promise<UniswapSubgraphResponse> {
  const query = `query LatestPools($first: Int!) {
  pools(first: $first, orderBy: createdAtTimestamp, orderDirection: desc) {
    id
    createdAtTimestamp
    token0 { symbol }
    token1 { symbol }
  }
}`;

  return requestJson<UniswapSubgraphResponse>(UNISWAP_V3_SUBGRAPH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { first } }),
  });
}
