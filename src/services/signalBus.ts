import { getOptionalEnv, isConfigured } from "#config/env";
import { createClient } from "redis";

export const GLOBAL_SIGNAL_STREAMS = ["bottomsUp", "momentumGains", "momentumStart", "newPump"] as const;

export type GlobalSignalStream = (typeof GLOBAL_SIGNAL_STREAMS)[number];
export type SignalStream = GlobalSignalStream | "chartHealth";
export type SignalEventType =
  | "status"
  | "signal_detected"
  | "scan_completed"
  | "snapshot"
  | "alert"
  | "error";

export type SignalScope = "global" | "token";

export type SignalEvent = {
  id?: string;
  stream: SignalStream;
  scope: SignalScope;
  tokenAddress?: string;
  type: SignalEventType;
  emittedAt: string;
  source: string;
  data: Record<string, unknown>;
};

export type SignalLatestState = {
  stream: SignalStream;
  scope: SignalScope;
  tokenAddress?: string;
  status: "idle" | "warming_up" | "starting" | "running" | "stopped" | "error";
  running: boolean;
  updatedAt: string | null;
  lastEvent: SignalEvent | null;
  lastSummary: Record<string, unknown> | null;
  lastSnapshot: Record<string, unknown> | null;
  lastError: Record<string, unknown> | null;
  recentSignals: SignalEvent[];
  recentAlerts: SignalEvent[];
  meta: Record<string, unknown>;
};

type SignalEventListener = (event: SignalEvent) => void;

const REDIS_URL = getOptionalEnv(
  "REDIS_URL",
  getOptionalEnv("REDISCLOUD", getOptionalEnv("REDISCLOUD_URL")),
);
const SIGNAL_PUBSUB_CHANNEL = "signals:pubsub";
const GLOBAL_SIGNAL_ACTIVE_SET_KEY = "signals:global:active_streams";
const CHART_HEALTH_ACTIVE_SET_KEY = "signals:chartHealth:active_tokens";
const SIGNAL_RECENT_LIMIT = Number(getOptionalEnv("SIGNAL_RECENT_LIMIT", "25"));
const SIGNAL_STREAM_MAXLEN = Number(getOptionalEnv("SIGNAL_STREAM_MAXLEN", "1000"));
const CHART_HEALTH_TTL_MS = Number(getOptionalEnv("SIGNAL_CHART_HEALTH_TTL_MS", String(15 * 60 * 1000)));
const GLOBAL_SIGNAL_WS_TTL_MS = Number(getOptionalEnv("SIGNAL_GLOBAL_WS_TTL_MS", "15000"));
const CHART_HEALTH_WS_TTL_MS = Number(getOptionalEnv("SIGNAL_CHART_HEALTH_WS_TTL_MS", "15000"));

type RedisConnection = ReturnType<typeof createClient>;

let commandClient: RedisConnection | null = null;
let subscriberClient: RedisConnection | null = null;
let commandConnectPromise: Promise<RedisConnection> | null = null;
let subscriberConnectPromise: Promise<RedisConnection> | null = null;
let subscriberStarted = false;
const signalEventListeners = new Set<SignalEventListener>();

function assertRedisConfigured(): void {
  if (!isSignalRedisConfigured()) {
    throw new Error("REDIS_URL is required for signals REST/WS and the worker dyno.");
  }
}

function getGlobalLatestKey(stream: GlobalSignalStream): string {
  return `signals:${stream}:latest`;
}

function getGlobalEventsKey(stream: GlobalSignalStream): string {
  return `signals:${stream}:events`;
}

function getChartHealthLatestKey(tokenAddress: string): string {
  return `signals:chartHealth:${tokenAddress}:latest`;
}

function getChartHealthEventsKey(tokenAddress: string): string {
  return `signals:chartHealth:${tokenAddress}:events`;
}

function buildEmptyState(
  stream: SignalStream,
  scope: SignalScope,
  tokenAddress?: string,
): SignalLatestState {
  return {
    stream,
    scope,
    ...(tokenAddress ? { tokenAddress } : {}),
    status: scope === "token" ? "warming_up" : "idle",
    running: false,
    updatedAt: null,
    lastEvent: null,
    lastSummary: null,
    lastSnapshot: null,
    lastError: null,
    recentSignals: [],
    recentAlerts: [],
    meta: {},
  };
}

function clampRecent<T>(items: T[]): T[] {
  return items.slice(Math.max(0, items.length - SIGNAL_RECENT_LIMIT));
}

function isGlobalSignalStream(value: string): value is GlobalSignalStream {
  return (GLOBAL_SIGNAL_STREAMS as readonly string[]).includes(value);
}

function getLatestKey(stream: SignalStream, scope: SignalScope, tokenAddress?: string): string {
  if (scope === "token") {
    if (!tokenAddress) {
      throw new Error("tokenAddress is required for token-scoped signal state.");
    }
    return getChartHealthLatestKey(tokenAddress);
  }

  if (stream === "chartHealth") {
    throw new Error("chartHealth requires token scope.");
  }

  return getGlobalLatestKey(stream);
}

