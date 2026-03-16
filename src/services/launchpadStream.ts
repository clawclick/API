/**
 * Codex launchpad event streaming via WebSocket.
 *
 * Architecture:
 *   Client ──ws──▶  /ws/launchpadEvents  ──▶  Single upstream to wss://graph.codex.io/graphql
 *
 * Clients connect and send a JSON message with their filter preferences.
 * We maintain one shared upstream subscription per unique filter set and fan out
 * events to all clients that match.
 */

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import type { LaunchpadEvent } from "#types/api";
import WebSocket from "ws";

/* ── Config ───────────────────────────────────────────────── */

const CODEX_WS_URL = "wss://graph.codex.io/graphql";

export function isCodexConfigured(): boolean {
  return isConfigured(getOptionalEnv("CODEX_API_KEY"));
}

/* ── Types ────────────────────────────────────────────────── */

export type ClientFilter = {
  protocol?: string;
  protocols?: string[];
  networkId?: number;
  launchpadName?: string;
  launchpadNames?: string[];
  eventType?: string;
};

type UpstreamSub = {
  key: string;
  ws: WebSocket | null;
  clients: Set<WebSocket>;
  filter: ClientFilter;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

/* ── State ────────────────────────────────────────────────── */

const upstreams = new Map<string, UpstreamSub>();

/* ── GraphQL-over-WebSocket protocol (graphql-ws) ─────────── */

const GQL_CONNECTION_INIT = "connection_init";
const GQL_CONNECTION_ACK = "connection_ack";
const GQL_SUBSCRIBE = "subscribe";
const GQL_NEXT = "next";
const GQL_ERROR = "error";
const GQL_COMPLETE = "complete";

function buildSubscriptionQuery(filter: ClientFilter): string {
  const inputFields: string[] = [];
  if (filter.protocol) inputFields.push(`protocol: ${filter.protocol}`);
  if (filter.protocols?.length) inputFields.push(`protocols: [${filter.protocols.join(", ")}]`);
  if (filter.networkId != null) inputFields.push(`networkId: ${filter.networkId}`);
  if (filter.launchpadName) inputFields.push(`launchpadName: "${filter.launchpadName}"`);
  if (filter.launchpadNames?.length) inputFields.push(`launchpadNames: [${filter.launchpadNames.map((n) => `"${n}"`).join(", ")}]`);
  if (filter.eventType) inputFields.push(`eventType: ${filter.eventType}`);

  const inputBlock = inputFields.length > 0 ? `(input: { ${inputFields.join(", ")} })` : "";

  return `subscription {
  onLaunchpadTokenEventBatch${inputBlock} {
    address
    networkId
    protocol
    eventType
    launchpadName
    marketCap
    price
    liquidity
    holders
    volume1
    transactions1
    buyCount1
    sellCount1
    sniperCount
    sniperHeldPercentage
    bundlerCount
    bundlerHeldPercentage
    insiderCount
    insiderHeldPercentage
    devHeldPercentage
    top10HoldersPercent
    token {
      name
      symbol
      info {
        imageThumbUrl
      }
    }
  }
}`;
}

function filterKey(f: ClientFilter): string {
  return JSON.stringify({
    protocol: f.protocol ?? null,
    protocols: f.protocols ?? null,
    networkId: f.networkId ?? null,
    launchpadName: f.launchpadName ?? null,
    launchpadNames: f.launchpadNames ?? null,
    eventType: f.eventType ?? null,
  });
}

function mapEvent(raw: Record<string, unknown>): LaunchpadEvent {
  const token = raw.token as Record<string, unknown> | undefined;
  const info = token?.info as Record<string, unknown> | undefined;
  return {
    address: (raw.address as string) ?? null,
    networkId: (raw.networkId as number) ?? null,
    protocol: (raw.protocol as string) ?? null,
    eventType: (raw.eventType as string) ?? null,
    launchpadName: (raw.launchpadName as string) ?? null,
    marketCap: (raw.marketCap as string) ?? null,
    price: (raw.price as number) ?? null,
    liquidity: (raw.liquidity as string) ?? null,
    holders: (raw.holders as number) ?? null,
    volume1: (raw.volume1 as number) ?? null,
    transactions1: (raw.transactions1 as number) ?? null,
    buyCount1: (raw.buyCount1 as number) ?? null,
    sellCount1: (raw.sellCount1 as number) ?? null,
    sniperCount: (raw.sniperCount as number) ?? null,
    sniperHeldPercentage: (raw.sniperHeldPercentage as number) ?? null,
    bundlerCount: (raw.bundlerCount as number) ?? null,
    bundlerHeldPercentage: (raw.bundlerHeldPercentage as number) ?? null,
    insiderCount: (raw.insiderCount as number) ?? null,
    insiderHeldPercentage: (raw.insiderHeldPercentage as number) ?? null,
    devHeldPercentage: (raw.devHeldPercentage as number) ?? null,
    top10HoldersPercent: (raw.top10HoldersPercent as number) ?? null,
    tokenName: (token?.name as string) ?? null,
    tokenSymbol: (token?.symbol as string) ?? null,
    tokenImage: (info?.imageThumbUrl as string) ?? null,
  };
}

/* ── Upstream WebSocket management ────────────────────────── */

function connectUpstream(sub: UpstreamSub): void {
  if (sub.ws) {
    try { sub.ws.close(); } catch { /* ignore */ }
  }

  const apiKey = getRequiredEnv("CODEX_API_KEY");
  const ws = new WebSocket(CODEX_WS_URL, "graphql-transport-ws");
  sub.ws = ws;

  ws.on("open", () => {
    // Send connection_init with auth
    ws.send(JSON.stringify({ type: GQL_CONNECTION_INIT, payload: { Authorization: apiKey } }));
  });

  ws.on("message", (data) => {
    let msg: { type?: string; id?: string; payload?: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === GQL_CONNECTION_ACK) {
      // Authenticated — send subscription
      ws.send(JSON.stringify({
        type: GQL_SUBSCRIBE,
        id: "1",
        payload: { query: buildSubscriptionQuery(sub.filter) },
      }));
      return;
    }

    if (msg.type === GQL_NEXT && msg.payload) {
      const payload = msg.payload as { data?: { onLaunchpadTokenEventBatch?: Record<string, unknown>[] } };
      const events = payload.data?.onLaunchpadTokenEventBatch;
      if (events && events.length > 0) {
        const mapped = events.map(mapEvent);
        const message = JSON.stringify({ type: "events", data: mapped });
        for (const client of sub.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      }
      return;
    }

    if (msg.type === GQL_ERROR) {
      const errMsg = JSON.stringify({ type: "error", data: msg.payload });
      for (const client of sub.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(errMsg);
        }
      }
      return;
    }

    if (msg.type === GQL_COMPLETE) {
      // Subscription ended, try to reconnect
      scheduleReconnect(sub);
    }
  });

  ws.on("close", () => {
    sub.ws = null;
    if (sub.clients.size > 0) {
      scheduleReconnect(sub);
    }
  });

  ws.on("error", () => {
    try { ws.close(); } catch { /* ignore */ }
  });
}

function scheduleReconnect(sub: UpstreamSub): void {
  if (sub.reconnectTimer) return;
  if (sub.clients.size === 0) return;

  sub.reconnectTimer = setTimeout(() => {
    sub.reconnectTimer = null;
    if (sub.clients.size > 0) {
      connectUpstream(sub);
    }
  }, 3000);
}

function cleanupUpstream(sub: UpstreamSub): void {
  if (sub.clients.size > 0) return;

  if (sub.reconnectTimer) {
    clearTimeout(sub.reconnectTimer);
    sub.reconnectTimer = null;
  }
  if (sub.ws) {
    try { sub.ws.close(); } catch { /* ignore */ }
    sub.ws = null;
  }
  upstreams.delete(sub.key);
}

/* ── Public API ───────────────────────────────────────────── */

export function handleClient(clientWs: WebSocket): void {
  if (!isCodexConfigured()) {
    clientWs.send(JSON.stringify({
      type: "error",
      data: "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io",
    }));
    clientWs.close();
    return;
  }

  // Send welcome message telling client to send their filters
  clientWs.send(JSON.stringify({
    type: "info",
    data: "Connected. Send a JSON message with your filter to start streaming. Example: {\"protocol\":\"Pump\",\"eventType\":\"Created\"}. Available filters: protocol, protocols, networkId, launchpadName, launchpadNames, eventType.",
  }));

  let subscribed = false;
  let currentSub: UpstreamSub | null = null;

  clientWs.on("message", (data) => {
    if (subscribed) return; // Only accept first filter message

    let filter: ClientFilter;
    try {
      filter = JSON.parse(data.toString());
      if (typeof filter !== "object" || filter === null) throw new Error("not object");
    } catch {
      clientWs.send(JSON.stringify({
        type: "error",
        data: "Invalid JSON. Send filter object, e.g. {\"protocol\":\"Pump\",\"eventType\":\"Created\"}",
      }));
      return;
    }

    subscribed = true;
    const key = filterKey(filter);

    let sub = upstreams.get(key);
    if (!sub) {
      sub = { key, ws: null, clients: new Set(), filter, reconnectTimer: null };
      upstreams.set(key, sub);
      connectUpstream(sub);
    }

    sub.clients.add(clientWs);
    currentSub = sub;

    clientWs.send(JSON.stringify({
      type: "subscribed",
      data: { filter, message: "Streaming launchpad events with your filter." },
    }));
  });

  clientWs.on("close", () => {
    if (currentSub) {
      currentSub.clients.delete(clientWs);
      cleanupUpstream(currentSub);
    }
  });

  clientWs.on("error", () => {
    if (currentSub) {
      currentSub.clients.delete(clientWs);
      cleanupUpstream(currentSub);
    }
  });
}
