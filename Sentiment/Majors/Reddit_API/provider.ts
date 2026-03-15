import { Buffer } from "node:buffer";
import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type RedditTokenResponse = {
  access_token: string;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        selftext?: string;
        subreddit?: string;
        author?: string;
        created_utc?: number;
        permalink?: string;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
};

export function isRedditConfigured(): boolean {
  return ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT"].every((envName) => isConfigured(getOptionalEnv(envName)));
}

async function getAccessToken(): Promise<string> {
  const clientId = getRequiredEnv("REDDIT_CLIENT_ID");
  const clientSecret = getRequiredEnv("REDDIT_CLIENT_SECRET");
  const userAgent = getRequiredEnv("REDDIT_USER_AGENT");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const token = await requestJson<RedditTokenResponse>("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent
    },
    body: "grant_type=client_credentials"
  });

  return token.access_token;
}

export async function searchPosts(query: string): Promise<RedditSearchResponse> {
  const token = await getAccessToken();
  const userAgent = getRequiredEnv("REDDIT_USER_AGENT");
  const params = new URLSearchParams({
    q: query,
    limit: "10",
    sort: "new",
    type: "link"
  });

  return requestJson<RedditSearchResponse>(`https://oauth.reddit.com/search.json?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent
    }
  });
}