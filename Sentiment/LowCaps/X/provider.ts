import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type XSearchResponse = {
  data?: Array<{
    id: string;
    text?: string;
    created_at?: string;
    author_id?: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      impression_count?: number;
    };
  }>;
  includes?: {
    users?: Array<{
      id: string;
      name?: string;
      username?: string;
      verified?: boolean;
      public_metrics?: {
        followers_count?: number;
      };
    }>;
  };
};

export function isXConfigured(): boolean {
  return isConfigured(getOptionalEnv("X_BEARER_TOKEN"));
}

export async function searchRecentPosts(query: string): Promise<XSearchResponse> {
  const params = new URLSearchParams({
    query,
    max_results: "10",
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics,verified"
  });

  return requestJson<XSearchResponse>(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${getRequiredEnv("X_BEARER_TOKEN")}`
    }
  });
}