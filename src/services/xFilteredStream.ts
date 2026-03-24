import { getRequiredEnv } from "#config/env";
import {
  isXConfigured,
  listFilteredStreamRules,
  updateFilteredStreamRules,
} from "#providers/sentiment/x";
import type { XPostItem } from "#types/api";
import WebSocket from "ws";

type ClientConfig = {
  rules?: Array<{ value: string; tag?: string }>;
  username?: string;
  usernames?: string[];
  userId?: string;
  userIds?: string[];
  includeReplies?: boolean;
  includeRetweets?: boolean;
  lang?: string;
  backfillMinutes?: number;
};

type ClientState = {
  socket: WebSocket;
  ruleKeys: Set<string>;
};

type ManagedRule = {
  key: string;
  value: string;
  tag?: string;
  id: string | null;
  refCount: number;
};

type XStreamEnvelope = {
  data?: {
    id?: string;
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
  matching_rules?: Array<{
    id?: string;
    tag?: string;
  }>;
};

const STREAM_URL = "https://api.x.com/2/tweets/search/stream";
const clients = new Map<WebSocket, ClientState>();
const managedRules = new Map<string, ManagedRule>();
let upstreamAbort: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let upstreamRunning = false;

function ruleKey(rule: { value: string; tag?: string }): string {
  return JSON.stringify({ value: rule.value, tag: rule.tag ?? null });
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, "");
}

function buildUserRuleValue(
  username: string,
  options: {
    includeReplies?: boolean;
    includeRetweets?: boolean;
    lang?: string;
  },
): string {
  const parts = [`from:${normalizeUsername(username)}`];
  if (options.lang?.trim()) {
    parts.push(`lang:${options.lang.trim()}`);
  }
  if (!options.includeReplies) {
    parts.push("-is:reply");
  }
  if (!options.includeRetweets) {
    parts.push("-is:retweet");
  }
  return parts.join(" ");
}

async function resolveUsernames(config: ClientConfig): Promise<string[]> {
  const direct = [
    ...(config.username ? [config.username] : []),
    ...(config.usernames ?? []),
  ]
    .map(normalizeUsername)
    .filter((value) => value.length > 0);

  // We currently support direct username-based X stream rules.
  // userId/userIds are accepted for forward compatibility but not resolved here yet.
  return [...new Set(direct)];
}

async function expandClientRules(config: ClientConfig): Promise<Array<{ value: string; tag?: string }>> {
  const explicitRules = (config.rules ?? [])
    .filter((rule) => typeof rule?.value === "string" && rule.value.trim().length > 0)
    .map((rule) => ({ value: rule.value.trim(), tag: rule.tag?.trim() || undefined }));

  const usernames = await resolveUsernames(config);
  const userRules = usernames.map((username) => ({
    value: buildUserRuleValue(username, config),
    tag: `user:${username}`,
  }));

  return [...explicitRules, ...userRules];
}

function currentRuleIds(): string[] {
  return [...managedRules.values()].flatMap((rule) => rule.id ? [rule.id] : []);
}

async function hydrateRuleIds(): Promise<void> {
  const current = await listFilteredStreamRules();
  const existing = new Map(
    (current.data ?? []).map((rule) => [ruleKey({ value: rule.value ?? "", tag: rule.tag }), rule.id ?? null]),
  );

  for (const rule of managedRules.values()) {
    if (!rule.id) {
      rule.id = existing.get(rule.key) ?? null;
    }
  }
}

async function addRules(rules: ManagedRule[]): Promise<void> {
  if (rules.length === 0) return;

  const response = await updateFilteredStreamRules({
    add: rules.map((rule) => ({ value: rule.value, tag: rule.tag })),
  });

  const returned = response.data ?? [];
  for (const rule of rules) {
    const matched = returned.find((item) => item.value === rule.value && (item.tag ?? undefined) === rule.tag);
    if (matched?.id) {
      rule.id = matched.id;
    }
  }

  if (rules.some((rule) => !rule.id)) {
    await hydrateRuleIds();
  }
}

async function deleteRules(ruleIds: string[]): Promise<void> {
  if (ruleIds.length === 0) return;
  await updateFilteredStreamRules({ delete: { ids: ruleIds } });
}

function mapPost(event: XStreamEnvelope): XPostItem | null {
  if (!event.data?.id) {
    return null;
  }

  const userMap = new Map((event.includes?.users ?? []).map((user) => [user.id, user]));
  const user = event.data.author_id ? userMap.get(event.data.author_id) : undefined;

  return {
    id: event.data.id,
    text: event.data.text ?? "",
    createdAt: event.data.created_at ?? null,
    authorId: event.data.author_id ?? null,
    authorName: user?.name ?? null,
    authorUsername: user?.username ?? null,
    authorVerified: user?.verified ?? null,
    authorFollowers: user?.public_metrics?.followers_count ?? null,
    url: user?.username ? `https://x.com/${user.username}/status/${event.data.id}` : null,
    metrics: {
      likes: event.data.public_metrics?.like_count ?? null,
      replies: event.data.public_metrics?.reply_count ?? null,
      reposts: event.data.public_metrics?.retweet_count ?? null,
      quotes: event.data.public_metrics?.quote_count ?? null,
      bookmarks: event.data.public_metrics?.bookmark_count ?? null,
      impressions: event.data.public_metrics?.impression_count ?? null,
    },
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer || managedRules.size === 0) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureUpstream();
  }, 3000);
}

