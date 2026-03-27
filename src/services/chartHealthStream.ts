import WebSocket from "ws";

import {
  getChartHealthState,
  getChartHealthWsTtlMs,
  isSignalRedisConfigured,
  subscribeToSignalEvents,
  touchChartHealthInterest,
  type SignalEvent,
} from "#services/signalBus";

type ClientSubscription = {
  tokenAddresses: Set<string>;
  refreshTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
};

type SubscriptionMessage = {
  tokenAddress?: string;
  tokenAddresses?: string[];
  tokens?: string | string[];
};

const clients = new Map<WebSocket, ClientSubscription>();
const CLIENT_PING_INTERVAL_MS = 25 * 1000;
const CHART_HEALTH_TOUCH_INTERVAL_MS = Math.max(5_000, Math.floor(getChartHealthWsTtlMs() / 2));
let unsubscribeSignalEvents: (() => Promise<void>) | null = null;

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function normalizeSubscriptions(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected a JSON object with tokenAddress or tokenAddresses.");
  }

  const message = raw as SubscriptionMessage;
  const tokenAddresses = [
    ...(typeof message.tokenAddress === "string" ? [message.tokenAddress] : []),
    ...(Array.isArray(message.tokenAddresses) ? message.tokenAddresses : []),
    ...(typeof message.tokens === "string" ? [message.tokens] : []),
    ...(Array.isArray(message.tokens) ? message.tokens : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokenAddresses.length === 0) {
    throw new Error("Subscribe with tokenAddress or tokenAddresses.");
  }

  if (tokenAddresses.length > 100) {
    throw new Error("Subscribe to at most 100 chartHealth tokens per socket.");
  }

  return [...new Set(tokenAddresses)];
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

async function ensureChartHealthSubscriber(): Promise<void> {
  if (unsubscribeSignalEvents) {
    return;
  }

  unsubscribeSignalEvents = await subscribeToSignalEvents((event: SignalEvent) => {
    if (event.stream !== "chartHealth" || !event.tokenAddress) {
      return;
    }

    for (const [client, subscription] of clients) {
      if (!subscription.tokenAddresses.has(event.tokenAddress)) {
        continue;
      }

      send(client, { type: "chartHealthEvent", data: event });
    }
  });
}

async function refreshChartHealthTokens(tokens: Iterable<string>): Promise<void> {
  await Promise.all(
    [...tokens].map((tokenAddress) => touchChartHealthInterest(tokenAddress, undefined, getChartHealthWsTtlMs())),
  );
}

async function setClientSubscription(socket: WebSocket, tokenAddresses: string[]): Promise<void> {
  const previous = clients.get(socket);
  if (previous) {
    clearRefreshTimer(previous);
  }

  const next: ClientSubscription = {
    tokenAddresses: new Set(tokenAddresses),
    refreshTimer: null,
    pingTimer: previous?.pingTimer ?? null,
  };
  clients.set(socket, next);
  ensureClientPing(socket, next);

  await refreshChartHealthTokens(next.tokenAddresses);
  next.refreshTimer = setInterval(() => {
    void refreshChartHealthTokens(next.tokenAddresses);
  }, CHART_HEALTH_TOUCH_INTERVAL_MS);
  next.refreshTimer.unref?.();

  const snapshots = await Promise.all(tokenAddresses.map((tokenAddress) => getChartHealthState(tokenAddress)));

  send(socket, {
    type: "subscribed",
    data: {
      tokenAddresses,
      snapshots,
    },
  });
}

export async function handleChartHealthStreamClient(socket: WebSocket): Promise<void> {
  if (!isSignalRedisConfigured()) {
    send(socket, { type: "error", data: "REDIS_URL is not configured for chartHealth streaming." });
    socket.close(1011, "redis_not_configured");
    return;
  }

  await ensureChartHealthSubscriber();

  const initialSubscription: ClientSubscription = {
    tokenAddresses: new Set(),
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

    let tokenAddresses: string[];
    try {
      tokenAddresses = normalizeSubscriptions(parsed);
    } catch (error) {
      send(socket, {
        type: "error",
        data: error instanceof Error ? error.message : "Invalid chartHealth subscription payload.",
      });
      return;
    }

    void setClientSubscription(socket, tokenAddresses).catch((error) => {
      send(socket, {
        type: "error",
        data: error instanceof Error ? error.message : "Failed to subscribe to chartHealth.",
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
