// DOCS: https://api.santiment.net/graphiql (GraphQL API)

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type SantimentProject = {
  name?: string;
  slug?: string;
  ticker?: string;
  infrastructure?: string;
  marketcapUsd?: number;
};

type SantimentGraphqlResponse = {
  data?: {
    projectBySlug?: SantimentProject;
  };
  errors?: Array<{ message?: string }>;
};

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getRequiredEnv("SANTIMENT_API_KEY")}`,
  };
}

export function isSantimentConfigured(): boolean {
  return isConfigured(getOptionalEnv("SANTIMENT_API_KEY"));
}

/** POST /graphql – fetch project metadata by slug. */
export async function getProjectBySlug(slug: string): Promise<SantimentGraphqlResponse> {
  const query = `query SantimentProject($slug: String!) {
  projectBySlug(slug: $slug) {
    name
    slug
    ticker
    infrastructure
    marketcapUsd
  }
}`;

  return requestJson<SantimentGraphqlResponse>("https://api.santiment.net/graphql", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ query, variables: { slug } }),
  });
}
