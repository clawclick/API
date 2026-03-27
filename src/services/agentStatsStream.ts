import WebSocket from "ws";

const ROLLING_WINDOW_MINUTES = 60;
const BUCKET_DURATION_MS = 60 * 1000;
const BROADCAST_INTERVAL_MS = 1000;
const AGENT_WINDOW_TTL_MS = 2 * 60 * 60 * 1000;
const CLIENT_PING_INTERVAL_MS = 25 * 1000;

type RollingBucket = {
  minuteStartMs: number;
  requestCount: number;
  totalLatencyMs: number;
};

type AgentWindow = {
  agentId: string;
  lastSeenAt: number;
  totalRequests: number;
  totalLatencyMs: number;
  buckets: RollingBucket[];
};

type AgentStatsSnapshot = {
  agentId: string;
  window: "rolling_60m";
  requestsLastHour: number;
  avgResponseMsLastHour: number;
  updatedAt: string;
};

type AgentStatsSubscriptionMessage = {
  agentId?: string;
  agentIds?: string[];
};

const agentWindows = new Map<string, AgentWindow>();
const subscribersByAgentId = new Map<string, Set<WebSocket>>();
const clientSubscriptions = new Map<WebSocket, Set<string>>();
const clientPingTimers = new Map<WebSocket, NodeJS.Timeout>();
const dirtyAgentIds = new Set<string>();

let broadcastTimer: NodeJS.Timeout | null = null;

function getMinuteStartMs(nowMs: number): number {
  return Math.floor(nowMs / BUCKET_DURATION_MS) * BUCKET_DURATION_MS;
}

function createAgentWindow(agentId: string, nowMs: number): AgentWindow {
  return {
    agentId,
    lastSeenAt: nowMs,
    totalRequests: 0,
    totalLatencyMs: 0,
    buckets: Array.from({ length: ROLLING_WINDOW_MINUTES }, () => ({
      minuteStartMs: 0,
      requestCount: 0,
      totalLatencyMs: 0,
    })),
  };
}

function trimExpiredBuckets(window: AgentWindow, nowMs: number): void {
  const cutoffMs = nowMs - (ROLLING_WINDOW_MINUTES * BUCKET_DURATION_MS);
  for (const bucket of window.buckets) {
    if (bucket.minuteStartMs > 0 && bucket.minuteStartMs <= cutoffMs) {
      window.totalRequests -= bucket.requestCount;
      window.totalLatencyMs -= bucket.totalLatencyMs;
      bucket.minuteStartMs = 0;
      bucket.requestCount = 0;
      bucket.totalLatencyMs = 0;
    }
  }

  if (window.totalRequests < 0) {
    window.totalRequests = 0;
  }
  if (window.totalLatencyMs < 0) {
    window.totalLatencyMs = 0;
  }
}