function getEventsKey(stream: SignalStream, scope: SignalScope, tokenAddress?: string): string {
  if (scope === "token") {
    if (!tokenAddress) {
      throw new Error("tokenAddress is required for token-scoped signal streams.");
    }
    return getChartHealthEventsKey(tokenAddress);
  }

  if (stream === "chartHealth") {
    throw new Error("chartHealth requires token scope.");
  }

  return getGlobalEventsKey(stream);
}

async function getCommandClient(): Promise<RedisConnection> {
  assertRedisConfigured();

  if (commandClient?.isOpen) {
    return commandClient;
  }

  if (!commandConnectPromise) {
    const client = createClient({ url: REDIS_URL });
    client.on("error", (error) => {
      console.error("[signals] Redis command client error:", error);
    });

    commandConnectPromise = client.connect().then(() => {
      commandClient = client;
      return client;
    }).finally(() => {
      commandConnectPromise = null;
    });
  }

  if (!commandConnectPromise) {
    throw new Error("Redis command client failed to initialize.");
  }

  return commandConnectPromise;
}

async function getSubscriberClient(): Promise<RedisConnection> {
  assertRedisConfigured();

  if (subscriberClient?.isOpen) {
    return subscriberClient;
  }

  if (!subscriberConnectPromise) {
    const client = createClient({ url: REDIS_URL });
    client.on("error", (error) => {
      console.error("[signals] Redis subscriber error:", error);
    });

    subscriberConnectPromise = client.connect().then(() => {
      subscriberClient = client;
      return client;
    }).finally(() => {
      subscriberConnectPromise = null;
    });
  }

  if (!subscriberConnectPromise) {
    throw new Error("Redis subscriber failed to initialize.");
  }

  return subscriberConnectPromise;
}

async function readLatestState(
  stream: SignalStream,
  scope: SignalScope,
  tokenAddress?: string,
): Promise<SignalLatestState | null> {
  const client = await getCommandClient();
  const raw = await client.get(getLatestKey(stream, scope, tokenAddress));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SignalLatestState;
  } catch {
    return null;
  }
}

function mergeSignalEvent(previous: SignalLatestState | null, event: SignalEvent): SignalLatestState {
  const next = previous ?? buildEmptyState(event.stream, event.scope, event.tokenAddress);

  const merged: SignalLatestState = {
    ...next,
    status: next.status,
    running: next.running,
    updatedAt: event.emittedAt,
    lastEvent: event,
    meta: { ...next.meta },
  };

  switch (event.type) {
    case "status": {
      const status = typeof event.data.status === "string" ? event.data.status : next.status;
      const running = typeof event.data.running === "boolean" ? event.data.running : next.running;
      merged.status = (
        status === "idle" ||
        status === "warming_up" ||
        status === "starting" ||
        status === "running" ||
        status === "stopped" ||
        status === "error"
      ) ? status : next.status;
      merged.running = running;
      merged.meta = { ...next.meta, ...event.data };
      return merged;
    }
    case "signal_detected": {
      merged.running = true;
      merged.status = "running";
      merged.recentSignals = clampRecent([...(next.recentSignals ?? []), event]);
      return merged;
    }
    case "scan_completed": {
      merged.running = true;
      merged.status = "running";
      merged.lastSummary = event.data;
      return merged;
    }
    case "snapshot": {
      merged.running = true;
      merged.status = "running";
      merged.lastSnapshot = event.data;
      return merged;
    }
    case "alert": {
      merged.running = true;
      merged.status = "running";
      merged.recentAlerts = clampRecent([...(next.recentAlerts ?? []), event]);
      return merged;
    }
    case "error": {
      merged.status = "error";
      merged.lastError = event.data;
      return merged;
    }
    default:
      return merged;
  }
}

async function writeLatestState(state: SignalLatestState): Promise<void> {
  const client = await getCommandClient();
  await client.set(
    getLatestKey(state.stream, state.scope, state.tokenAddress),
    JSON.stringify(state),
  );
}

export function isSignalRedisConfigured(): boolean {
  return isConfigured(REDIS_URL);
}

export function getChartHealthInterestTtlMs(): number {
  return CHART_HEALTH_TTL_MS;
}

export function getGlobalSignalWsTtlMs(): number {
  return GLOBAL_SIGNAL_WS_TTL_MS;
}

export function getChartHealthWsTtlMs(): number {
  return CHART_HEALTH_WS_TTL_MS;
}

