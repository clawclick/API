import WebSocket from "ws";

import {
  GLOBAL_SIGNAL_STREAMS,
  getGlobalSignalState,
  getGlobalSignalWsTtlMs,
  isSignalRedisConfigured,
  subscribeToSignalEvents,
  touchGlobalSignalInterest,
  type GlobalSignalStream,
  type SignalEvent,
} from "#services/signalBus";

type ClientSubscription = {
  globalStreams: Set<GlobalSignalStream>;
  allGlobals: boolean;
  refreshTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
};

type SubscriptionMessage = {
  streams?: string | string[];
};

const clients = new Map<WebSocket, ClientSubscription>();
const CLIENT_PING_INTERVAL_MS = 25 * 1000;
const GLOBAL_SIGNAL_TOUCH_INTERVAL_MS = Math.max(5_000, Math.floor(getGlobalSignalWsTtlMs() / 2));
let unsubscribeSignalEvents: (() => Promise<void>) | null = null;

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizeSubscriptions(raw: unknown): {
  allGlobals: boolean;
  globalStreams: GlobalSignalStream[];
} {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected a JSON object with streams.");
  }

  const message = raw as SubscriptionMessage;
  const streamValues = [
    ...(typeof message.streams === "string" ? [message.streams] : []),
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

  if (!allGlobals && globalStreams.length === 0) {
    return {
      allGlobals: true,
      globalStreams: [...GLOBAL_SIGNAL_STREAMS],
    };
  }

  return {
    allGlobals,
    globalStreams,
  };
}

function matchesSubscription(subscription: ClientSubscription, event: SignalEvent): boolean {
  return event.scope === "global" && (
    subscription.allGlobals || subscription.globalStreams.has(event.stream as GlobalSignalStream)
  );
}

function clearPingTimer(subscription: ClientSubscription): void {
  if (subscription.pingTimer) {
    clearInterval(subscription.pingTimer);
    subscription.pingTimer = null;
  }
}

function clearRefreshTimer(subscription: ClientSubscription): void {
  if (subscription.refreshTimer) {
    clearInterval(subscription.refreshTimer);
    subscription.refreshTimer = null;
  }
}

function hasActiveSubscriptions(): boolean {
  for (const subscription of clients.values()) {
    if (subscription.allGlobals || subscription.globalStreams.size > 0) {
      return true;
    }
  }

  return false;
}

async function cleanupClient(socket: WebSocket): Promise<void> {
  const subscription = clients.get(socket);
  if (!subscription) {
    return;
  }

  clearRefreshTimer(subscription);
  clearPingTimer(subscription);
  clients.delete(socket);
  await maybeStopSignalSubscriber();
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

async function maybeStopSignalSubscriber(): Promise<void> {
  if (!unsubscribeSignalEvents || hasActiveSubscriptions()) {
    return;
  }

  const unsubscribe = unsubscribeSignalEvents;
  unsubscribeSignalEvents = null;
  await unsubscribe();
}

async function refreshGlobalSignalStreams(streams: Iterable<GlobalSignalStream>): Promise<void> {
  await Promise.all(
    [...streams].map((stream) => touchGlobalSignalInterest(stream, getGlobalSignalWsTtlMs())),
  );
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
    refreshTimer: null,
    pingTimer: previous?.pingTimer ?? null,
  };
  clients.set(socket, next);
  ensureClientPing(socket, next);

  await ensureSignalSubscriber();
  await refreshGlobalSignalStreams(next.globalStreams);
  next.refreshTimer = setInterval(() => {
    void refreshGlobalSignalStreams(next.globalStreams);
  }, GLOBAL_SIGNAL_TOUCH_INTERVAL_MS);
  next.refreshTimer.unref?.();

  const globalSnapshots = parsed.globalStreams.length > 0
    ? await Promise.all(parsed.globalStreams.map((stream) => getGlobalSignalState(stream)))
    : parsed.allGlobals
      ? await Promise.all(GLOBAL_SIGNAL_STREAMS.map((stream) => getGlobalSignalState(stream)))
      : [];

  send(socket, {
    type: "subscribed",
    data: {
      streams: parsed.allGlobals ? ["all"] : parsed.globalStreams,
      snapshots: globalSnapshots,
    },
  });
}

export async function handleSignalStreamClient(socket: WebSocket): Promise<void> {
  if (!isSignalRedisConfigured()) {
    send(socket, { type: "error", data: "REDIS_URL is not configured for signal streaming." });
    socket.close(1011, "redis_not_configured");
    return;
  }

  const initialSubscription: ClientSubscription = {
    globalStreams: new Set(),
    allGlobals: false,
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
    void cleanupClient(socket);
  });

  socket.on("error", () => {
    void cleanupClient(socket);
  });
}