async function startUpstream(): Promise<void> {
  if (upstreamRunning || managedRules.size === 0) {
    return;
  }

  upstreamRunning = true;
  upstreamAbort?.abort();
  upstreamAbort = new AbortController();

  const params = new URLSearchParams({
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics,verified",
  });

  const response = await fetch(`${STREAM_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${getRequiredEnv("X_BEARER_TOKEN")}`,
    },
    signal: upstreamAbort.signal,
  });

  if (!response.ok || !response.body) {
    upstreamRunning = false;
    throw new Error(`X filtered stream failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let event: XStreamEnvelope;
        try {
          event = JSON.parse(line) as XStreamEnvelope;
        } catch {
          continue;
        }

        const post = mapPost(event);
        if (!post) {
          continue;
        }

        const matchingIds = new Set((event.matching_rules ?? []).flatMap((rule) => rule.id ? [rule.id] : []));
        for (const client of clients.values()) {
          const shouldSend = [...client.ruleKeys].some((key) => {
            const rule = managedRules.get(key);
            return !!rule?.id && matchingIds.has(rule.id);
          });

          if (shouldSend) {
            send(client.socket, { type: "post", data: post });
          }
        }
      }
    }
  } finally {
    upstreamRunning = false;
    scheduleReconnect();
  }
}

async function ensureUpstream(): Promise<void> {
  if (!isXConfigured() || managedRules.size === 0 || upstreamRunning) {
    return;
  }

  try {
    await startUpstream();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const client of clients.values()) {
      send(client.socket, { type: "error", data: message });
    }
    upstreamRunning = false;
    scheduleReconnect();
  }
}

async function applyClientConfig(socket: WebSocket, config: ClientConfig): Promise<void> {
  const state = clients.get(socket);
  if (!state) return;

  const nextKeys = new Set(config.rules.map((rule) => ruleKey(rule)));
  const removedKeys = [...state.ruleKeys].filter((key) => !nextKeys.has(key));
  const addedKeys = [...nextKeys].filter((key) => !state.ruleKeys.has(key));

  const ruleLookup = new Map(config.rules.map((rule) => [ruleKey(rule), rule]));
  const rulesToAdd: ManagedRule[] = [];

  for (const key of addedKeys) {
    const existing = managedRules.get(key);
    if (existing) {
      existing.refCount += 1;
    } else {
      const rule = ruleLookup.get(key)!;
      const managed: ManagedRule = {
        key,
        value: rule.value,
        tag: rule.tag,
        id: null,
        refCount: 1,
      };
      managedRules.set(key, managed);
      rulesToAdd.push(managed);
    }
  }

  await addRules(rulesToAdd);

  const ruleIdsToDelete: string[] = [];
  for (const key of removedKeys) {
    const managed = managedRules.get(key);
    if (!managed) continue;
    managed.refCount -= 1;
    if (managed.refCount <= 0) {
      if (managed.id) {
        ruleIdsToDelete.push(managed.id);
      }
      managedRules.delete(key);
    }
  }

  await deleteRules(ruleIdsToDelete);

  state.ruleKeys = nextKeys;
  send(socket, {
    type: "subscribed",
    data: {
      rules: [...state.ruleKeys].map((key) => {
        const rule = managedRules.get(key);
        return { value: rule?.value ?? null, tag: rule?.tag ?? null, id: rule?.id ?? null };
      }),
      backfillMinutes: config.backfillMinutes ?? null,
    },
  });

  await ensureUpstream();
}

async function removeClient(socket: WebSocket): Promise<void> {
  const state = clients.get(socket);
  if (!state) return;

  clients.delete(socket);
  const ruleIdsToDelete: string[] = [];
  for (const key of state.ruleKeys) {
    const managed = managedRules.get(key);
    if (!managed) continue;
    managed.refCount -= 1;
    if (managed.refCount <= 0) {
      if (managed.id) {
        ruleIdsToDelete.push(managed.id);
      }
      managedRules.delete(key);
    }
  }

  await deleteRules(ruleIdsToDelete);

  if (managedRules.size === 0) {
    upstreamAbort?.abort();
    upstreamAbort = null;
    upstreamRunning = false;
  }
}

export function handleXFilteredStreamClient(socket: WebSocket): void {
  clients.set(socket, { socket, ruleKeys: new Set() });

  send(socket, {
    type: "info",
    data: "Connected. Send JSON like {\"rules\":[{\"value\":\"bitcoin lang:en -is:retweet\",\"tag\":\"btc\"}]} to start X filtered streaming.",
  });

  socket.on("message", (message) => {
    void (async () => {
      if (!isXConfigured()) {
        send(socket, { type: "error", data: "Set X_BEARER_TOKEN in .env to use X filtered stream." });
        return;
      }

      let parsed: ClientConfig;
      try {
        parsed = JSON.parse(message.toString()) as ClientConfig;
      } catch {
        send(socket, { type: "error", data: "Invalid JSON message." });
        return;
      }

      const expandedRules = await expandClientRules(parsed);

      if (expandedRules.length === 0) {
        send(socket, { type: "error", data: "Provide rules, username, or usernames." });
        return;
      }

      await applyClientConfig(socket, {
        rules: expandedRules,
        backfillMinutes: parsed.backfillMinutes,
      });
    })();
  });

  socket.on("close", () => {
    void removeClient(socket);
  });

  socket.on("error", () => {
    void removeClient(socket);
  });
}
