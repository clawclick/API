import WebSocket from "ws";

import {
  GLOBAL_SIGNAL_STREAMS,
  getChartHealthState,
  getGlobalSignalState,
  isSignalRedisConfigured,
  subscribeToSignalEvents,
  touchChartHealthInterest,
  type GlobalSignalStream,
  type SignalEvent,
} from "#services/signalBus";

type ClientSubscription = {
  globalStreams: Set<GlobalSignalStream>;
  allGlobals: boolean;
  chartHealthTokens: Set<string>;
  refreshTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
};

type SubscriptionMessage = {
  stream?: string;
  streams?: string[];
  tokenAddress?: string;
  tokenAddresses?: string[];
  chartHealth?: string[];
};

const clients = new Map<WebSocket, ClientSubscription>();
const CHART_HEALTH_REFRESH_INTERVAL_MS = 60 * 1000;
const CLIENT_PING_INTERVAL_MS = 25 * 1000;
let unsubscribeSignalEvents: (() => Promise<void>) | null = null;

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizeSubscriptions(raw: unknown): {
  allGlobals: boolean;
  globalStreams: GlobalSignalStream[];
  chartHealthTokens: string[];
} {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected a JSON object with streams and/or chartHealth tokens.");
  }

  const message = raw as SubscriptionMessage;
  const streamValues = [
    ...(typeof message.stream === "string" ? [message.stream] : []),
    ...(Array.isArray(message.streams) ? message.streams : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  const allGlobals = streamValues.some((value) => value === "all");
  const globalStreams = allGlobals
    ? [...GLOBAL_SIGNAL_STREAMS]
    : [...new Set(streamValues.filter((value): value is GlobalSignalStream => (
      GLOBAL_SIGNAL_STREAMS as readonly string[]
    ).includes(value)))];

  const chartHealthTokens = [
    ...(typeof message.tokenAddress === "string" ? [message.tokenAddress] : []),
    ...(Array.isArray(message.tokenAddresses) ? message.tokenAddresses : []),
    ...(Array.isArray(message.chartHealth) ? message.chartHealth : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allGlobals && globalStreams.length === 0 && chartHealthTokens.length === 0) {
    throw new Error("Subscribe to one or more global streams, chartHealth tokens, or use stream=all.");
  }

  if (chartHealthTokens.length > 100) {
    throw new Error("Subscribe to at most 100 chartHealth tokens per socket.");
  }

  return {
    allGlobals,
    globalStreams,
    chartHealthTokens: [...new Set(chartHealthTokens)],
  };
}

function matchesSubscription(subscription: ClientSubscription, event: SignalEvent): boolean {
  if (event.scope === "global") {
    return subscription.allGlobals || subscription.globalStreams.has(event.stream as GlobalSignalStream);
  }

  return !!event.tokenAddress && subscription.chartHealthTokens.has(event.tokenAddress);
}

function clearRefreshTimer(subscription: ClientSubscription): void {
  if (subscription.refreshTimer) {
    clearInterval(subscription.refreshTimer);
    subscription.refreshTimer = null;
  }
}

function clearPingTimer(subscription: ClientSubscription): void {
  if (subscription.pingTimer) {
    clearInterval(subscription.pingTimer);
    subscription.pingTimer = null;
  }
}

function cleanupClient(socket: WebSocket): void {
  const subscription = clients.get(socket);
  if (!subscription) {
    return;
  }

  clearRefreshTimer(subscription);
  clearPingTimer(subscription);
  clients.delete(socket);
}

function ensureClientPing(socket: WebSocket, subscription: ClientSubscription): void {
  clearPingTimer(subscription);
  subscription.pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, CLIENT_PING_INTERVAL_MS);
  subscription.pingTimer.unref?.();
}

async function ensureSignalSubscriber(): Promise<void> {
  if (unsubscribeSignalEvents) {
    return;
  }

  unsubscribeSignalEvents = await subscribeToSignalEvents((event) => {
    if (event.type !== "signal_detected") {
      return;
    }

    for (const [client, subscription] of clients) {
      if (!matchesSubscription(subscription, event)) {
        continue;
      }

      send(client, { type: "signalEvent", data: event });
    }
  });
}

async function refreshChartHealthTokens(tokens: Iterable<string>): Promise<void> {
  await Promise.all([...tokens].map((tokenAddress) => touchChartHealthInterest(tokenAddress)));
}

async function setClientSubscription(
  socket: WebSocket,
  parsed: ReturnType<typeof normalizeSubscriptions>,
): Promise<void> {
  const previous = clients.get(socket);
  if (previous) {
    clearRefreshTimer(previous);
  }

  const next: ClientSubscription = {
    globalStreams: new Set(parsed.globalStreams),
    allGlobals: parsed.allGlobals,
    chartHealthTokens: new Set(parsed.chartHealthTokens),
    refreshTimer: null,
    pingTimer: previous?.pingTimer ?? null,
  };
  clients.set(socket, next);
  ensureClientPing(socket, next);

  if (next.chartHealthTokens.size > 0) {
    await refreshChartHealthTokens(next.chartHealthTokens);
    next.refreshTimer = setInterval(() => {
      void refreshChartHealthTokens(next.chartHealthTokens);
    }, CHART_HEALTH_REFRESH_INTERVAL_MS);
    next.refreshTimer.unref?.();
  }

  const globalSnapshots = parsed.globalStreams.length > 0
    ? await Promise.all(parsed.globalStreams.map((stream) => getGlobalSignalState(stream)))
    : parsed.allGlobals
      ? await Promise.all(GLOBAL_SIGNAL_STREAMS.map((stream) => getGlobalSignalState(stream)))
      : [];
  const chartSnapshots = parsed.chartHealthTokens.length > 0
    ? await Promise.all(parsed.chartHealthTokens.map((tokenAddress) => getChartHealthState(tokenAddress)))
    : [];

  send(socket, {
    type: "subscribed",
    data: {
      streams: parsed.allGlobals ? ["all"] : parsed.globalStreams,
      chartHealthTokens: parsed.chartHealthTokens,
      snapshots: [...globalSnapshots, ...chartSnapshots],
    },
  });
}

export async function handleSignalStreamClient(socket: WebSocket): Promise<void> {
  if (!isSignalRedisConfigured()) {
    send(socket, { type: "error", data: "REDIS_URL is not configured for signal streaming." });
    socket.close(1011, "redis_not_configured");
    return;
  }

  await ensureSignalSubscriber();

  const initialSubscription: ClientSubscription = {
    globalStreams: new Set(),
    allGlobals: false,
    chartHealthTokens: new Set(),
    refreshTimer: null,
    pingTimer: null,
  };
  clients.set(socket, initialSubscription);
  ensureClientPing(socket, initialSubscription);

  socket.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", data: "Invalid JSON." });
      return;
    }

    let normalized: ReturnType<typeof normalizeSubscriptions>;
    try {
      normalized = normalizeSubscriptions(parsed);
    } catch (error) {
      send(socket, {
        type: "error",
        data: error instanceof Error ? error.message : "Invalid subscription payload.",
      });
      return;
    }

    void setClientSubscription(socket, normalized).catch((error) => {
      send(socket, {
        type: "error",
        data: error instanceof Error ? error.message : "Failed to subscribe to signals.",
      });
      socket.close(1011, "subscribe_failed");
    });
  });

  socket.on("close", () => {
    cleanupClient(socket);
  });

  socket.on("error", () => {
    cleanupClient(socket);
  });
}
