import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

export type XPublicMetrics = {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  impression_count?: number;
  quote_count?: number;
  bookmark_count?: number;
};

export type XUser = {
  id: string;
  name?: string;
  username?: string;
  verified?: boolean;
  protected?: boolean;
  created_at?: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
    like_count?: number;
  };
};

export type XPost = {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: XPublicMetrics;
};

export type XSearchResponse = {
  data?: Array<{
    id: string;
    text?: string;
    created_at?: string;
    author_id?: string;
    public_metrics?: XPublicMetrics;
  }>;
  includes?: {
    users?: XUser[];
  };
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count?: number;
    next_token?: string;
  };
};

export type XCountBucket = {
  start?: string;
  end?: string;
  tweet_count?: number;
};

export type XRecentCountsResponse = {
  data?: XCountBucket[];
  meta?: {
    total_tweet_count?: number;
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
  };
};

export type XUserLookupResponse = {
  data?: XUser;
  errors?: Array<{
    detail?: string;
    status?: number;
    title?: string;
    type?: string;
  }>;
};

export type XPaginatedPostsResponse = {
  data?: XPost[];
  includes?: {
    users?: XUser[];
  };
  meta?: {
    result_count?: number;
    next_token?: string;
    previous_token?: string;
  };
};

export type XPaginatedUsersResponse = {
  data?: XUser[];
  includes?: {
    users?: XUser[];
  };
  meta?: {
    result_count?: number;
    next_token?: string;
    previous_token?: string;
  };
};

export type XStreamRule = {
  id?: string;
  value?: string;
  tag?: string;
};

export type XStreamRulesResponse = {
  data?: XStreamRule[];
  meta?: {
    sent?: string;
    result_count?: number;
    summary?: {
      created?: number;
      not_created?: number;
      valid?: number;
      invalid?: number;
      deleted?: number;
      not_deleted?: number;
    };
  };
  errors?: Array<{
    detail?: string;
    status?: number;
    title?: string;
    type?: string;
  }>;
};

export function isXConfigured(): boolean {
  return isConfigured(getOptionalEnv("X_BEARER_TOKEN"));
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getRequiredEnv("X_BEARER_TOKEN")}`,
  };
}

export async function searchRecentPosts(query: string, maxResults = 25): Promise<XSearchResponse> {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics,verified"
  });

  return requestJson<XSearchResponse>(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    headers: getHeaders(),
  });
}

export async function countRecentPosts(
  query: string,
  granularity: "minute" | "hour" | "day" = "hour",
): Promise<XRecentCountsResponse> {
  const params = new URLSearchParams({
    query,
    granularity,
  });

  return requestJson<XRecentCountsResponse>(`https://api.x.com/2/tweets/counts/recent?${params.toString()}`, {
    headers: getHeaders(),
  });
}

export async function getUserByUsername(username: string): Promise<XUserLookupResponse> {
  const params = new URLSearchParams({
    "user.fields": "created_at,description,profile_image_url,public_metrics,protected,username,verified",
  });

  return requestJson<XUserLookupResponse>(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?${params.toString()}`, {
    headers: getHeaders(),
  });
}

export async function getLikedPosts(
  userId: string,
  maxResults = 25,
  paginationToken?: string,
): Promise<XPaginatedPostsResponse> {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 5), 100)),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics,verified",
  });

  if (paginationToken) {
    params.set("pagination_token", paginationToken);
  }

  return requestJson<XPaginatedPostsResponse>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/liked_tweets?${params.toString()}`, {
    headers: getHeaders(),
  });
}

export async function getFollowers(
  userId: string,
  maxResults = 25,
  paginationToken?: string,
): Promise<XPaginatedUsersResponse> {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 1), 1000)),
    "user.fields": "created_at,description,profile_image_url,public_metrics,protected,username,verified",
  });

  if (paginationToken) {
    params.set("pagination_token", paginationToken);
  }

  return requestJson<XPaginatedUsersResponse>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/followers?${params.toString()}`, {
    headers: getHeaders(),
  });
}

export async function listFilteredStreamRules(): Promise<XStreamRulesResponse> {
  return requestJson<XStreamRulesResponse>("https://api.x.com/2/tweets/search/stream/rules", {
    headers: getHeaders(),
  });
}

export async function updateFilteredStreamRules(body: {
  add?: Array<{ value: string; tag?: string }>;
  delete?: { ids: string[] };
}): Promise<XStreamRulesResponse> {
  return requestJson<XStreamRulesResponse>("https://api.x.com/2/tweets/search/stream/rules", {
    method: "POST",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