function getAgentSnapshot(agentId: string, nowMs = Date.now()): AgentStatsSnapshot {
  const window = agentWindows.get(agentId);
  if (!window) {
    return {
      agentId,
      window: "rolling_60m",
      requestsLastHour: 0,
      avgResponseMsLastHour: 0,
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  trimExpiredBuckets(window, nowMs);
  const requestsLastHour = window.totalRequests;
  return {
    agentId,
    window: "rolling_60m",
    requestsLastHour,
    avgResponseMsLastHour: requestsLastHour > 0
      ? Math.round((window.totalLatencyMs / requestsLastHour) * 100) / 100
      : 0,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

function scheduleBroadcast(): void {
  if (broadcastTimer) {
    return;
  }

  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    flushDirtyAgents();
  }, BROADCAST_INTERVAL_MS);
  broadcastTimer.unref?.();
}

function cleanupStaleWindows(nowMs: number): void {
  for (const [agentId, window] of agentWindows.entries()) {
    const hasSubscribers = (subscribersByAgentId.get(agentId)?.size ?? 0) > 0;
    if (!hasSubscribers && nowMs - window.lastSeenAt > AGENT_WINDOW_TTL_MS) {
      agentWindows.delete(agentId);
    }
  }
}

function flushDirtyAgents(): void {
  const nowMs = Date.now();
  cleanupStaleWindows(nowMs);

  for (const agentId of dirtyAgentIds) {
    const subscribers = subscribersByAgentId.get(agentId);
    if (!subscribers || subscribers.size === 0) {
      continue;
    }

    const payload = JSON.stringify({ type: "agentStats", data: getAgentSnapshot(agentId, nowMs) });
    for (const client of subscribers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  dirtyAgentIds.clear();
}

function normalizeSubscriptionMessage(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected an object with agentId or agentIds.");
  }

  const message = raw as AgentStatsSubscriptionMessage;
  const values = [
    ...(typeof message.agentId === "string" ? [message.agentId] : []),
    ...(Array.isArray(message.agentIds) ? message.agentIds : []),
  ];

  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error("Provide agentId or agentIds.");
  }
  if (normalized.length > 100) {
    throw new Error("Subscribe to at most 100 agentIds per socket.");
  }
  return normalized;
}

function setClientSubscriptions(client: WebSocket, agentIds: string[]): void {
  const previous = clientSubscriptions.get(client);
  if (previous) {
    for (const agentId of previous) {
      const subscribers = subscribersByAgentId.get(agentId);
      if (!subscribers) {
        continue;
      }
      subscribers.delete(client);
      if (subscribers.size === 0) {
        subscribersByAgentId.delete(agentId);
      }
    }
  }

  const next = new Set(agentIds);
  clientSubscriptions.set(client, next);

  for (const agentId of next) {
    const subscribers = subscribersByAgentId.get(agentId) ?? new Set<WebSocket>();
    subscribers.add(client);
    subscribersByAgentId.set(agentId, subscribers);
  }
}

function cleanupClient(client: WebSocket): void {
  const pingTimer = clientPingTimers.get(client);
  if (pingTimer) {
    clearInterval(pingTimer);
    clientPingTimers.delete(client);
  }

  const subscriptions = clientSubscriptions.get(client);
  if (!subscriptions) {
    return;
  }

  for (const agentId of subscriptions) {
    const subscribers = subscribersByAgentId.get(agentId);
    if (!subscribers) {
      continue;
    }
    subscribers.delete(client);
    if (subscribers.size === 0) {
      subscribersByAgentId.delete(agentId);
    }
  }

  clientSubscriptions.delete(client);
}

function ensureClientPing(client: WebSocket): void {
  const existing = clientPingTimers.get(client);
  if (existing) {
    clearInterval(existing);
  }

  const timer = setInterval(() => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  }, CLIENT_PING_INTERVAL_MS);
  timer.unref?.();
  clientPingTimers.set(client, timer);
}

export function recordLiveAgentRequest(input: { agentId?: string | null; durationMs?: number }): void {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return;
  }

  const nowMs = Date.now();
  const minuteStartMs = getMinuteStartMs(nowMs);
  const window = agentWindows.get(agentId) ?? createAgentWindow(agentId, nowMs);
  const bucketIndex = Math.floor(minuteStartMs / BUCKET_DURATION_MS) % ROLLING_WINDOW_MINUTES;
  const bucket = window.buckets[bucketIndex];

  if (bucket.minuteStartMs !== minuteStartMs) {
    window.totalRequests -= bucket.requestCount;
    window.totalLatencyMs -= bucket.totalLatencyMs;
    bucket.minuteStartMs = minuteStartMs;
    bucket.requestCount = 0;
    bucket.totalLatencyMs = 0;
  }

  const durationMs = Number.isFinite(input.durationMs) && (input.durationMs ?? 0) > 0 ? input.durationMs ?? 0 : 0;
  bucket.requestCount += 1;
  bucket.totalLatencyMs += durationMs;
  window.totalRequests += 1;
  window.totalLatencyMs += durationMs;
  window.lastSeenAt = nowMs;
  agentWindows.set(agentId, window);

  dirtyAgentIds.add(agentId);
  scheduleBroadcast();
}

export function handleAgentStatsClient(clientWs: WebSocket): void {
  ensureClientPing(clientWs);

  clientWs.send(JSON.stringify({
    type: "info",
    data: "Connected. Send JSON like {\"agentId\":\"scanner-alpha\"} or {\"agentIds\":[\"scanner-alpha\",\"scanner-beta\"]} to receive rolling 60-minute request counts and average response times.",
  }));

  clientWs.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      clientWs.send(JSON.stringify({ type: "error", data: "Invalid JSON." }));
      return;
    }

    let agentIds: string[];
    try {
      agentIds = normalizeSubscriptionMessage(parsed);
    } catch (error) {
      clientWs.send(JSON.stringify({
        type: "error",
        data: error instanceof Error ? error.message : "Invalid subscription payload.",
      }));
      return;
    }

    setClientSubscriptions(clientWs, agentIds);
    clientWs.send(JSON.stringify({
      type: "subscribed",
      data: {
        agentIds,
        snapshots: agentIds.map((agentId) => getAgentSnapshot(agentId)),
      },
    }));
  });

  clientWs.on("close", () => {
    cleanupClient(clientWs);
  });

  clientWs.on("error", () => {
    cleanupClient(clientWs);
  });
}
