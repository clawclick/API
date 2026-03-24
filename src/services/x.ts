import {
  countRecentPosts,
  getFollowers,
  getLikedPosts,
  getUserByUsername,
  isXConfigured,
  searchRecentPosts,
} from "#providers/sentiment/x";
import { runProvider, summarizeStatus } from "#lib/runProvider";
import type {
  XCountRecentQuery,
  XSearchQuery,
  XUserByUsernameQuery,
  XUserFollowersQuery,
  XUserLikesQuery,
} from "#routes/helpers";
import type {
  ProviderStatus,
  XCountRecentResponse,
  XPostItem,
  XSearchResponse,
  XUserByUsernameResponse,
  XUserFollowersResponse,
  XUserLikesResponse,
  XUserSummary,
} from "#types/api";

type XUserLike = {
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

type XPostLike = {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    impression_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
};

function mapUser(user: XUserLike | null | undefined): XUserSummary | null {
  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    name: user.name ?? null,
    username: user.username ?? null,
    verified: user.verified ?? null,
    protected: user.protected ?? null,
    createdAt: user.created_at ?? null,
    description: user.description ?? null,
    profileImageUrl: user.profile_image_url ?? null,
    metrics: {
      followers: user.public_metrics?.followers_count ?? null,
      following: user.public_metrics?.following_count ?? null,
      tweets: user.public_metrics?.tweet_count ?? null,
      listed: user.public_metrics?.listed_count ?? null,
      likes: user.public_metrics?.like_count ?? null,
    },
  };
}

function mapPosts(posts: XPostLike[] | undefined, users: XUserLike[] | undefined): XPostItem[] {
  const userMap = new Map((users ?? []).map((user) => [user.id, user]));

  return (posts ?? []).map((post) => {
    const user = post.author_id ? userMap.get(post.author_id) : undefined;

    return {
      id: post.id,
      text: post.text ?? "",
      createdAt: post.created_at ?? null,
      authorId: post.author_id ?? null,
      authorName: user?.name ?? null,
      authorUsername: user?.username ?? null,
      authorVerified: user?.verified ?? null,
      authorFollowers: user?.public_metrics?.followers_count ?? null,
      url: user?.username ? `https://x.com/${user.username}/status/${post.id}` : null,
      metrics: {
        likes: post.public_metrics?.like_count ?? null,
        replies: post.public_metrics?.reply_count ?? null,
        reposts: post.public_metrics?.retweet_count ?? null,
        quotes: post.public_metrics?.quote_count ?? null,
        bookmarks: post.public_metrics?.bookmark_count ?? null,
        impressions: post.public_metrics?.impression_count ?? null,
      },
    };
  });
}

async function resolveUserId(
  providers: ProviderStatus[],
  userId: string | undefined,
  username: string | undefined,
): Promise<{ userId: string | null; username: string | null; user: XUserSummary | null }> {
  if (userId) {
    return { userId, username: username ?? null, user: null };
  }

  if (!username) {
    return { userId: null, username: null, user: null };
  }

  const lookup = await runProvider(
    providers,
    "x:userByUsername",
    isXConfigured(),
    () => getUserByUsername(username),
    "X bearer token not configured.",
  );

  return {
    userId: lookup?.data?.id ?? null,
    username,
    user: mapUser(lookup?.data),
  };
}

export async function getXSearch(query: XSearchQuery): Promise<XSearchResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:searchRecentPosts",
    isXConfigured(),
    () => searchRecentPosts(query.query, query.maxResults),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xSearch",
    status: summarizeStatus(providers),
    query: query.query,
    maxResults: query.maxResults,
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    posts: mapPosts(result?.data, result?.includes?.users),
    providers,
  };
}

export async function getXCountRecent(query: XCountRecentQuery): Promise<XCountRecentResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:countRecentPosts",
    isXConfigured(),
    () => countRecentPosts(query.query, query.granularity),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xCountRecent",
    status: summarizeStatus(providers),
    query: query.query,
    granularity: query.granularity,
    totalPostCount: result?.meta?.total_tweet_count ?? null,
    nextToken: result?.meta?.next_token ?? null,
    buckets: (result?.data ?? []).map((bucket) => ({
      start: bucket.start ?? null,
      end: bucket.end ?? null,
      postCount: bucket.tweet_count ?? null,
    })),
    providers,
  };
}

export async function getXUserByUsernameData(query: XUserByUsernameQuery): Promise<XUserByUsernameResponse> {
  const providers: ProviderStatus[] = [];
  const result = await runProvider(
    providers,
    "x:userByUsername",
    isXConfigured(),
    () => getUserByUsername(query.username),
    "X bearer token not configured.",
  );

  return {
    endpoint: "xUserByUsername",
    status: summarizeStatus(providers),
    username: query.username,
    user: mapUser(result?.data),
    providers,
  };
}

export async function getXUserLikesData(query: XUserLikesQuery): Promise<XUserLikesResponse> {
  const providers: ProviderStatus[] = [];
  const resolved = await resolveUserId(providers, query.userId, query.username);

  const result = await runProvider(
    providers,
    "x:userLikes",
    isXConfigured() && !!resolved.userId,
    () => getLikedPosts(resolved.userId!, query.maxResults, query.paginationToken),
    !isXConfigured()
      ? "X bearer token not configured."
      : "Could not resolve an X user id from the provided username.",
  );

  return {
    endpoint: "xUserLikes",
    status: summarizeStatus(providers),
    username: resolved.username,
    userId: resolved.userId ?? "",
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    posts: mapPosts(result?.data, result?.includes?.users),
    providers,
  };
}

export async function getXUserFollowersData(query: XUserFollowersQuery): Promise<XUserFollowersResponse> {
  const providers: ProviderStatus[] = [];
  const resolved = await resolveUserId(providers, query.userId, query.username);

  const result = await runProvider(
    providers,
    "x:userFollowers",
    isXConfigured() && !!resolved.userId,
    () => getFollowers(resolved.userId!, query.maxResults, query.paginationToken),
    !isXConfigured()
      ? "X bearer token not configured."
      : "Could not resolve an X user id from the provided username.",
  );

  return {
    endpoint: "xUserFollowers",
    status: summarizeStatus(providers),
    username: resolved.username,
    userId: resolved.userId ?? "",
    count: result?.meta?.result_count ?? 0,
    nextToken: result?.meta?.next_token ?? null,
    followers: (result?.data ?? []).map((user) => mapUser(user)).filter((user): user is XUserSummary => user !== null),
    providers,
  };
}