export async function publishSignalEvent(input: Omit<SignalEvent, "id">): Promise<SignalEvent> {
  const client = await getCommandClient();

  const eventWithoutId: SignalEvent = {
    ...input,
    emittedAt: input.emittedAt || new Date().toISOString(),
  };

  const streamKey = getEventsKey(eventWithoutId.stream, eventWithoutId.scope, eventWithoutId.tokenAddress);
  const eventId = await client.xAdd(
    streamKey,
    "*",
    { event: JSON.stringify(eventWithoutId) },
    {
      TRIM: {
        strategy: "MAXLEN",
        strategyModifier: "~",
        threshold: SIGNAL_STREAM_MAXLEN,
      },
    },
  );

  const event = { ...eventWithoutId, id: eventId };
  const previous = await readLatestState(event.stream, event.scope, event.tokenAddress);
  const next = mergeSignalEvent(previous, event);
  await writeLatestState(next);
  await client.publish(SIGNAL_PUBSUB_CHANNEL, JSON.stringify(event));
  return event;
}

export async function getGlobalSignalState(stream: GlobalSignalStream): Promise<SignalLatestState> {
  return (
    await readLatestState(stream, "global")
  ) ?? buildEmptyState(stream, "global");
}

export async function getChartHealthState(tokenAddress: string): Promise<SignalLatestState> {
  return (
    await readLatestState("chartHealth", "token", tokenAddress)
  ) ?? buildEmptyState("chartHealth", "token", tokenAddress);
}

export async function touchChartHealthInterest(
  tokenAddress: string,
  tokenName?: string,
  ttlMs = CHART_HEALTH_TTL_MS,
): Promise<SignalLatestState> {
  const client = await getCommandClient();
  const expiresAtMs = Date.now() + ttlMs;
  await client.zAdd(CHART_HEALTH_ACTIVE_SET_KEY, [{ score: expiresAtMs, value: tokenAddress }]);

  const previous = await getChartHealthState(tokenAddress);
  const next: SignalLatestState = {
    ...previous,
    tokenAddress,
    stream: "chartHealth",
    scope: "token",
    status: previous.updatedAt ? previous.status : "warming_up",
    updatedAt: previous.updatedAt ?? new Date().toISOString(),
    meta: {
      ...previous.meta,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ...(tokenName ? { tokenName } : {}),
    },
  };
  await writeLatestState(next);
  return next;
}

export async function touchGlobalSignalInterest(
  stream: GlobalSignalStream,
  ttlMs = GLOBAL_SIGNAL_WS_TTL_MS,
): Promise<SignalLatestState> {
  const client = await getCommandClient();
  const expiresAtMs = Date.now() + ttlMs;
  await client.zAdd(GLOBAL_SIGNAL_ACTIVE_SET_KEY, [{ score: expiresAtMs, value: stream }]);

  const previous = await getGlobalSignalState(stream);
  const next: SignalLatestState = {
    ...previous,
    stream,
    scope: "global",
    updatedAt: previous.updatedAt ?? new Date().toISOString(),
    meta: {
      ...previous.meta,
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  };
  await writeLatestState(next);
  return next;
}

export async function getActiveGlobalSignalStreams(nowMs = Date.now()): Promise<GlobalSignalStream[]> {
  const client = await getCommandClient();
  await client.zRemRangeByScore(GLOBAL_SIGNAL_ACTIVE_SET_KEY, 0, nowMs);

  const streams = await client.zRangeByScore(GLOBAL_SIGNAL_ACTIVE_SET_KEY, nowMs, "+inf");
  return streams.filter(isGlobalSignalStream);
}

export async function getActiveChartHealthTokens(nowMs = Date.now()): Promise<string[]> {
  const client = await getCommandClient();
  await client.zRemRangeByScore(CHART_HEALTH_ACTIVE_SET_KEY, 0, nowMs);
  return client.zRangeByScore(CHART_HEALTH_ACTIVE_SET_KEY, nowMs, "+inf");
}

export async function subscribeToSignalEvents(listener: SignalEventListener): Promise<() => Promise<void>> {
  signalEventListeners.add(listener);

  if (!subscriberStarted) {
    const client = await getSubscriberClient();
    await client.subscribe(SIGNAL_PUBSUB_CHANNEL, (message) => {
      try {
        const event = JSON.parse(message) as SignalEvent;
        for (const handler of signalEventListeners) {
          handler(event);
        }
      } catch (error) {
        console.error("[signals] Failed to parse pubsub event:", error);
      }
    });
    subscriberStarted = true;
  }

  return async () => {
    signalEventListeners.delete(listener);

    if (signalEventListeners.size === 0 && subscriberStarted && subscriberClient?.isOpen) {
      await subscriberClient.unsubscribe(SIGNAL_PUBSUB_CHANNEL);
      subscriberStarted = false;
    }
  };
}

export async function closeSignalBus(): Promise<void> {
  if (subscriberClient?.isOpen) {
    if (subscriberStarted) {
      await subscriberClient.unsubscribe(SIGNAL_PUBSUB_CHANNEL);
      subscriberStarted = false;
    }
    await subscriberClient.quit();
  }
  subscriberClient = null;

  if (commandClient?.isOpen) {
    await commandClient.quit();
  }
  commandClient = null;
}
