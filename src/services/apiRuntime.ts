import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { isNativeIn } from "#lib/evm";
import { getCoinsMarkets } from "#providers/market/coinGecko";
import { normalizeChain, type SupportedChain } from "#providers/shared/chains";
import type {
  ApiKeyDeleteResponse,
  ApiKeyGenerateResponse,
  ApiAllTimeAgentItem,
  ApiAllTimeUserItem,
  ApiAllTimeUsers,
  ApiRequestsResponse,
  ApiRuntimeStatsResponse,
  ApiStatsAgentAnalyticsItem,
  ApiStatsAgentsResponse,
  ApiStatsSingleUserSummary,
  ApiStatsUserResponse,
  ApiVolumeResponse,
  ApiAllTimeVolume,
  ApiStatsAgentItem,
  ApiStatsLatency,
  ApiStatsRequestBreakdown,
  ApiStatsRequestProviderBreakdown,
  ApiStatsOverviewResponse,
  ApiStatsRequests,
  ApiStatsRequestsResponse,
  ApiStatsUsers,
  ApiStatsUsersResponse,
  ApiStatsUserItem,
  ApiStatsVolume,
  ApiStatsVolumeResponse,
} from "#types/api";

type TrackedVolumeChain = "eth" | "base" | "bsc" | "sol";
type NativePriceKey = "eth" | "bnb" | "sol";

type VolumeCounterSnapshot = {
  buyRaw: string;
  sellRaw: string;
  buyCount: number;
  sellCount: number;
};

type VolumeCounter = {
  buyRaw: bigint;
  sellRaw: bigint;
  buyCount: number;
  sellCount: number;
};

type NativePriceSnapshot = {
  eth: number | null;
  bnb: number | null;
  sol: number | null;
};

const TRACKED_VOLUME_CHAINS: TrackedVolumeChain[] = ["eth", "base", "bsc", "sol"];
const SOL_NATIVE_MINT = "so11111111111111111111111111111111111111112";
const NATIVE_PRICE_CACHE_TTL_MS = 30 * 60 * 1000;

type StoredApiKey = {
  id: string;
  label: string | null;
  prefix: string;
  keyHash: string;
  agentId: string | null;
  agentWalletEvm: string | null;
  agentWalletSol: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedDay: string | null;
  totalRequests: number;
};

type DailyMetrics = {
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  totalRequests: number;
  requestsByEndpoint: Record<string, number>;
  statusCodes: Record<string, number>;
  totalLatencyMs: number;
  latencyBuckets: Record<string, number>;
  volumes: Record<TrackedVolumeChain, VolumeCounterSnapshot>;
};

type RequestMetricsContext = {
  endpoint: string;
  providerMetrics: RequestProviderMetric[];
};

type RequestProviderMetric = {
  provider: string;
  successful: boolean;
  error?: unknown;
  durationMs?: number;
};

type RequestOutcomeCounts = {
  successful: number;
  failed: number;
  clientErrors: number;
  serverErrors: number;
};

type AggregateCounter = {
  requestCount: number;
  successfulRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
  totalLatencyMs: number;
  latencyBuckets: Record<string, number>;
};

type BufferedProviderAggregate = {
  endpoint: string;
  provider: string;
  stats: AggregateCounter;
};

type BufferedKeyAggregate = AggregateCounter & {
  lastUsedAt: string;
};

type BufferedDayAnalytics = {
  dayKey: string;
  startedAt: string;
  resetsAt: string;
  totalRequests: number;
  statusCodes: Record<string, number>;
  totalLatencyMs: number;
  latencyBuckets: Record<string, number>;
  endpointStats: Map<string, AggregateCounter>;
  keyStats: Map<string, BufferedKeyAggregate>;
  providerStats: Map<string, BufferedProviderAggregate>;
  volumes: Record<TrackedVolumeChain, VolumeCounter>;
};

type EndpointStatsRow = {
  endpoint: string;
  request_count: string;
  successful_requests: string;
  client_error_requests: string;
  server_error_requests: string;
  total_latency_ms: string;
  latency_buckets: Record<string, number> | string | null;
};

type ProviderStatsRow = {
  provider: string;
  endpoint: string;
  request_count: string;
  successful_requests: string;
  client_error_requests: string;
  server_error_requests: string;
  total_latency_ms: string;
  latency_buckets: Record<string, number> | string | null;
};

type DailyLatencyRow = {
  total_latency_ms: string;
  latency_buckets: Record<string, number> | string | null;
};

type DailyKeyStatsRow = {
  request_count: string | null;
  successful_requests: string | null;
  client_error_requests: string | null;
  server_error_requests: string | null;
  total_latency_ms: string | null;
  latency_buckets: Record<string, number> | string | null;
};

type ResolvedApiKey = {
  id: string;
  prefix: string;
  agentId: string | null;
};

type ApiKeyAuthCacheEntry = {
  resolved: ResolvedApiKey | null;
  expiresAt: number;
};

type StatsUserFilter = {
  agentId?: string | null;
  agentWalletEvm?: string | null;
};

export class AccessError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AccessError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/providers"]);
const ADMIN_PATHS = new Set([
  "/admin",
  "/admin/apiKeys",
  "/admin/apiKeys/generate",
  "/admin/walletChart",
  "/admin/stats",
  "/admin/stats/requests",
  "/admin/stats/users",
  "/admin/stats/user",
  "/admin/stats/agents",
  "/admin/stats/volume",
  "/ws/agentStats",
]);
const PROTECTED_PREFIXES = [
  "/signalSol",
  "/tokenPoolInfo",
  "/tokenPriceHistory",
  "/priceHistoryIndicators",
  "/rateMyEntry",
  "/detailedTokenStats",
  "/isScam",
  "/fullAudit",
  "/holderAnalysis",
  "/holders",
  "/fudSearch",
  "/marketOverview",
  "/xSearch",
  "/xCountRecent",
  "/xUserByUsername",
  "/xUserLikes",
  "/xUserFollowers",
  "/walletReview",
  "/pnl",
  "/tokenScreener",
  "/addressRelatedWallets",
  "/jupiterDcas",
  "/smartMoneyNetflow",
  "/nansenPresets",
  "/swap",
  "/swapQuote",
  "/swapDexes",
  "/approve",
  "/unwrap",
  "/trendingTokens",
  "/getTopEthTokens",
  "/getNewEthTradableTokens",
  "/newPairs",
  "/topTraders",
  "/gasFeed",
  "/tokenSearch",
  "/tokenHolders",
  "/filterTokens",
  "/volatilityScanner",
  "/ws/launchpadEvents",
  "/ws/xFilteredStream",
];
const TRACKED_METRIC_PATHS = new Set([
  "/health",
  "/providers",
  "/admin/apiKeys",
  "/admin/apiKeys/generate",
  "/admin/walletChart",
  "/admin/stats",
  "/admin/stats/requests",
  "/admin/stats/users",
  "/admin/stats/user",
  "/admin/stats/agents",
  "/admin/stats/volume",
  "/signalSol/artificialVolumeScan",
  "/signalSol/bottomsUp",
  "/signalSol/chartHealth",
  "/signalSol/momentumGains",
  "/signalSol/momentumStart",
  "/signalSol/newPump",
  "/tokenPoolInfo",
  "/tokenPriceHistory",
  "/priceHistoryIndicators",
  "/rateMyEntry",
  "/detailedTokenStats",
  "/isScam",
  "/fullAudit",
  "/holderAnalysis",
  "/holders",
  "/fudSearch",
  "/marketOverview",
  "/xSearch",
  "/xCountRecent",
  "/xUserByUsername",
  "/xUserLikes",
  "/xUserFollowers",
  "/walletReview",
  "/pnl",
  "/tokenScreener",
  "/addressRelatedWallets",
  "/jupiterDcas",
  "/smartMoneyNetflow",
  "/nansenPresets",
  "/swap",
  "/swapQuote",
  "/swapDexes",
  "/approve",
  "/unwrap",
  "/trendingTokens",
  "/getTopEthTokens",
  "/getNewEthTradableTokens",
  "/newPairs",
  "/topTraders",
  "/gasFeed",
  "/tokenSearch",
  "/filterTokens",
  "/tokenHolders",
  "/volatilityScanner",
  "/strats",
  "/strats/:id",
  "/ws/launchpadEvents",
  "/ws/agentStats",
  "/ws/xFilteredStream",
]);
const ALL_TIME_REQUESTS_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_TIME_VOLUME_CACHE_TTL_MS = 5 * 60 * 1000;
const ANALYTICS_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const ANALYTICS_FLUSH_REQUEST_THRESHOLD = 100;
const LATENCY_BUCKET_BOUNDS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000] as const;
const LATENCY_BUCKET_INF_KEY = "inf";
const API_KEY_RATE_LIMITS = {
  perSecond: 5,
  perMinute: 120,
  perHour: 3000,
} as const;
const RATE_LIMIT_SECOND_MS = 1000;
const RATE_LIMIT_MINUTE_MS = 60 * 1000;
const RATE_LIMIT_HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_STATE_TTL_MS = 2 * RATE_LIMIT_HOUR_MS;
const RATE_LIMIT_CLEANUP_THRESHOLD = 5000;
const ENDPOINT_COOLDOWN_CLEANUP_THRESHOLD = 5000;
const RATE_MY_ENTRY_COOLDOWN_MS = 30 * 60 * 1000;
const API_KEY_AUTH_CACHE_TTL_MS = 60 * 1000;
const API_KEY_AUTH_NEGATIVE_CACHE_TTL_MS = 10 * 1000;
const API_KEY_AUTH_CACHE_MAX_SIZE = 10000;

let pool: Pool | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let allTimeRequestsCache: { expiresAt: number; value: ApiStatsRequests } | null = null;
let allTimeVolumeCache: { expiresAt: number; value: ApiAllTimeVolume } | null = null;
let bufferedAnalyticsByDay = new Map<string, BufferedDayAnalytics>();
let bufferedRequestCount = 0;
let analyticsFlushPromise: Promise<void> | null = null;
let analyticsFlushTimer: NodeJS.Timeout | null = null;
let apiKeyRateLimitStates = new Map<string, {
  second: { windowStartMs: number; count: number };
  minute: { windowStartMs: number; count: number };
  hour: { windowStartMs: number; count: number };
  lastSeenAt: number;
}>();
let apiKeyEndpointCooldowns = new Map<string, number>();
let apiKeyAuthCache = new Map<string, ApiKeyAuthCacheEntry>();
const requestMetricsContext = new AsyncLocalStorage<RequestMetricsContext>();
let nativePriceCache: { expiresAt: number; value: NativePriceSnapshot } | null = null;

function createVolumeCounterSnapshot(): VolumeCounterSnapshot {
  return {
    buyRaw: "0",
    sellRaw: "0",
    buyCount: 0,
    sellCount: 0,
  };
}

function createVolumeCounter(): VolumeCounter {
  return {
    buyRaw: 0n,
    sellRaw: 0n,
    buyCount: 0,
    sellCount: 0,
  };
}

function createVolumeMap<TValue extends VolumeCounter | VolumeCounterSnapshot>(
  factory: () => TValue,
): Record<TrackedVolumeChain, TValue> {
  return {
    eth: factory(),
    base: factory(),
    bsc: factory(),
    sol: factory(),
  };
}

function getPriceKeyForChain(chain: TrackedVolumeChain): NativePriceKey {
  switch (chain) {
    case "bsc":
      return "bnb";
    case "sol":
      return "sol";
    default:
      return "eth";
  }
}

function isNativeTokenForChain(chain: TrackedVolumeChain, token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (chain === "sol") {
    return normalized === "sol" || normalized === "solana" || normalized === "native" || normalized === SOL_NATIVE_MINT;
  }
  return isNativeIn(token);
}

function formatUsd(value: number): number {
  return Number(value.toFixed(2));
}

async function getCachedNativePricesUsd(): Promise<NativePriceSnapshot> {
  const now = Date.now();
  if (nativePriceCache && nativePriceCache.expiresAt > now) {
    return nativePriceCache.value;
  }

  const rows = await getCoinsMarkets("usd", 250, 1, "ethereum,binancecoin,solana");
  const prices: NativePriceSnapshot = {
    eth: null,
    bnb: null,
    sol: null,
  };

  for (const row of rows) {
    if (row.id === "ethereum") {
      prices.eth = row.current_price ?? null;
    } else if (row.id === "binancecoin") {
      prices.bnb = row.current_price ?? null;
    } else if (row.id === "solana") {
      prices.sol = row.current_price ?? null;
    }
  }

  nativePriceCache = {
    expiresAt: now + NATIVE_PRICE_CACHE_TTL_MS,
    value: prices,
  };
  return prices;
}

function getWindowStartMs(nowMs: number, durationMs: number): number {
  return Math.floor(nowMs / durationMs) * durationMs;
}

function refreshRateLimitBucket(bucket: { windowStartMs: number; count: number }, windowStartMs: number): void {
  if (bucket.windowStartMs !== windowStartMs) {
    bucket.windowStartMs = windowStartMs;
    bucket.count = 0;
  }
}

function cleanupApiKeyRateLimitStates(nowMs: number): void {
  if (apiKeyRateLimitStates.size < RATE_LIMIT_CLEANUP_THRESHOLD) {
    return;
  }

  for (const [apiKeyId, state] of apiKeyRateLimitStates.entries()) {
    if (nowMs - state.lastSeenAt > RATE_LIMIT_STATE_TTL_MS) {
      apiKeyRateLimitStates.delete(apiKeyId);
    }
  }
}

function cleanupApiKeyEndpointCooldowns(nowMs: number): void {
  if (apiKeyEndpointCooldowns.size < ENDPOINT_COOLDOWN_CLEANUP_THRESHOLD) {
    return;
  }

  for (const [key, expiresAt] of apiKeyEndpointCooldowns.entries()) {
    if (expiresAt <= nowMs) {
      apiKeyEndpointCooldowns.delete(key);
    }
  }
}

function cleanupApiKeyAuthCache(nowMs: number): void {
  if (apiKeyAuthCache.size <= API_KEY_AUTH_CACHE_MAX_SIZE) {
    return;
  }

  for (const [keyHash, entry] of apiKeyAuthCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      apiKeyAuthCache.delete(keyHash);
    }
  }

  if (apiKeyAuthCache.size <= API_KEY_AUTH_CACHE_MAX_SIZE) {
    return;
  }

  // Trim oldest inserted entries if still oversized after removing expired rows.
  const overflow = apiKeyAuthCache.size - API_KEY_AUTH_CACHE_MAX_SIZE;
  let removed = 0;
  for (const keyHash of apiKeyAuthCache.keys()) {
    apiKeyAuthCache.delete(keyHash);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function getCachedResolvedApiKey(keyHash: string, nowMs: number): ResolvedApiKey | null | undefined {
  const cached = apiKeyAuthCache.get(keyHash);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= nowMs) {
    apiKeyAuthCache.delete(keyHash);
    return undefined;
  }
  return cached.resolved;
}

function setCachedResolvedApiKey(keyHash: string, resolved: ResolvedApiKey | null, ttlMs: number, nowMs: number): void {
  cleanupApiKeyAuthCache(nowMs);
  apiKeyAuthCache.set(keyHash, {
    resolved,
    expiresAt: nowMs + ttlMs,
  });
}

function dropAuthCacheByApiKeyId(apiKeyId: string): void {
  for (const [keyHash, entry] of apiKeyAuthCache.entries()) {
    if (entry.resolved?.id === apiKeyId) {
      apiKeyAuthCache.delete(keyHash);
    }
  }
}

export function enforceApiKeyRateLimit(apiKeyId: string, pathname?: string): void {
  const nowMs = Date.now();
  cleanupApiKeyRateLimitStates(nowMs);
  cleanupApiKeyEndpointCooldowns(nowMs);

  if (pathname === "/rateMyEntry") {
    const cooldownKey = `${apiKeyId}:${pathname}`;
    const cooldownExpiresAt = apiKeyEndpointCooldowns.get(cooldownKey);
    if (cooldownExpiresAt && cooldownExpiresAt > nowMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((cooldownExpiresAt - nowMs) / 1000));
      throw new AccessError(429, "API key cooldown exceeded for /rateMyEntry. This endpoint can only be called once every 30 minutes.", {
        retryAfterSeconds,
        scope: "endpointCooldown",
        path: pathname,
        cooldownSeconds: RATE_MY_ENTRY_COOLDOWN_MS / 1000,
      });
    }
    apiKeyEndpointCooldowns.set(cooldownKey, nowMs + RATE_MY_ENTRY_COOLDOWN_MS);
  }

  const secondWindowStartMs = getWindowStartMs(nowMs, RATE_LIMIT_SECOND_MS);
  const minuteWindowStartMs = getWindowStartMs(nowMs, RATE_LIMIT_MINUTE_MS);
  const hourWindowStartMs = getWindowStartMs(nowMs, RATE_LIMIT_HOUR_MS);

  const state = apiKeyRateLimitStates.get(apiKeyId) ?? {
    second: { windowStartMs: secondWindowStartMs, count: 0 },
    minute: { windowStartMs: minuteWindowStartMs, count: 0 },
    hour: { windowStartMs: hourWindowStartMs, count: 0 },
    lastSeenAt: nowMs,
  };

  refreshRateLimitBucket(state.second, secondWindowStartMs);
  refreshRateLimitBucket(state.minute, minuteWindowStartMs);
  refreshRateLimitBucket(state.hour, hourWindowStartMs);

  const checks = [
    {
      bucket: state.second,
      label: "second",
      limit: API_KEY_RATE_LIMITS.perSecond,
      durationMs: RATE_LIMIT_SECOND_MS,
    },
    {
      bucket: state.minute,
      label: "minute",
      limit: API_KEY_RATE_LIMITS.perMinute,
      durationMs: RATE_LIMIT_MINUTE_MS,
    },
    {
      bucket: state.hour,
      label: "hour",
      limit: API_KEY_RATE_LIMITS.perHour,
      durationMs: RATE_LIMIT_HOUR_MS,
    },
  ] as const;

  for (const check of checks) {
    if (check.bucket.count >= check.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((check.bucket.windowStartMs + check.durationMs - nowMs) / 1000));
      throw new AccessError(429, `API key rate limit exceeded: ${check.limit} requests per ${check.label}.`, {
        retryAfterSeconds,
        scope: check.label,
        limit: check.limit,
        rateLimits: API_KEY_RATE_LIMITS,
      });
    }
  }

  state.second.count += 1;
  state.minute.count += 1;
  state.hour.count += 1;
  state.lastSeenAt = nowMs;
  apiKeyRateLimitStates.set(apiKeyId, state);
}

function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getNextResetAt(date = new Date()): string {
  const resetAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return resetAt.toISOString();
}

function getDayStartAt(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function createDailyMetrics(date = new Date()): DailyMetrics {
  return {
    dayKey: getDayKey(date),
    startedAt: getDayStartAt(date),
    resetsAt: getNextResetAt(date),
    totalRequests: 0,
    requestsByEndpoint: {},
    statusCodes: {},
    totalLatencyMs: 0,
    latencyBuckets: {},
    volumes: createVolumeMap(createVolumeCounterSnapshot),
  };
}

function createAggregateCounter(): AggregateCounter {
  return {
    requestCount: 0,
    successfulRequests: 0,
    clientErrorRequests: 0,
    serverErrorRequests: 0,
    totalLatencyMs: 0,
    latencyBuckets: {},
  };
}

function createBufferedDayAnalytics(date = new Date()): BufferedDayAnalytics {
  const daily = createDailyMetrics(date);
  return {
    dayKey: daily.dayKey,
    startedAt: daily.startedAt,
    resetsAt: daily.resetsAt,
    totalRequests: 0,
    statusCodes: {},
    totalLatencyMs: 0,
    latencyBuckets: {},
    endpointStats: new Map(),
    keyStats: new Map(),
    providerStats: new Map(),
    volumes: createVolumeMap(createVolumeCounter),
  };
}

function getBufferedDayAnalytics(dayKey: string, date = new Date()): BufferedDayAnalytics {
  const existing = bufferedAnalyticsByDay.get(dayKey);
  if (existing) {
    return existing;
  }

  const created = createBufferedDayAnalytics(date);
  bufferedAnalyticsByDay.set(dayKey, created);
  return created;
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function shouldUseSsl(connectionString: string): boolean {
  const pgSslMode = getOptionalEnv("PGSSLMODE").toLowerCase();
  if (pgSslMode === "disable") {
    return false;
  }

  if (pgSslMode === "require") {
    return true;
  }

  return connectionString.toLowerCase().includes("sslmode=require") || getOptionalEnv("NODE_ENV") === "production";
}

function getPool(): Pool {
  if (!pool) {
    const connectionString = getRequiredEnv("DATABASE_URL");
    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

async function ensureTables(client: Pool | PoolClient): Promise<void> {
  await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_id TEXT`);
  await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_wallet_evm TEXT`);
  await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_wallet_sol TEXT`);
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      label TEXT,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      agent_id TEXT,
      agent_wallet_evm TEXT,
      agent_wallet_sol TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      total_requests BIGINT NOT NULL DEFAULT 0
    )
  `);

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_stats (
        day_key DATE PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        resets_at TIMESTAMPTZ NOT NULL,
        total_requests BIGINT NOT NULL DEFAULT 0,
        status_codes JSONB NOT NULL DEFAULT '{}'::jsonb,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
        eth_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        eth_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        eth_buy_count INTEGER NOT NULL DEFAULT 0,
        eth_sell_count INTEGER NOT NULL DEFAULT 0,
        base_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        base_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        base_buy_count INTEGER NOT NULL DEFAULT 0,
        base_sell_count INTEGER NOT NULL DEFAULT 0,
        bsc_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        bsc_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        bsc_buy_count INTEGER NOT NULL DEFAULT 0,
        bsc_sell_count INTEGER NOT NULL DEFAULT 0,
        sol_buy_lamports NUMERIC(78, 0) NOT NULL DEFAULT 0,
        sol_sell_lamports NUMERIC(78, 0) NOT NULL DEFAULT 0,
        sol_buy_count INTEGER NOT NULL DEFAULT 0,
        sol_sell_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS total_latency_ms BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS base_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS base_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS base_buy_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS base_sell_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS bsc_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS bsc_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS bsc_buy_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS bsc_sell_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS sol_buy_lamports NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS sol_sell_lamports NUMERIC(78, 0) NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS sol_buy_count INTEGER NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_stats ADD COLUMN IF NOT EXISTS sol_sell_count INTEGER NOT NULL DEFAULT 0`);

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_endpoint_stats (
        day_key DATE NOT NULL REFERENCES api_daily_stats(day_key) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        request_count BIGINT NOT NULL DEFAULT 0,
        successful_requests BIGINT NOT NULL DEFAULT 0,
        client_error_requests BIGINT NOT NULL DEFAULT 0,
        server_error_requests BIGINT NOT NULL DEFAULT 0,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day_key, endpoint)
      )
    `,
  );

  await client.query(`ALTER TABLE api_daily_endpoint_stats ADD COLUMN IF NOT EXISTS successful_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_endpoint_stats ADD COLUMN IF NOT EXISTS client_error_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_endpoint_stats ADD COLUMN IF NOT EXISTS server_error_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_endpoint_stats ADD COLUMN IF NOT EXISTS total_latency_ms BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_endpoint_stats ADD COLUMN IF NOT EXISTS latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_provider_stats (
        day_key DATE NOT NULL REFERENCES api_daily_stats(day_key) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        provider TEXT NOT NULL,
        request_count BIGINT NOT NULL DEFAULT 0,
        successful_requests BIGINT NOT NULL DEFAULT 0,
        client_error_requests BIGINT NOT NULL DEFAULT 0,
        server_error_requests BIGINT NOT NULL DEFAULT 0,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day_key, endpoint, provider)
      )
    `,
  );

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_key_stats (
        day_key DATE NOT NULL REFERENCES api_daily_stats(day_key) ON DELETE CASCADE,
        api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        request_count BIGINT NOT NULL DEFAULT 0,
        successful_requests BIGINT NOT NULL DEFAULT 0,
        client_error_requests BIGINT NOT NULL DEFAULT 0,
        server_error_requests BIGINT NOT NULL DEFAULT 0,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_used_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day_key, api_key_id)
      )
    `,
  );

  await client.query(`ALTER TABLE api_daily_key_stats ADD COLUMN IF NOT EXISTS successful_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_key_stats ADD COLUMN IF NOT EXISTS client_error_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_key_stats ADD COLUMN IF NOT EXISTS server_error_requests BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_key_stats ADD COLUMN IF NOT EXISTS total_latency_ms BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE api_daily_key_stats ADD COLUMN IF NOT EXISTS latency_buckets JSONB NOT NULL DEFAULT '{}'::jsonb`);
}

async function ensureDatabaseReady(): Promise<void> {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      const db = getPool();
      await ensureTables(db);
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }

  await databaseReadyPromise;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabaseReady();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureDailyStatsRow(client: PoolClient, metrics = createDailyMetrics()): Promise<void> {
  await client.query(
    `
      INSERT INTO api_daily_stats (day_key, started_at, resets_at)
      VALUES ($1::date, $2::timestamptz, $3::timestamptz)
      ON CONFLICT (day_key) DO NOTHING
    `,
    [metrics.dayKey, metrics.startedAt, metrics.resetsAt],
  );
}

function parseCount(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value ?? 0);
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDurationMs(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) {
    return 0;
  }
  return Math.max(0, Math.round(value ?? 0));
}

function parseCountMap(value: Record<string, number> | string | null | undefined): Record<string, number> {
  if (!value) {
    return {};
  }
  return typeof value === "string"
    ? JSON.parse(value) as Record<string, number>
    : value;
}

function getLatencyBucketKey(durationMs: number): string {
  for (const bound of LATENCY_BUCKET_BOUNDS_MS) {
    if (durationMs <= bound) {
      return String(bound);
    }
  }
  return LATENCY_BUCKET_INF_KEY;
}

function addLatencyToBuckets(existing: Record<string, number>, durationMs: number): Record<string, number> {
  const next = { ...existing };
  const bucketKey = getLatencyBucketKey(durationMs);
  next[bucketKey] = (next[bucketKey] ?? 0) + 1;
  return next;
}

function mergeCountMaps(target: Record<string, number>, source: Record<string, number>): Record<string, number> {
  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    merged[key] = (merged[key] ?? 0) + parseCount(value);
  }
  return merged;
}

function mergeAggregateCounters(target: AggregateCounter, source: AggregateCounter): AggregateCounter {
  target.requestCount += source.requestCount;
  target.successfulRequests += source.successfulRequests;
  target.clientErrorRequests += source.clientErrorRequests;
  target.serverErrorRequests += source.serverErrorRequests;
  target.totalLatencyMs += source.totalLatencyMs;
  target.latencyBuckets = mergeCountMaps(target.latencyBuckets, source.latencyBuckets);
  return target;
}

function applyAggregateCounter(target: AggregateCounter, input: {
  requestCount?: number;
  successfulRequests?: number;
  clientErrorRequests?: number;
  serverErrorRequests?: number;
  totalLatencyMs?: number;
  latencyBuckets?: Record<string, number>;
}): AggregateCounter {
  target.requestCount += input.requestCount ?? 0;
  target.successfulRequests += input.successfulRequests ?? 0;
  target.clientErrorRequests += input.clientErrorRequests ?? 0;
  target.serverErrorRequests += input.serverErrorRequests ?? 0;
  target.totalLatencyMs += input.totalLatencyMs ?? 0;
  if (input.latencyBuckets) {
    target.latencyBuckets = mergeCountMaps(target.latencyBuckets, input.latencyBuckets);
  }
  return target;
}

function clearAnalyticsFlushTimer(): void {
  if (analyticsFlushTimer) {
    clearTimeout(analyticsFlushTimer);
    analyticsFlushTimer = null;
  }
}

function shouldFlushBufferedAnalytics(): boolean {
  return bufferedRequestCount >= ANALYTICS_FLUSH_REQUEST_THRESHOLD;
}

function scheduleBufferedAnalyticsFlush(): void {
  if (analyticsFlushTimer || analyticsFlushPromise || bufferedAnalyticsByDay.size === 0) {
    return;
  }

  analyticsFlushTimer = setTimeout(() => {
    analyticsFlushTimer = null;
    void flushBufferedAnalytics().catch(() => {
      scheduleBufferedAnalyticsFlush();
    });
  }, ANALYTICS_FLUSH_INTERVAL_MS);

  analyticsFlushTimer.unref();
}

function mergeBufferedDayAnalytics(target: BufferedDayAnalytics, source: BufferedDayAnalytics): void {
  target.totalRequests += source.totalRequests;
  target.statusCodes = mergeCountMaps(target.statusCodes, source.statusCodes);
  target.totalLatencyMs += source.totalLatencyMs;
  target.latencyBuckets = mergeCountMaps(target.latencyBuckets, source.latencyBuckets);

  for (const [endpoint, stats] of source.endpointStats.entries()) {
    const current = target.endpointStats.get(endpoint) ?? createAggregateCounter();
    target.endpointStats.set(endpoint, mergeAggregateCounters(current, stats));
  }

  for (const [apiKeyId, stats] of source.keyStats.entries()) {
    const current = target.keyStats.get(apiKeyId) ?? { ...createAggregateCounter(), lastUsedAt: stats.lastUsedAt };
    mergeAggregateCounters(current, stats);
    if (stats.lastUsedAt > current.lastUsedAt) {
      current.lastUsedAt = stats.lastUsedAt;
    }
    target.keyStats.set(apiKeyId, current);
  }

  for (const [providerKey, providerAggregate] of source.providerStats.entries()) {
    const current = target.providerStats.get(providerKey) ?? {
      endpoint: providerAggregate.endpoint,
      provider: providerAggregate.provider,
      stats: createAggregateCounter(),
    };
    mergeAggregateCounters(current.stats, providerAggregate.stats);
    target.providerStats.set(providerKey, current);
  }

  for (const chain of TRACKED_VOLUME_CHAINS) {
    target.volumes[chain].buyRaw += source.volumes[chain].buyRaw;
    target.volumes[chain].sellRaw += source.volumes[chain].sellRaw;
    target.volumes[chain].buyCount += source.volumes[chain].buyCount;
    target.volumes[chain].sellCount += source.volumes[chain].sellCount;
  }
}

function requeueBufferedAnalytics(snapshot: Map<string, BufferedDayAnalytics>, snapshotRequestCount: number): void {
  for (const [dayKey, state] of snapshot.entries()) {
    const current = bufferedAnalyticsByDay.get(dayKey);
    if (!current) {
      bufferedAnalyticsByDay.set(dayKey, state);
      continue;
    }

    mergeBufferedDayAnalytics(current, state);
  }

  bufferedRequestCount += snapshotRequestCount;
  scheduleBufferedAnalyticsFlush();
}

function percentileFromLatencyBuckets(total: number, buckets: Record<string, number>, percentile: number): number {
  if (total <= 0) {
    return 0;
  }

  const threshold = Math.ceil(total * percentile);
  let running = 0;
  for (const bound of LATENCY_BUCKET_BOUNDS_MS) {
    running += parseCount(buckets[String(bound)]);
    if (running >= threshold) {
      return bound;
    }
  }

  if (parseCount(buckets[LATENCY_BUCKET_INF_KEY]) > 0) {
    return LATENCY_BUCKET_BOUNDS_MS[LATENCY_BUCKET_BOUNDS_MS.length - 1];
  }

  return 0;
}

function buildLatencySummary(total: number, totalLatencyMs: number, latencyBuckets: Record<string, number>): ApiStatsLatency {
  if (total <= 0) {
    return {
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  return {
    avgMs: roundPct(totalLatencyMs / total),
    p50Ms: percentileFromLatencyBuckets(total, latencyBuckets, 0.5),
    p95Ms: percentileFromLatencyBuckets(total, latencyBuckets, 0.95),
    p99Ms: percentileFromLatencyBuckets(total, latencyBuckets, 0.99),
  };
}

function buildOutcomeSummary(total: number, successful: number, clientErrors: number, serverErrors: number) {
  const failed = clientErrors + serverErrors;
  const rates = buildRateFields(total, failed, successful);
  return {
    failed,
    successRatePct: rates.successRatePct,
    failureRatePct: rates.failureRatePct,
  };
}

async function getAllTimeUsersStats(): Promise<ApiAllTimeUsers> {
  await ensureDatabaseReady();

  const [countsResult, itemsResult] = await Promise.all([
    getPool().query<{
      total_generated: string;
      total_ever_used: string;
      total_agents: string;
      total_ever_used_agents: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM api_keys) AS total_generated,
          (SELECT COUNT(*) FROM api_keys WHERE total_requests > 0) AS total_ever_used,
          (SELECT COUNT(DISTINCT agent_id) FROM api_keys WHERE agent_id IS NOT NULL) AS total_agents,
          (
            SELECT COUNT(DISTINCT agent_id)
            FROM api_keys
            WHERE agent_id IS NOT NULL
              AND total_requests > 0
          ) AS total_ever_used_agents
      `,
    ),
    getPool().query<{
      id: string;
      prefix: string;
      label: string | null;
      agent_id: string | null;
      agent_wallet_evm: string | null;
      agent_wallet_sol: string | null;
      created_at: Date | string;
      last_used_at: Date | string | null;
      total_requests: string;
      successful_requests: string | null;
      client_error_requests: string | null;
      server_error_requests: string | null;
      total_latency_ms: string | null;
      latency_buckets: Record<string, number> | string | null;
    }>(
      `
        SELECT
          k.id,
          k.prefix,
          k.label,
          k.agent_id,
          k.agent_wallet_evm,
          k.agent_wallet_sol,
          k.created_at,
          k.last_used_at,
          k.total_requests,
          stats.successful_requests,
          stats.client_error_requests,
          stats.server_error_requests,
          stats.total_latency_ms,
          stats.latency_buckets
        FROM api_keys k
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(d.successful_requests), 0)::text AS successful_requests,
            COALESCE(SUM(d.client_error_requests), 0)::text AS client_error_requests,
            COALESCE(SUM(d.server_error_requests), 0)::text AS server_error_requests,
            COALESCE(SUM(d.total_latency_ms), 0)::text AS total_latency_ms,
            COALESCE((
              SELECT jsonb_object_agg(merged.key, to_jsonb(merged.value_sum))
              FROM (
                SELECT bucket.key, SUM(bucket.value::bigint) AS value_sum
                FROM api_daily_key_stats d2
                CROSS JOIN LATERAL jsonb_each_text(COALESCE(d2.latency_buckets, '{}'::jsonb)) AS bucket(key, value)
                WHERE d2.api_key_id = k.id
                GROUP BY bucket.key
              ) merged
            ), '{}'::jsonb) AS latency_buckets
          FROM api_daily_key_stats d
          WHERE d.api_key_id = k.id
        ) stats ON true
        ORDER BY k.total_requests DESC, k.created_at DESC
      `,
    ),
  ]);

  const counts = countsResult.rows[0];
  const items: ApiAllTimeUserItem[] = itemsResult.rows.map((row) => {
    const totalRequests = parseCount(row.total_requests);
    const successful = parseCount(row.successful_requests);
    const clientErrors = parseCount(row.client_error_requests);
    const serverErrors = parseCount(row.server_error_requests);
    const outcomeSummary = buildOutcomeSummary(totalRequests, successful, clientErrors, serverErrors);

    return {
      id: row.id,
      prefix: row.prefix,
      label: row.label,
      agentId: row.agent_id,
      agentWalletEvm: row.agent_wallet_evm,
      agentWalletSol: row.agent_wallet_sol,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      totalRequests,
      successful,
      failed: outcomeSummary.failed,
      clientErrors,
      serverErrors,
      successRatePct: outcomeSummary.successRatePct,
      failureRatePct: outcomeSummary.failureRatePct,
      latency: buildLatencySummary(totalRequests, parseCount(row.total_latency_ms), parseCountMap(row.latency_buckets)),
    };
  });

  const agentGroups = new Map<string, {
    keyCount: number;
    totalRequests: number;
    successful: number;
    clientErrors: number;
    serverErrors: number;
    totalLatencyMs: number;
    latencyBuckets: Record<string, number>;
  }>();

  for (const row of itemsResult.rows) {
    if (!row.agent_id) {
      continue;
    }

    const totalRequests = parseCount(row.total_requests);
    const successful = parseCount(row.successful_requests);
    const clientErrors = parseCount(row.client_error_requests);
    const serverErrors = parseCount(row.server_error_requests);
    const latencyBuckets = parseCountMap(row.latency_buckets);

    const current = agentGroups.get(row.agent_id) ?? {
      keyCount: 0,
      totalRequests: 0,
      successful: 0,
      clientErrors: 0,
      serverErrors: 0,
      totalLatencyMs: 0,
      latencyBuckets: {},
    };

    current.keyCount += 1;
    current.totalRequests += totalRequests;
    current.successful += successful;
    current.clientErrors += clientErrors;
    current.serverErrors += serverErrors;
    current.totalLatencyMs += parseCount(row.total_latency_ms);
    current.latencyBuckets = mergeCountMaps(current.latencyBuckets, latencyBuckets);
    agentGroups.set(row.agent_id, current);
  }

  const agents: ApiAllTimeAgentItem[] = [...agentGroups.entries()]
    .map(([agentId, value]) => {
      const outcomeSummary = buildOutcomeSummary(value.totalRequests, value.successful, value.clientErrors, value.serverErrors);
      return {
        agentId,
        keyCount: value.keyCount,
        totalRequests: value.totalRequests,
        successful: value.successful,
        failed: outcomeSummary.failed,
        clientErrors: value.clientErrors,
        serverErrors: value.serverErrors,
        successRatePct: outcomeSummary.successRatePct,
        failureRatePct: outcomeSummary.failureRatePct,
        latency: buildLatencySummary(value.totalRequests, value.totalLatencyMs, value.latencyBuckets),
      };
    })
    .sort((left, right) => {
      if (right.failed !== left.failed) return right.failed - left.failed;
      if (right.totalRequests !== left.totalRequests) return right.totalRequests - left.totalRequests;
      return left.agentId.localeCompare(right.agentId);
    });

  return {
    totalGenerated: parseCount(counts?.total_generated),
    totalEverUsed: parseCount(counts?.total_ever_used),
    totalAgents: parseCount(counts?.total_agents),
    totalEverUsedAgents: parseCount(counts?.total_ever_used_agents),
    agents,
    items,
  };
}

function buildRateFields(total: number, failed: number, successful: number): { successRatePct: number; failureRatePct: number } {
  if (total <= 0) {
    return { successRatePct: 0, failureRatePct: 0 };
  }

  return {
    successRatePct: roundPct((successful / total) * 100),
    failureRatePct: roundPct((failed / total) * 100),
  };
}

function summarizeRequestOutcomes(total: number, byStatusCode: Record<string, number>): RequestOutcomeCounts {
  let successful = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let classified = 0;

  for (const [statusCode, count] of Object.entries(byStatusCode)) {
    const normalizedCount = parseCount(count);
    const numericStatusCode = Number(statusCode);

    classified += normalizedCount;
    if (Number.isFinite(numericStatusCode) && numericStatusCode >= 100 && numericStatusCode < 400) {
      successful += normalizedCount;
      continue;
    }

    if (Number.isFinite(numericStatusCode) && numericStatusCode >= 400 && numericStatusCode < 500) {
      clientErrors += normalizedCount;
      continue;
    }

    serverErrors += normalizedCount;
  }

  if (classified < total) {
    serverErrors += total - classified;
  }

  return {
    successful,
    failed: clientErrors + serverErrors,
    clientErrors,
    serverErrors,
  };
}

function buildBreakdown(key: string, counts: RequestOutcomeCounts & { total: number }): ApiStatsRequestBreakdown {
  const rates = buildRateFields(counts.total, counts.failed, counts.successful);
  return {
    key,
    total: counts.total,
    successful: counts.successful,
    failed: counts.failed,
    clientErrors: counts.clientErrors,
    serverErrors: counts.serverErrors,
    successRatePct: rates.successRatePct,
    failureRatePct: rates.failureRatePct,
    latency: buildLatencySummary(counts.total, 0, {}),
  };
}

function hydrateRequestStats(input: {
  total: number;
  byEndpoint: Record<string, number>;
  byStatusCode: Record<string, number>;
  totalLatencyMs: number;
  latencyBuckets: Record<string, number>;
  endpointBreakdown: ApiStatsRequestBreakdown[];
  providers: ApiStatsRequestProviderBreakdown[];
}): ApiStatsRequests {
  const outcomes = summarizeRequestOutcomes(input.total, input.byStatusCode);
  const rates = buildRateFields(input.total, outcomes.failed, outcomes.successful);

  return {
    total: input.total,
    successful: outcomes.successful,
    failed: outcomes.failed,
    clientErrors: outcomes.clientErrors,
    serverErrors: outcomes.serverErrors,
    successRatePct: rates.successRatePct,
    failureRatePct: rates.failureRatePct,
    latency: buildLatencySummary(input.total, input.totalLatencyMs, input.latencyBuckets),
    byEndpoint: input.byEndpoint,
    byStatusCode: input.byStatusCode,
    endpointBreakdown: input.endpointBreakdown,
    providers: input.providers,
  };
}

function normalizeEndpointBreakdownRows(rows: EndpointStatsRow[]): ApiStatsRequestBreakdown[] {
  return rows.map((row) => {
    const total = parseCount(row.request_count);
    const successful = parseCount(row.successful_requests);
    const clientErrors = parseCount(row.client_error_requests);
    const serverErrors = parseCount(row.server_error_requests);
    const breakdown = buildBreakdown(row.endpoint, {
      total,
      successful,
      failed: clientErrors + serverErrors,
      clientErrors,
      serverErrors,
    });

    return {
      ...breakdown,
      latency: buildLatencySummary(total, parseCount(row.total_latency_ms), parseCountMap(row.latency_buckets)),
    };
  });
}

function aggregateEndpointRows(rows: EndpointStatsRow[]): EndpointStatsRow[] {
  const grouped = new Map<string, { requestCount: number; successfulRequests: number; clientErrorRequests: number; serverErrorRequests: number; totalLatencyMs: number; latencyBuckets: Record<string, number> }>();

  for (const row of rows) {
    const current = grouped.get(row.endpoint) ?? {
      requestCount: 0,
      successfulRequests: 0,
      clientErrorRequests: 0,
      serverErrorRequests: 0,
      totalLatencyMs: 0,
      latencyBuckets: {},
    };

    current.requestCount += parseCount(row.request_count);
    current.successfulRequests += parseCount(row.successful_requests);
    current.clientErrorRequests += parseCount(row.client_error_requests);
    current.serverErrorRequests += parseCount(row.server_error_requests);
    current.totalLatencyMs += parseCount(row.total_latency_ms);
    current.latencyBuckets = mergeCountMaps(current.latencyBuckets, parseCountMap(row.latency_buckets));
    grouped.set(row.endpoint, current);
  }

  return [...grouped.entries()]
    .map(([endpoint, value]) => ({
      endpoint,
      request_count: String(value.requestCount),
      successful_requests: String(value.successfulRequests),
      client_error_requests: String(value.clientErrorRequests),
      server_error_requests: String(value.serverErrorRequests),
      total_latency_ms: String(value.totalLatencyMs),
      latency_buckets: value.latencyBuckets,
    }))
    .sort((left, right) => {
      const leftFailed = parseCount(left.client_error_requests) + parseCount(left.server_error_requests);
      const rightFailed = parseCount(right.client_error_requests) + parseCount(right.server_error_requests);
      if (rightFailed !== leftFailed) return rightFailed - leftFailed;
      if (parseCount(right.request_count) !== parseCount(left.request_count)) return parseCount(right.request_count) - parseCount(left.request_count);
      return left.endpoint.localeCompare(right.endpoint);
    });
}

function aggregateProviderRows(rows: ProviderStatsRow[]): ProviderStatsRow[] {
  const grouped = new Map<string, { provider: string; endpoint: string; requestCount: number; successfulRequests: number; clientErrorRequests: number; serverErrorRequests: number; totalLatencyMs: number; latencyBuckets: Record<string, number> }>();

  for (const row of rows) {
    const key = `${row.provider}\u0000${row.endpoint}`;
    const current = grouped.get(key) ?? {
      provider: row.provider,
      endpoint: row.endpoint,
      requestCount: 0,
      successfulRequests: 0,
      clientErrorRequests: 0,
      serverErrorRequests: 0,
      totalLatencyMs: 0,
      latencyBuckets: {},
    };

    current.requestCount += parseCount(row.request_count);
    current.successfulRequests += parseCount(row.successful_requests);
    current.clientErrorRequests += parseCount(row.client_error_requests);
    current.serverErrorRequests += parseCount(row.server_error_requests);
    current.totalLatencyMs += parseCount(row.total_latency_ms);
    current.latencyBuckets = mergeCountMaps(current.latencyBuckets, parseCountMap(row.latency_buckets));
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((value) => ({
      provider: value.provider,
      endpoint: value.endpoint,
      request_count: String(value.requestCount),
      successful_requests: String(value.successfulRequests),
      client_error_requests: String(value.clientErrorRequests),
      server_error_requests: String(value.serverErrorRequests),
      total_latency_ms: String(value.totalLatencyMs),
      latency_buckets: value.latencyBuckets,
    }))
    .sort((left, right) => {
      const leftFailed = parseCount(left.client_error_requests) + parseCount(left.server_error_requests);
      const rightFailed = parseCount(right.client_error_requests) + parseCount(right.server_error_requests);
      if (rightFailed !== leftFailed) return rightFailed - leftFailed;
      if (parseCount(right.request_count) !== parseCount(left.request_count)) return parseCount(right.request_count) - parseCount(left.request_count);
      const providerOrder = left.provider.localeCompare(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.endpoint.localeCompare(right.endpoint);
    });
}

function normalizeProviderBreakdownRows(rows: ProviderStatsRow[]): ApiStatsRequestProviderBreakdown[] {
  const grouped = new Map<string, { total: number; successful: number; clientErrors: number; serverErrors: number; totalLatencyMs: number; latencyBuckets: Record<string, number>; endpoints: ApiStatsRequestBreakdown[] }>();

  for (const row of rows) {
    const total = parseCount(row.request_count);
    const successful = parseCount(row.successful_requests);
    const clientErrors = parseCount(row.client_error_requests);
    const serverErrors = parseCount(row.server_error_requests);
    const endpointBreakdownBase = buildBreakdown(row.endpoint, {
      total,
      successful,
      failed: clientErrors + serverErrors,
      clientErrors,
      serverErrors,
    });
    const endpointBreakdown = {
      ...endpointBreakdownBase,
      latency: buildLatencySummary(total, parseCount(row.total_latency_ms), parseCountMap(row.latency_buckets)),
    };

    const current = grouped.get(row.provider) ?? {
      total: 0,
      successful: 0,
      clientErrors: 0,
      serverErrors: 0,
      totalLatencyMs: 0,
      latencyBuckets: {},
      endpoints: [],
    };

    current.total += total;
    current.successful += successful;
    current.clientErrors += clientErrors;
    current.serverErrors += serverErrors;
    current.totalLatencyMs += parseCount(row.total_latency_ms);
    current.latencyBuckets = mergeCountMaps(current.latencyBuckets, parseCountMap(row.latency_buckets));
    current.endpoints.push(endpointBreakdown);
    grouped.set(row.provider, current);
  }

  return [...grouped.entries()]
    .map(([provider, value]) => {
      const failed = value.clientErrors + value.serverErrors;
      const rates = buildRateFields(value.total, failed, value.successful);
      value.endpoints.sort((left, right) => {
        if (right.failed !== left.failed) return right.failed - left.failed;
        if (right.total !== left.total) return right.total - left.total;
        return left.key.localeCompare(right.key);
      });

      return {
        provider,
        total: value.total,
        successful: value.successful,
        failed,
        clientErrors: value.clientErrors,
        serverErrors: value.serverErrors,
        successRatePct: rates.successRatePct,
        failureRatePct: rates.failureRatePct,
        latency: buildLatencySummary(value.total, value.totalLatencyMs, value.latencyBuckets),
        endpoints: value.endpoints,
      };
    })
    .sort((left, right) => {
      if (right.failed !== left.failed) return right.failed - left.failed;
      if (right.total !== left.total) return right.total - left.total;
      return left.provider.localeCompare(right.provider);
    });
}

function classifyOutcome(statusCode: number): { successful: number; clientErrors: number; serverErrors: number } {
  if (statusCode >= 100 && statusCode < 400) {
    return { successful: 1, clientErrors: 0, serverErrors: 0 };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return { successful: 0, clientErrors: 1, serverErrors: 0 };
  }
  return { successful: 0, clientErrors: 0, serverErrors: 1 };
}

export function enterRequestMetricsContext(endpoint: string): void {
  requestMetricsContext.enterWith({ endpoint, providerMetrics: [] });
}

function getRequestMetricsContext(): RequestMetricsContext | null {
  return requestMetricsContext.getStore() ?? null;
}

function classifyProviderError(error: unknown): { clientErrors: number; serverErrors: number } {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number") {
    const statusCode = error.statusCode;
    if (statusCode >= 400 && statusCode < 500) {
      return { clientErrors: 1, serverErrors: 0 };
    }
  }

  return { clientErrors: 0, serverErrors: 1 };
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeWallet(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function buildStatsUserFilter(input?: StatsUserFilter): { agentId: string | null; agentWalletEvm: string | null } {
  return {
    agentId: normalizeNullableText(input?.agentId),
    agentWalletEvm: normalizeWallet(input?.agentWalletEvm),
  };
}

function buildApiKeyWhereClause(filter: { agentId: string | null; agentWalletEvm: string | null }, alias: string, startIndex = 1): { clause: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  let index = startIndex;

  if (filter.agentId) {
    clauses.push(`${alias}.agent_id = $${index}`);
    params.push(filter.agentId);
    index += 1;
  }

  if (filter.agentWalletEvm) {
    clauses.push(`LOWER(${alias}.agent_wallet_evm) = $${index}`);
    params.push(filter.agentWalletEvm);
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function buildSingleUserSummary(input: {
  matchedKeys: number;
  totalRequests: number;
  successful: number;
  clientErrors: number;
  serverErrors: number;
  totalLatencyMs: number;
  latencyBuckets: Record<string, number>;
}): ApiStatsSingleUserSummary {
  const outcomeSummary = buildOutcomeSummary(input.totalRequests, input.successful, input.clientErrors, input.serverErrors);
  return {
    matchedKeys: input.matchedKeys,
    totalRequests: input.totalRequests,
    successful: input.successful,
    failed: outcomeSummary.failed,
    clientErrors: input.clientErrors,
    serverErrors: input.serverErrors,
    successRatePct: outcomeSummary.successRatePct,
    failureRatePct: outcomeSummary.failureRatePct,
    latency: buildLatencySummary(input.totalRequests, input.totalLatencyMs, input.latencyBuckets),
  };
}

function buildApiKeysRecord<TItem extends { id: string }>(items: TItem[]): Record<string, TItem> {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, TItem>;
}

function formatUnits(raw: string, decimals: number): string {
  const value = raw.replace(/^0+/, "") || "0";
  if (decimals <= 0) return value;
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function getHeaderValue(headers: Record<string, unknown>, name: string): string | null {
  const value = headers[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

function getPresentedApiKey(headers: Record<string, unknown>): string | null {
  const direct = getHeaderValue(headers, "x-api-key");
  if (direct) return direct;

  const authorization = getHeaderValue(headers, "authorization");
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function getPresentedAdminKey(headers: Record<string, unknown>): string | null {
  return getHeaderValue(headers, "x-admin-key");
}

function pathMatches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function classifyPath(pathname: string): "public" | "admin" | "protected" | "unknown" {
  if (PUBLIC_PATHS.has(pathname)) {
    return "public";
  }
  if ([...ADMIN_PATHS].some((path) => pathMatches(pathname, path))) {
    return "admin";
  }
  if (PROTECTED_PREFIXES.some((prefix) => pathMatches(pathname, prefix))) {
    return "protected";
  }
  return "unknown";
}

export function isTrackedMetricPath(pathname: string): boolean {
  return TRACKED_METRIC_PATHS.has(pathname);
}

export function requireAdminKey(headers: Record<string, unknown>): void {
  const configured = getOptionalEnv("ADMIN_API_KEY");
  if (!isConfigured(configured)) {
    throw new AccessError(503, "Set a real value for ADMIN_API_KEY in the root .env file.");
  }

  const presented = getPresentedAdminKey(headers);
  if (!presented || presented !== configured) {
    throw new AccessError(401, "Missing or invalid admin key.");
  }
}

export function requireAdminKeyForWebSocket(headers: Record<string, unknown>, url?: string | null): void {
  const configured = getOptionalEnv("ADMIN_API_KEY");
  if (!isConfigured(configured)) {
    throw new AccessError(503, "Set a real value for ADMIN_API_KEY in the root .env file.");
  }

  const headerKey = getPresentedAdminKey(headers);
  const queryKey = (() => {
    if (!url) {
      return null;
    }
    try {
      return new URL(url, "http://localhost").searchParams.get("adminKey")?.trim() ?? null;
    } catch {
      return null;
    }
  })();

  const presented = headerKey ?? queryKey;
  if (!presented || presented !== configured) {
    throw new AccessError(401, "Missing or invalid admin key.");
  }
}

export async function requireApiKey(headers: Record<string, unknown>): Promise<ResolvedApiKey> {
  const presented = getPresentedApiKey(headers);
  if (!presented) {
    throw new AccessError(401, "Missing API key. Send x-api-key or Authorization: Bearer <key>.");
  }

  const keyHash = hashApiKey(presented);
  const nowMs = Date.now();
  const cached = getCachedResolvedApiKey(keyHash, nowMs);
  if (cached !== undefined) {
    if (!cached) {
      throw new AccessError(401, "Invalid API key.");
    }
    return cached;
  }

  await ensureDatabaseReady();
  const result = await getPool().query<{ id: string; prefix: string; agent_id: string | null }>(
    `
      SELECT id, prefix, agent_id
      FROM api_keys
      WHERE key_hash = $1
      LIMIT 1
    `,
    [keyHash],
  );
  const match = result.rows[0];
  if (!match) {
    setCachedResolvedApiKey(keyHash, null, API_KEY_AUTH_NEGATIVE_CACHE_TTL_MS, nowMs);
    throw new AccessError(401, "Invalid API key.");
  }

  const resolved = { id: match.id, prefix: match.prefix, agentId: match.agent_id };
  setCachedResolvedApiKey(keyHash, resolved, API_KEY_AUTH_CACHE_TTL_MS, nowMs);
  return resolved;
}

export async function generateApiKey(
  label?: string | null,
  agentId?: string | null,
  agentWalletEvm?: string | null,
  agentWalletSol?: string | null,
): Promise<ApiKeyGenerateResponse> {
  return withTransaction(async (client) => {
    const now = new Date().toISOString();
    const apiKey = `click_${randomBytes(24).toString("hex")}`;
    const prefix = apiKey.slice(0, 12);
    const recordId = randomBytes(12).toString("hex");
    const normalizedLabel = normalizeNullableText(label);
    const normalizedAgentId = normalizeNullableText(agentId);
    const normalizedAgentWalletEvm = normalizeWallet(agentWalletEvm);
    const normalizedAgentWalletSol = normalizeNullableText(agentWalletSol);

    if (normalizedAgentWalletEvm) {
      const existingEvmKey = await client.query<{ id: string; prefix: string }>(
        `
          SELECT id, prefix
          FROM api_keys
          WHERE LOWER(agent_wallet_evm) = $1
          LIMIT 1
        `,
        [normalizedAgentWalletEvm],
      );
      const match = existingEvmKey.rows[0];
      if (match) {
        throw new AccessError(409, "An API key already exists for that EVM wallet address. Delete it before generating a replacement.", {
          keyId: match.id,
          prefix: match.prefix,
          walletField: "agentWalletEvm",
          walletAddress: normalizedAgentWalletEvm,
        });
      }
    }

    if (normalizedAgentWalletSol) {
      const existingSolKey = await client.query<{ id: string; prefix: string }>(
        `
          SELECT id, prefix
          FROM api_keys
          WHERE agent_wallet_sol = $1
          LIMIT 1
        `,
        [normalizedAgentWalletSol],
      );
      const match = existingSolKey.rows[0];
      if (match) {
        throw new AccessError(409, "An API key already exists for that Solana wallet address. Delete it before generating a replacement.", {
          keyId: match.id,
          prefix: match.prefix,
          walletField: "agentWalletSol",
          walletAddress: normalizedAgentWalletSol,
        });
      }
    }

    await client.query(
      `
        INSERT INTO api_keys (
          id,
          label,
          prefix,
          key_hash,
          agent_id,
          agent_wallet_evm,
          agent_wallet_sol,
          created_at,
          total_requests
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, 0)
      `,
      [
        recordId,
        normalizedLabel,
        prefix,
        hashApiKey(apiKey),
        normalizedAgentId,
        normalizedAgentWalletEvm,
        normalizedAgentWalletSol,
        now,
      ],
    );

    const metrics = createDailyMetrics();
    await ensureDailyStatsRow(client, metrics);

    const counts = await client.query<{
      total_generated: string;
      active_today: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM api_keys) AS total_generated,
          (SELECT COUNT(*) FROM api_daily_key_stats WHERE day_key = $1::date) AS active_today
      `,
      [metrics.dayKey],
    );

    const summary = counts.rows[0];
    return {
      endpoint: "apiKeyGenerate",
      apiKey,
      keyId: recordId,
      prefix,
      label: normalizedLabel,
      agentId: normalizedAgentId,
      agentWalletEvm: normalizedAgentWalletEvm,
      agentWalletSol: normalizedAgentWalletSol,
      createdAt: now,
      totalGenerated: parseCount(summary?.total_generated),
      activeToday: parseCount(summary?.active_today),
    };
  });
}

export async function deleteApiKey(keyId: string): Promise<ApiKeyDeleteResponse> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      prefix: string;
      label: string | null;
      agent_id: string | null;
      agent_wallet_evm: string | null;
      agent_wallet_sol: string | null;
      created_at: Date | string;
      last_used_at: Date | string | null;
      total_requests: string;
    }>(
      `
        DELETE FROM api_keys
        WHERE id = $1
        RETURNING id, prefix, label, agent_id, agent_wallet_evm, agent_wallet_sol, created_at, last_used_at, total_requests
      `,
      [keyId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AccessError(404, "API key not found.");
    }

    apiKeyRateLimitStates.delete(row.id);
    dropAuthCacheByApiKeyId(row.id);

    return {
      endpoint: "apiKeyDelete",
      keyId: row.id,
      prefix: row.prefix,
      label: row.label,
      agentId: row.agent_id,
      agentWalletEvm: row.agent_wallet_evm,
      agentWalletSol: row.agent_wallet_sol,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      totalRequests: parseCount(row.total_requests),
      deletedAt: new Date().toISOString(),
    };
  });
}

export async function recordRequestMetric(input: { path: string; statusCode: number; durationMs?: number; apiKeyId?: string | null }): Promise<void> {
  const now = new Date();
  const dayKey = getDayKey(now);
  const buffered = getBufferedDayAnalytics(dayKey, now);
  const endpoint = input.path || "unknown";
  const statusKey = String(input.statusCode || 0);
  const outcome = classifyOutcome(input.statusCode || 0);
  const durationMs = normalizeDurationMs((input as { durationMs?: number }).durationMs);
  const latencyBuckets = addLatencyToBuckets({}, durationMs);

  buffered.totalRequests += 1;
  buffered.statusCodes[statusKey] = (buffered.statusCodes[statusKey] ?? 0) + 1;
  buffered.totalLatencyMs += durationMs;
  buffered.latencyBuckets = mergeCountMaps(buffered.latencyBuckets, latencyBuckets);

  const endpointAggregate = buffered.endpointStats.get(endpoint) ?? createAggregateCounter();
  applyAggregateCounter(endpointAggregate, {
    requestCount: 1,
    successfulRequests: outcome.successful,
    clientErrorRequests: outcome.clientErrors,
    serverErrorRequests: outcome.serverErrors,
    totalLatencyMs: durationMs,
    latencyBuckets,
  });
  buffered.endpointStats.set(endpoint, endpointAggregate);

  if (input.apiKeyId) {
    const usedAt = now.toISOString();
    const keyAggregate = buffered.keyStats.get(input.apiKeyId) ?? { ...createAggregateCounter(), lastUsedAt: usedAt };
    applyAggregateCounter(keyAggregate, {
      requestCount: 1,
      successfulRequests: outcome.successful,
      clientErrorRequests: outcome.clientErrors,
      serverErrorRequests: outcome.serverErrors,
      totalLatencyMs: durationMs,
      latencyBuckets,
    });
    keyAggregate.lastUsedAt = usedAt;
    buffered.keyStats.set(input.apiKeyId, keyAggregate);
  }

  bufferedRequestCount += 1;
  if (shouldFlushBufferedAnalytics()) {
    void flushBufferedAnalytics().catch(() => {
      scheduleBufferedAnalyticsFlush();
    });
    return;
  }

  scheduleBufferedAnalyticsFlush();
}

export async function recordProviderMetric(input: { provider: string; successful: boolean; error?: unknown; durationMs?: number }): Promise<void> {
  const context = getRequestMetricsContext();
  if (!context) {
    return;
  }

  context.providerMetrics.push(input);
}

export async function flushProviderMetrics(): Promise<void> {
  const context = getRequestMetricsContext();
  if (!context || context.providerMetrics.length === 0) {
    return;
  }

  const grouped = new Map<string, { successful: number; clientErrors: number; serverErrors: number; totalLatencyMs: number; latencyBuckets: Record<string, number> }>();

  for (const metric of context.providerMetrics) {
    const classification = metric.successful
      ? { successful: 1, clientErrors: 0, serverErrors: 0 }
      : { successful: 0, ...classifyProviderError(metric.error) };
    const durationMs = normalizeDurationMs(metric.durationMs);
    const current = grouped.get(metric.provider) ?? {
      successful: 0,
      clientErrors: 0,
      serverErrors: 0,
      totalLatencyMs: 0,
      latencyBuckets: {},
    };

    current.successful += classification.successful;
    current.clientErrors += classification.clientErrors;
    current.serverErrors += classification.serverErrors;
    current.totalLatencyMs += durationMs;
    current.latencyBuckets = addLatencyToBuckets(current.latencyBuckets, durationMs);
    grouped.set(metric.provider, current);
  }

  context.providerMetrics = [];

  const now = new Date();
  const dayKey = getDayKey(now);
  const buffered = getBufferedDayAnalytics(dayKey, now);

  for (const [provider, aggregate] of grouped.entries()) {
    const providerKey = `${context.endpoint}\u0000${provider}`;
    const providerAggregate = buffered.providerStats.get(providerKey) ?? {
      endpoint: context.endpoint,
      provider,
      stats: createAggregateCounter(),
    };
    applyAggregateCounter(providerAggregate.stats, {
      requestCount: aggregate.successful + aggregate.clientErrors + aggregate.serverErrors,
      successfulRequests: aggregate.successful,
      clientErrorRequests: aggregate.clientErrors,
      serverErrorRequests: aggregate.serverErrors,
      totalLatencyMs: aggregate.totalLatencyMs,
      latencyBuckets: aggregate.latencyBuckets,
    });
    buffered.providerStats.set(providerKey, providerAggregate);
  }

  if (shouldFlushBufferedAnalytics()) {
    void flushBufferedAnalytics().catch(() => {
      scheduleBufferedAnalyticsFlush();
    });
    return;
  }

  scheduleBufferedAnalyticsFlush();
}

export async function recordSwapVolume(input: { chain: string; tokenIn: string; tokenOut: string; buyWei?: string | null; sellWei?: string | null }): Promise<void> {
  let chain: SupportedChain;
  try {
    chain = normalizeChain(input.chain);
  } catch {
    return;
  }

  const trackedChain = chain as TrackedVolumeChain;
  const buyRaw = input.buyWei && isNativeTokenForChain(trackedChain, input.tokenIn) && !isNativeTokenForChain(trackedChain, input.tokenOut)
    ? BigInt(input.buyWei)
    : 0n;
  const sellRaw = input.sellWei && !isNativeTokenForChain(trackedChain, input.tokenIn) && isNativeTokenForChain(trackedChain, input.tokenOut)
    ? BigInt(input.sellWei)
    : 0n;
  if (buyRaw === 0n && sellRaw === 0n) {
    return;
  }

  const now = new Date();
  const dayKey = getDayKey(now);
  const buffered = getBufferedDayAnalytics(dayKey, now);
  buffered.volumes[trackedChain].buyRaw += buyRaw;
  buffered.volumes[trackedChain].sellRaw += sellRaw;
  buffered.volumes[trackedChain].buyCount += buyRaw > 0n ? 1 : 0;
  buffered.volumes[trackedChain].sellCount += sellRaw > 0n ? 1 : 0;
  scheduleBufferedAnalyticsFlush();
}

async function flushBufferedDayAnalytics(client: PoolClient, state: BufferedDayAnalytics): Promise<void> {
  await client.query(
    `
      INSERT INTO api_daily_stats (
        day_key,
        started_at,
        resets_at,
        total_requests,
        status_codes,
        total_latency_ms,
        latency_buckets,
        eth_buy_wei,
        eth_sell_wei,
        eth_buy_count,
        eth_sell_count,
        base_buy_wei,
        base_sell_wei,
        base_buy_count,
        base_sell_count,
        bsc_buy_wei,
        bsc_sell_wei,
        bsc_buy_count,
        bsc_sell_count,
        sol_buy_lamports,
        sol_sell_lamports,
        sol_buy_count,
        sol_sell_count
      )
      VALUES (
        $1::date,
        $2::timestamptz,
        $3::timestamptz,
        $4,
        $5::jsonb,
        $6,
        $7::jsonb,
        $8::numeric,
        $9::numeric,
        $10,
        $11,
        $12::numeric,
        $13::numeric,
        $14,
        $15,
        $16::numeric,
        $17::numeric,
        $18,
        $19,
        $20::numeric,
        $21::numeric,
        $22,
        $23
      )
      ON CONFLICT (day_key)
      DO UPDATE SET
        total_requests = api_daily_stats.total_requests + EXCLUDED.total_requests,
        status_codes = (
          SELECT COALESCE(jsonb_object_agg(merged.key, to_jsonb(merged.value_sum)), '{}'::jsonb)
          FROM (
            SELECT key, SUM(value)::bigint AS value_sum
            FROM (
              SELECT key, value::bigint AS value
              FROM jsonb_each_text(COALESCE(api_daily_stats.status_codes, '{}'::jsonb))
              UNION ALL
              SELECT key, value::bigint AS value
              FROM jsonb_each_text(COALESCE(EXCLUDED.status_codes, '{}'::jsonb))
            ) counts
            GROUP BY key
          ) merged
        ),
        total_latency_ms = api_daily_stats.total_latency_ms + EXCLUDED.total_latency_ms,
        latency_buckets = (
          SELECT COALESCE(jsonb_object_agg(merged.key, to_jsonb(merged.value_sum)), '{}'::jsonb)
          FROM (
            SELECT key, SUM(value)::bigint AS value_sum
            FROM (
              SELECT key, value::bigint AS value
              FROM jsonb_each_text(COALESCE(api_daily_stats.latency_buckets, '{}'::jsonb))
              UNION ALL
              SELECT key, value::bigint AS value
              FROM jsonb_each_text(COALESCE(EXCLUDED.latency_buckets, '{}'::jsonb))
            ) counts
            GROUP BY key
          ) merged
        ),
        eth_buy_wei = api_daily_stats.eth_buy_wei + EXCLUDED.eth_buy_wei,
        eth_sell_wei = api_daily_stats.eth_sell_wei + EXCLUDED.eth_sell_wei,
        eth_buy_count = api_daily_stats.eth_buy_count + EXCLUDED.eth_buy_count,
        eth_sell_count = api_daily_stats.eth_sell_count + EXCLUDED.eth_sell_count,
        base_buy_wei = api_daily_stats.base_buy_wei + EXCLUDED.base_buy_wei,
        base_sell_wei = api_daily_stats.base_sell_wei + EXCLUDED.base_sell_wei,
        base_buy_count = api_daily_stats.base_buy_count + EXCLUDED.base_buy_count,
        base_sell_count = api_daily_stats.base_sell_count + EXCLUDED.base_sell_count,
        bsc_buy_wei = api_daily_stats.bsc_buy_wei + EXCLUDED.bsc_buy_wei,
        bsc_sell_wei = api_daily_stats.bsc_sell_wei + EXCLUDED.bsc_sell_wei,
        bsc_buy_count = api_daily_stats.bsc_buy_count + EXCLUDED.bsc_buy_count,
        bsc_sell_count = api_daily_stats.bsc_sell_count + EXCLUDED.bsc_sell_count,
        sol_buy_lamports = api_daily_stats.sol_buy_lamports + EXCLUDED.sol_buy_lamports,
        sol_sell_lamports = api_daily_stats.sol_sell_lamports + EXCLUDED.sol_sell_lamports,
        sol_buy_count = api_daily_stats.sol_buy_count + EXCLUDED.sol_buy_count,
        sol_sell_count = api_daily_stats.sol_sell_count + EXCLUDED.sol_sell_count,
        updated_at = NOW()
    `,
    [
      state.dayKey,
      state.startedAt,
      state.resetsAt,
      state.totalRequests,
      JSON.stringify(state.statusCodes),
      state.totalLatencyMs,
      JSON.stringify(state.latencyBuckets),
      state.volumes.eth.buyRaw.toString(),
      state.volumes.eth.sellRaw.toString(),
      state.volumes.eth.buyCount,
      state.volumes.eth.sellCount,
      state.volumes.base.buyRaw.toString(),
      state.volumes.base.sellRaw.toString(),
      state.volumes.base.buyCount,
      state.volumes.base.sellCount,
      state.volumes.bsc.buyRaw.toString(),
      state.volumes.bsc.sellRaw.toString(),
      state.volumes.bsc.buyCount,
      state.volumes.bsc.sellCount,
      state.volumes.sol.buyRaw.toString(),
      state.volumes.sol.sellRaw.toString(),
      state.volumes.sol.buyCount,
      state.volumes.sol.sellCount,
    ],
  );

  const endpointRows = [...state.endpointStats.entries()].map(([endpoint, aggregate]) => ({
    endpoint,
    request_count: aggregate.requestCount,
    successful_requests: aggregate.successfulRequests,
    client_error_requests: aggregate.clientErrorRequests,
    server_error_requests: aggregate.serverErrorRequests,
    total_latency_ms: aggregate.totalLatencyMs,
    latency_buckets: aggregate.latencyBuckets,
  }));

  if (endpointRows.length > 0) {
    await client.query(
      `
        INSERT INTO api_daily_endpoint_stats (
          day_key,
          endpoint,
          request_count,
          successful_requests,
          client_error_requests,
          server_error_requests,
          total_latency_ms,
          latency_buckets
        )
        SELECT
          $1::date,
          row.endpoint,
          row.request_count,
          row.successful_requests,
          row.client_error_requests,
          row.server_error_requests,
          row.total_latency_ms,
          row.latency_buckets
        FROM jsonb_to_recordset($2::jsonb) AS row(
          endpoint text,
          request_count bigint,
          successful_requests bigint,
          client_error_requests bigint,
          server_error_requests bigint,
          total_latency_ms bigint,
          latency_buckets jsonb
        )
        ON CONFLICT (day_key, endpoint)
        DO UPDATE SET
          request_count = api_daily_endpoint_stats.request_count + EXCLUDED.request_count,
          successful_requests = api_daily_endpoint_stats.successful_requests + EXCLUDED.successful_requests,
          client_error_requests = api_daily_endpoint_stats.client_error_requests + EXCLUDED.client_error_requests,
          server_error_requests = api_daily_endpoint_stats.server_error_requests + EXCLUDED.server_error_requests,
          total_latency_ms = api_daily_endpoint_stats.total_latency_ms + EXCLUDED.total_latency_ms,
          latency_buckets = (
            SELECT COALESCE(jsonb_object_agg(merged.key, to_jsonb(merged.value_sum)), '{}'::jsonb)
            FROM (
              SELECT key, SUM(value)::bigint AS value_sum
              FROM (
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(api_daily_endpoint_stats.latency_buckets, '{}'::jsonb))
                UNION ALL
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(EXCLUDED.latency_buckets, '{}'::jsonb))
              ) counts
              GROUP BY key
            ) merged
          ),
          updated_at = NOW()
      `,
      [state.dayKey, JSON.stringify(endpointRows)],
    );
  }

  const keyRows = [...state.keyStats.entries()].map(([apiKeyId, aggregate]) => ({
    api_key_id: apiKeyId,
    request_count: aggregate.requestCount,
    successful_requests: aggregate.successfulRequests,
    client_error_requests: aggregate.clientErrorRequests,
    server_error_requests: aggregate.serverErrorRequests,
    total_latency_ms: aggregate.totalLatencyMs,
    latency_buckets: aggregate.latencyBuckets,
    last_used_at: aggregate.lastUsedAt,
  }));

  if (keyRows.length > 0) {
    await client.query(
      `
        UPDATE api_keys k
        SET last_used_at = GREATEST(COALESCE(k.last_used_at, to_timestamp(0)), row.last_used_at),
            total_requests = k.total_requests + row.request_count
        FROM jsonb_to_recordset($1::jsonb) AS row(
          api_key_id text,
          request_count bigint,
          last_used_at timestamptz
        )
        WHERE k.id = row.api_key_id
      `,
      [JSON.stringify(keyRows)],
    );

    await client.query(
      `
        INSERT INTO api_daily_key_stats (
          day_key,
          api_key_id,
          request_count,
          successful_requests,
          client_error_requests,
          server_error_requests,
          total_latency_ms,
          latency_buckets,
          last_used_at
        )
        SELECT
          $1::date,
          row.api_key_id,
          row.request_count,
          row.successful_requests,
          row.client_error_requests,
          row.server_error_requests,
          row.total_latency_ms,
          row.latency_buckets,
          row.last_used_at
        FROM jsonb_to_recordset($2::jsonb) AS row(
          api_key_id text,
          request_count bigint,
          successful_requests bigint,
          client_error_requests bigint,
          server_error_requests bigint,
          total_latency_ms bigint,
          latency_buckets jsonb,
          last_used_at timestamptz
        )
        ON CONFLICT (day_key, api_key_id)
        DO UPDATE SET
          request_count = api_daily_key_stats.request_count + EXCLUDED.request_count,
          successful_requests = api_daily_key_stats.successful_requests + EXCLUDED.successful_requests,
          client_error_requests = api_daily_key_stats.client_error_requests + EXCLUDED.client_error_requests,
          server_error_requests = api_daily_key_stats.server_error_requests + EXCLUDED.server_error_requests,
          total_latency_ms = api_daily_key_stats.total_latency_ms + EXCLUDED.total_latency_ms,
          latency_buckets = (
            SELECT COALESCE(jsonb_object_agg(merged.key, to_jsonb(merged.value_sum)), '{}'::jsonb)
            FROM (
              SELECT key, SUM(value)::bigint AS value_sum
              FROM (
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(api_daily_key_stats.latency_buckets, '{}'::jsonb))
                UNION ALL
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(EXCLUDED.latency_buckets, '{}'::jsonb))
              ) counts
              GROUP BY key
            ) merged
          ),
          last_used_at = GREATEST(api_daily_key_stats.last_used_at, EXCLUDED.last_used_at),
          updated_at = NOW()
      `,
      [state.dayKey, JSON.stringify(keyRows)],
    );
  }

  const providerRows = [...state.providerStats.values()].map((providerAggregate) => ({
    endpoint: providerAggregate.endpoint,
    provider: providerAggregate.provider,
    request_count: providerAggregate.stats.requestCount,
    successful_requests: providerAggregate.stats.successfulRequests,
    client_error_requests: providerAggregate.stats.clientErrorRequests,
    server_error_requests: providerAggregate.stats.serverErrorRequests,
    total_latency_ms: providerAggregate.stats.totalLatencyMs,
    latency_buckets: providerAggregate.stats.latencyBuckets,
  }));

  if (providerRows.length > 0) {
    await client.query(
      `
        INSERT INTO api_daily_provider_stats (
          day_key,
          endpoint,
          provider,
          request_count,
          successful_requests,
          client_error_requests,
          server_error_requests,
          total_latency_ms,
          latency_buckets
        )
        SELECT
          $1::date,
          row.endpoint,
          row.provider,
          row.request_count,
          row.successful_requests,
          row.client_error_requests,
          row.server_error_requests,
          row.total_latency_ms,
          row.latency_buckets
        FROM jsonb_to_recordset($2::jsonb) AS row(
          endpoint text,
          provider text,
          request_count bigint,
          successful_requests bigint,
          client_error_requests bigint,
          server_error_requests bigint,
          total_latency_ms bigint,
          latency_buckets jsonb
        )
        ON CONFLICT (day_key, endpoint, provider)
        DO UPDATE SET
          request_count = api_daily_provider_stats.request_count + EXCLUDED.request_count,
          successful_requests = api_daily_provider_stats.successful_requests + EXCLUDED.successful_requests,
          client_error_requests = api_daily_provider_stats.client_error_requests + EXCLUDED.client_error_requests,
          server_error_requests = api_daily_provider_stats.server_error_requests + EXCLUDED.server_error_requests,
          total_latency_ms = api_daily_provider_stats.total_latency_ms + EXCLUDED.total_latency_ms,
          latency_buckets = (
            SELECT COALESCE(jsonb_object_agg(merged.key, to_jsonb(merged.value_sum)), '{}'::jsonb)
            FROM (
              SELECT key, SUM(value)::bigint AS value_sum
              FROM (
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(api_daily_provider_stats.latency_buckets, '{}'::jsonb))
                UNION ALL
                SELECT key, value::bigint AS value
                FROM jsonb_each_text(COALESCE(EXCLUDED.latency_buckets, '{}'::jsonb))
              ) counts
              GROUP BY key
            ) merged
          ),
          updated_at = NOW()
      `,
      [state.dayKey, JSON.stringify(providerRows)],
    );
  }
}

export async function flushBufferedAnalytics(): Promise<void> {
  if (analyticsFlushPromise) {
    return analyticsFlushPromise;
  }

  if (bufferedAnalyticsByDay.size === 0) {
    clearAnalyticsFlushTimer();
    return;
  }

  clearAnalyticsFlushTimer();
  const snapshot = bufferedAnalyticsByDay;
  const snapshotRequestCount = bufferedRequestCount;
  bufferedAnalyticsByDay = new Map();
  bufferedRequestCount = 0;

  analyticsFlushPromise = (async () => {
    try {
      await withTransaction(async (client) => {
        for (const state of snapshot.values()) {
          await flushBufferedDayAnalytics(client, state);
        }
      });

      allTimeRequestsCache = null;
      allTimeVolumeCache = null;
    } catch (error) {
      requeueBufferedAnalytics(snapshot, snapshotRequestCount);
      // Surface flush failures so ops can diagnose stale analytics quickly.
      console.error("[apiRuntime] Failed to flush buffered analytics", error);
      throw error;
    } finally {
      analyticsFlushPromise = null;
      if (bufferedAnalyticsByDay.size > 0) {
        if (shouldFlushBufferedAnalytics()) {
          void flushBufferedAnalytics().catch(() => {
            scheduleBufferedAnalyticsFlush();
          });
        } else {
          scheduleBufferedAnalyticsFlush();
        }
      }
    }
  })();

  return analyticsFlushPromise;
}

async function getTodayMetrics(): Promise<DailyMetrics> {
  await ensureDatabaseReady();
  const fallback = createDailyMetrics();
  const result = await getPool().query<{
    day_key: string;
    started_at: Date | string;
    resets_at: Date | string;
    total_requests: string;
    status_codes: Record<string, number> | string | null;
    total_latency_ms: string;
    latency_buckets: Record<string, number> | string | null;
    eth_buy_wei: string;
    eth_sell_wei: string;
    eth_buy_count: number | string;
    eth_sell_count: number | string;
    base_buy_wei: string;
    base_sell_wei: string;
    base_buy_count: number | string;
    base_sell_count: number | string;
    bsc_buy_wei: string;
    bsc_sell_wei: string;
    bsc_buy_count: number | string;
    bsc_sell_count: number | string;
    sol_buy_lamports: string;
    sol_sell_lamports: string;
    sol_buy_count: number | string;
    sol_sell_count: number | string;
  }>(
    `
      SELECT day_key, started_at, resets_at, total_requests, status_codes, total_latency_ms, latency_buckets, eth_buy_wei, eth_sell_wei, eth_buy_count, eth_sell_count, base_buy_wei, base_sell_wei, base_buy_count, base_sell_count, bsc_buy_wei, bsc_sell_wei, bsc_buy_count, bsc_sell_count, sol_buy_lamports, sol_sell_lamports, sol_buy_count, sol_sell_count
      FROM api_daily_stats
      WHERE day_key = $1::date
      LIMIT 1
    `,
    [fallback.dayKey],
  );

  const row = result.rows[0];
  if (!row) {
    return fallback;
  }

  return {
    dayKey: fallback.dayKey,
    startedAt: new Date(row.started_at).toISOString(),
    resetsAt: new Date(row.resets_at).toISOString(),
    totalRequests: parseCount(row.total_requests),
    requestsByEndpoint: {},
    statusCodes: typeof row.status_codes === "string"
      ? JSON.parse(row.status_codes) as Record<string, number>
      : (row.status_codes ?? {}),
    totalLatencyMs: parseCount(row.total_latency_ms),
    latencyBuckets: parseCountMap(row.latency_buckets),
    volumes: {
      eth: { buyRaw: row.eth_buy_wei ?? "0", sellRaw: row.eth_sell_wei ?? "0", buyCount: parseCount(row.eth_buy_count), sellCount: parseCount(row.eth_sell_count) },
      base: { buyRaw: row.base_buy_wei ?? "0", sellRaw: row.base_sell_wei ?? "0", buyCount: parseCount(row.base_buy_count), sellCount: parseCount(row.base_sell_count) },
      bsc: { buyRaw: row.bsc_buy_wei ?? "0", sellRaw: row.bsc_sell_wei ?? "0", buyCount: parseCount(row.bsc_buy_count), sellCount: parseCount(row.bsc_sell_count) },
      sol: { buyRaw: row.sol_buy_lamports ?? "0", sellRaw: row.sol_sell_lamports ?? "0", buyCount: parseCount(row.sol_buy_count), sellCount: parseCount(row.sol_sell_count) },
    },
  };
}

async function getRequestsStats(dayKey: string): Promise<ApiStatsRequests> {
  await ensureDatabaseReady();
  const [dailyResult, endpointResult, providerResult] = await Promise.all([
    getPool().query<{ total_requests: string; status_codes: Record<string, number> | string | null; total_latency_ms: string; latency_buckets: Record<string, number> | string | null }>(
      `SELECT total_requests, status_codes, total_latency_ms, latency_buckets FROM api_daily_stats WHERE day_key = $1::date LIMIT 1`,
      [dayKey],
    ),
    getPool().query<EndpointStatsRow>(
      `SELECT endpoint, request_count, successful_requests, client_error_requests, server_error_requests, total_latency_ms, latency_buckets FROM api_daily_endpoint_stats WHERE day_key = $1::date ORDER BY (client_error_requests + server_error_requests) DESC, request_count DESC, endpoint ASC`,
      [dayKey],
    ),
    getPool().query<ProviderStatsRow>(
      `SELECT provider, endpoint, request_count, successful_requests, client_error_requests, server_error_requests, total_latency_ms, latency_buckets FROM api_daily_provider_stats WHERE day_key = $1::date ORDER BY (client_error_requests + server_error_requests) DESC, request_count DESC, provider ASC, endpoint ASC`,
      [dayKey],
    ),
  ]);

  const daily = dailyResult.rows[0];
  const byEndpoint = Object.fromEntries(
    endpointResult.rows.map((row) => [row.endpoint, parseCount(row.request_count)]),
  );
  const rawStatusCodes = daily?.status_codes;
  const byStatusCode = typeof rawStatusCodes === "string"
    ? JSON.parse(rawStatusCodes) as Record<string, number>
    : (rawStatusCodes ?? {});
  const total = parseCount(daily?.total_requests);
  return hydrateRequestStats({
    total,
    byEndpoint,
    byStatusCode,
    totalLatencyMs: parseCount(daily?.total_latency_ms),
    latencyBuckets: parseCountMap(daily?.latency_buckets),
    endpointBreakdown: normalizeEndpointBreakdownRows(endpointResult.rows),
    providers: normalizeProviderBreakdownRows(providerResult.rows),
  });
}

async function getAllTimeRequestsStats(): Promise<ApiStatsRequests> {
  const now = Date.now();
  if (allTimeRequestsCache && allTimeRequestsCache.expiresAt > now) {
    return allTimeRequestsCache.value;
  }

  await ensureDatabaseReady();
  const [totalResult, dailyLatencyResult, endpointResult, statusResult, providerResult] = await Promise.all([
    getPool().query<{ total_requests: string; total_latency_ms: string }>(
      `SELECT COALESCE(SUM(total_requests), 0)::text AS total_requests, COALESCE(SUM(total_latency_ms), 0)::text AS total_latency_ms FROM api_daily_stats`,
    ),
    getPool().query<DailyLatencyRow>(
      `SELECT total_latency_ms::text AS total_latency_ms, latency_buckets FROM api_daily_stats`,
    ),
    getPool().query<EndpointStatsRow>(
      `SELECT endpoint, request_count::text, successful_requests::text, client_error_requests::text, server_error_requests::text, total_latency_ms::text, latency_buckets FROM api_daily_endpoint_stats`,
    ),
    getPool().query<{ status_code: string; request_count: string }>(
      `
        SELECT status_code, COALESCE(SUM(request_count), 0)::text AS request_count
        FROM (
          SELECT key AS status_code, value::bigint AS request_count
          FROM api_daily_stats
          CROSS JOIN LATERAL jsonb_each_text(status_codes)
        ) counts
        GROUP BY status_code
        ORDER BY status_code ASC
      `,
    ),
    getPool().query<ProviderStatsRow>(
      `SELECT provider, endpoint, request_count::text, successful_requests::text, client_error_requests::text, server_error_requests::text, total_latency_ms::text, latency_buckets FROM api_daily_provider_stats`,
    ),
  ]);

  const aggregatedEndpointRows = aggregateEndpointRows(endpointResult.rows);
  const aggregatedProviderRows = aggregateProviderRows(providerResult.rows);
  const latencyBuckets = dailyLatencyResult.rows.reduce<Record<string, number>>((accumulator, row) => (
    mergeCountMaps(accumulator, parseCountMap(row.latency_buckets))
  ), {});

  const result = hydrateRequestStats({
    total: parseCount(totalResult.rows[0]?.total_requests),
    byEndpoint: Object.fromEntries(
      aggregatedEndpointRows.map((row) => [row.endpoint, parseCount(row.request_count)]),
    ),
    byStatusCode: Object.fromEntries(
      statusResult.rows.map((row) => [row.status_code, parseCount(row.request_count)]),
    ),
    totalLatencyMs: parseCount(totalResult.rows[0]?.total_latency_ms),
    latencyBuckets,
    endpointBreakdown: normalizeEndpointBreakdownRows(aggregatedEndpointRows),
    providers: normalizeProviderBreakdownRows(aggregatedProviderRows),
  });

  allTimeRequestsCache = {
    expiresAt: now + ALL_TIME_REQUESTS_CACHE_TTL_MS,
    value: result,
  };

  return result;
}

async function getUsersStats(dayKey: string): Promise<ApiStatsUsers> {
  await ensureDatabaseReady();
  const [countsResult, itemsResult] = await Promise.all([
    getPool().query<{
      total_generated: string;
      total_ever_used: string;
      active_today: string;
      total_agents: string;
      active_agents_today: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM api_keys) AS total_generated,
          (SELECT COUNT(*) FROM api_keys WHERE total_requests > 0) AS total_ever_used,
          (SELECT COUNT(*) FROM api_daily_key_stats WHERE day_key = $1::date) AS active_today,
          (SELECT COUNT(DISTINCT agent_id) FROM api_keys WHERE agent_id IS NOT NULL) AS total_agents,
          (
            SELECT COUNT(DISTINCT k.agent_id)
            FROM api_daily_key_stats d
            JOIN api_keys k ON k.id = d.api_key_id
            WHERE d.day_key = $1::date
              AND k.agent_id IS NOT NULL
          ) AS active_agents_today
      `,
      [dayKey],
    ),
    getPool().query<{
      id: string;
      prefix: string;
      label: string | null;
      agent_id: string | null;
      agent_wallet_evm: string | null;
      agent_wallet_sol: string | null;
      created_at: Date | string;
      last_used_at: Date | string | null;
      total_requests: string;
      requests_today: string | null;
      successful_requests_today: string | null;
      client_error_requests_today: string | null;
      server_error_requests_today: string | null;
      total_latency_ms_today: string | null;
      latency_buckets_today: Record<string, number> | string | null;
    }>(
      `
        SELECT
          k.id,
          k.prefix,
          k.label,
          k.agent_id,
          k.agent_wallet_evm,
          k.agent_wallet_sol,
          k.created_at,
          k.last_used_at,
          k.total_requests,
          d.request_count AS requests_today,
          d.successful_requests AS successful_requests_today,
          d.client_error_requests AS client_error_requests_today,
          d.server_error_requests AS server_error_requests_today,
          d.total_latency_ms AS total_latency_ms_today,
          d.latency_buckets AS latency_buckets_today
        FROM api_keys k
        LEFT JOIN api_daily_key_stats d
          ON d.api_key_id = k.id
         AND d.day_key = $1::date
        ORDER BY COALESCE(d.request_count, 0) DESC, k.created_at DESC
      `,
      [dayKey],
    ),
  ]);

  const counts = countsResult.rows[0];
  const items: ApiStatsUserItem[] = itemsResult.rows.map((row) => {
    const requestsToday = parseCount(row.requests_today);
    const successfulToday = parseCount(row.successful_requests_today);
    const clientErrorsToday = parseCount(row.client_error_requests_today);
    const serverErrorsToday = parseCount(row.server_error_requests_today);
    const outcomeSummary = buildOutcomeSummary(requestsToday, successfulToday, clientErrorsToday, serverErrorsToday);

    return {
      id: row.id,
      prefix: row.prefix,
      label: row.label,
      agentId: row.agent_id,
      agentWalletEvm: row.agent_wallet_evm,
      agentWalletSol: row.agent_wallet_sol,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      totalRequests: parseCount(row.total_requests),
      activeToday: requestsToday > 0,
      requestsToday,
      successfulToday,
      failedToday: outcomeSummary.failed,
      clientErrorsToday,
      serverErrorsToday,
      successRatePctToday: outcomeSummary.successRatePct,
      failureRatePctToday: outcomeSummary.failureRatePct,
      latencyToday: buildLatencySummary(requestsToday, parseCount(row.total_latency_ms_today), parseCountMap(row.latency_buckets_today)),
    };
  });

  const agentGroups = new Map<string, {
    keyCount: number;
    activeKeysToday: number;
    totalRequests: number;
    requestsToday: number;
    successfulToday: number;
    clientErrorsToday: number;
    serverErrorsToday: number;
    totalLatencyMsToday: number;
    latencyBucketsToday: Record<string, number>;
  }>();

  for (const row of itemsResult.rows) {
    if (!row.agent_id) {
      continue;
    }

    const requestsToday = parseCount(row.requests_today);
    const successfulToday = parseCount(row.successful_requests_today);
    const clientErrorsToday = parseCount(row.client_error_requests_today);
    const serverErrorsToday = parseCount(row.server_error_requests_today);
    const latencyBucketsToday = parseCountMap(row.latency_buckets_today);

    const current = agentGroups.get(row.agent_id) ?? {
      keyCount: 0,
      activeKeysToday: 0,
      totalRequests: 0,
      requestsToday: 0,
      successfulToday: 0,
      clientErrorsToday: 0,
      serverErrorsToday: 0,
      totalLatencyMsToday: 0,
      latencyBucketsToday: {},
    };

    current.keyCount += 1;
    current.activeKeysToday += requestsToday > 0 ? 1 : 0;
    current.totalRequests += parseCount(row.total_requests);
    current.requestsToday += requestsToday;
    current.successfulToday += successfulToday;
    current.clientErrorsToday += clientErrorsToday;
    current.serverErrorsToday += serverErrorsToday;
    current.totalLatencyMsToday += parseCount(row.total_latency_ms_today);
    current.latencyBucketsToday = mergeCountMaps(current.latencyBucketsToday, latencyBucketsToday);
    agentGroups.set(row.agent_id, current);
  }

  const agents: ApiStatsAgentItem[] = [...agentGroups.entries()]
    .map(([agentId, value]) => {
      const outcomeSummary = buildOutcomeSummary(value.requestsToday, value.successfulToday, value.clientErrorsToday, value.serverErrorsToday);
      return {
        agentId,
        keyCount: value.keyCount,
        activeKeysToday: value.activeKeysToday,
        totalRequests: value.totalRequests,
        requestsToday: value.requestsToday,
        successfulToday: value.successfulToday,
        failedToday: outcomeSummary.failed,
        clientErrorsToday: value.clientErrorsToday,
        serverErrorsToday: value.serverErrorsToday,
        successRatePctToday: outcomeSummary.successRatePct,
        failureRatePctToday: outcomeSummary.failureRatePct,
        latencyToday: buildLatencySummary(value.requestsToday, value.totalLatencyMsToday, value.latencyBucketsToday),
      };
    })
    .sort((left, right) => {
      if (right.failedToday !== left.failedToday) return right.failedToday - left.failedToday;
      if (right.requestsToday !== left.requestsToday) return right.requestsToday - left.requestsToday;
      return left.agentId.localeCompare(right.agentId);
    });

  return {
    totalGenerated: parseCount(counts?.total_generated),
    totalEverUsed: parseCount(counts?.total_ever_used),
    activeToday: parseCount(counts?.active_today),
    totalAgents: parseCount(counts?.total_agents),
    activeAgentsToday: parseCount(counts?.active_agents_today),
    agents,
    items,
  };
}

async function getFilteredDailyUserStats(dayKey: string, filter: { agentId: string | null; agentWalletEvm: string | null }): Promise<{ summary: ApiStatsSingleUserSummary; keys: ApiStatsUserItem[]; apiKeys: Record<string, ApiStatsUserItem> }> {
  await ensureDatabaseReady();
  const where = buildApiKeyWhereClause(filter, "k", 2);
  const result = await getPool().query<{
    id: string;
    prefix: string;
    label: string | null;
    agent_id: string | null;
    agent_wallet_evm: string | null;
    agent_wallet_sol: string | null;
    created_at: Date | string;
    last_used_at: Date | string | null;
    total_requests: string;
    requests_today: string | null;
    successful_requests_today: string | null;
    client_error_requests_today: string | null;
    server_error_requests_today: string | null;
    total_latency_ms_today: string | null;
    latency_buckets_today: Record<string, number> | string | null;
  }>(
    `
      SELECT
        k.id,
        k.prefix,
        k.label,
        k.agent_id,
        k.agent_wallet_evm,
        k.agent_wallet_sol,
        k.created_at,
        k.last_used_at,
        k.total_requests,
        d.request_count AS requests_today,
        d.successful_requests AS successful_requests_today,
        d.client_error_requests AS client_error_requests_today,
        d.server_error_requests AS server_error_requests_today,
        d.total_latency_ms AS total_latency_ms_today,
        d.latency_buckets AS latency_buckets_today
      FROM api_keys k
      LEFT JOIN api_daily_key_stats d
        ON d.api_key_id = k.id
       AND d.day_key = $1::date
      ${where.clause}
      ORDER BY COALESCE(d.request_count, 0) DESC, k.created_at DESC
    `,
    [dayKey, ...where.params],
  );

  let totalRequests = 0;
  let successful = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let totalLatencyMs = 0;
  let latencyBuckets: Record<string, number> = {};

  const keys = result.rows.map((row) => {
    const requestsToday = parseCount(row.requests_today);
    const successfulToday = parseCount(row.successful_requests_today);
    const clientErrorsToday = parseCount(row.client_error_requests_today);
    const serverErrorsToday = parseCount(row.server_error_requests_today);
    const rowLatencyBuckets = parseCountMap(row.latency_buckets_today);
    const outcomeSummary = buildOutcomeSummary(requestsToday, successfulToday, clientErrorsToday, serverErrorsToday);

    totalRequests += requestsToday;
    successful += successfulToday;
    clientErrors += clientErrorsToday;
    serverErrors += serverErrorsToday;
    totalLatencyMs += parseCount(row.total_latency_ms_today);
    latencyBuckets = mergeCountMaps(latencyBuckets, rowLatencyBuckets);

    return {
      id: row.id,
      prefix: row.prefix,
      label: row.label,
      agentId: row.agent_id,
      agentWalletEvm: row.agent_wallet_evm,
      agentWalletSol: row.agent_wallet_sol,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      totalRequests: parseCount(row.total_requests),
      activeToday: requestsToday > 0,
      requestsToday,
      successfulToday,
      failedToday: outcomeSummary.failed,
      clientErrorsToday,
      serverErrorsToday,
      successRatePctToday: outcomeSummary.successRatePct,
      failureRatePctToday: outcomeSummary.failureRatePct,
      latencyToday: buildLatencySummary(requestsToday, parseCount(row.total_latency_ms_today), rowLatencyBuckets),
    };
  });

  return {
    summary: buildSingleUserSummary({
      matchedKeys: keys.length,
      totalRequests,
      successful,
      clientErrors,
      serverErrors,
      totalLatencyMs,
      latencyBuckets,
    }),
    keys,
    apiKeys: buildApiKeysRecord(keys),
  };
}

async function getFilteredAllTimeUserStats(filter: { agentId: string | null; agentWalletEvm: string | null }): Promise<{ summary: ApiStatsSingleUserSummary; keys: ApiAllTimeUserItem[]; apiKeys: Record<string, ApiAllTimeUserItem> }> {
  await ensureDatabaseReady();
  const where = buildApiKeyWhereClause(filter, "k", 1);
  const result = await getPool().query<{
    id: string;
    prefix: string;
    label: string | null;
    agent_id: string | null;
    agent_wallet_evm: string | null;
    agent_wallet_sol: string | null;
    created_at: Date | string;
    last_used_at: Date | string | null;
    total_requests: string;
    successful_requests: string | null;
    client_error_requests: string | null;
    server_error_requests: string | null;
    total_latency_ms: string | null;
    latency_buckets: Record<string, number> | string | null;
  }>(
    `
      SELECT
        k.id,
        k.prefix,
        k.label,
        k.agent_id,
        k.agent_wallet_evm,
        k.agent_wallet_sol,
        k.created_at,
        k.last_used_at,
        k.total_requests,
        stats.successful_requests,
        stats.client_error_requests,
        stats.server_error_requests,
        stats.total_latency_ms,
        stats.latency_buckets
      FROM api_keys k
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(d.successful_requests), 0)::text AS successful_requests,
          COALESCE(SUM(d.client_error_requests), 0)::text AS client_error_requests,
          COALESCE(SUM(d.server_error_requests), 0)::text AS server_error_requests,
          COALESCE(SUM(d.total_latency_ms), 0)::text AS total_latency_ms,
          COALESCE((
            SELECT jsonb_object_agg(merged.key, to_jsonb(merged.value_sum))
            FROM (
              SELECT bucket.key, SUM(bucket.value::bigint) AS value_sum
              FROM api_daily_key_stats d2
              CROSS JOIN LATERAL jsonb_each_text(COALESCE(d2.latency_buckets, '{}'::jsonb)) AS bucket(key, value)
              WHERE d2.api_key_id = k.id
              GROUP BY bucket.key
            ) merged
          ), '{}'::jsonb) AS latency_buckets
        FROM api_daily_key_stats d
        WHERE d.api_key_id = k.id
      ) stats ON true
      ${where.clause}
      ORDER BY k.total_requests DESC, k.created_at DESC
    `,
    where.params,
  );

  let totalRequests = 0;
  let successful = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let totalLatencyMs = 0;
  let latencyBuckets: Record<string, number> = {};

  const keys = result.rows.map((row) => {
    const parsedTotalRequests = parseCount(row.total_requests);
    const parsedSuccessful = parseCount(row.successful_requests);
    const parsedClientErrors = parseCount(row.client_error_requests);
    const parsedServerErrors = parseCount(row.server_error_requests);
    const rowLatencyBuckets = parseCountMap(row.latency_buckets);
    const outcomeSummary = buildOutcomeSummary(parsedTotalRequests, parsedSuccessful, parsedClientErrors, parsedServerErrors);

    totalRequests += parsedTotalRequests;
    successful += parsedSuccessful;
    clientErrors += parsedClientErrors;
    serverErrors += parsedServerErrors;
    totalLatencyMs += parseCount(row.total_latency_ms);
    latencyBuckets = mergeCountMaps(latencyBuckets, rowLatencyBuckets);

    return {
      id: row.id,
      prefix: row.prefix,
      label: row.label,
      agentId: row.agent_id,
      agentWalletEvm: row.agent_wallet_evm,
      agentWalletSol: row.agent_wallet_sol,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      totalRequests: parsedTotalRequests,
      successful: parsedSuccessful,
      failed: outcomeSummary.failed,
      clientErrors: parsedClientErrors,
      serverErrors: parsedServerErrors,
      successRatePct: outcomeSummary.successRatePct,
      failureRatePct: outcomeSummary.failureRatePct,
      latency: buildLatencySummary(parsedTotalRequests, parseCount(row.total_latency_ms), rowLatencyBuckets),
    };
  });

  return {
    summary: buildSingleUserSummary({
      matchedKeys: keys.length,
      totalRequests,
      successful,
      clientErrors,
      serverErrors,
      totalLatencyMs,
      latencyBuckets,
    }),
    keys,
    apiKeys: buildApiKeysRecord(keys),
  };
}

function buildApiStatsVolume(volumes: Record<TrackedVolumeChain, VolumeCounterSnapshot>): ApiStatsVolume {
  const chains = {
    eth: {
      unit: "wei" as const,
      symbol: "ETH" as const,
      buyRaw: volumes.eth.buyRaw,
      sellRaw: volumes.eth.sellRaw,
      buyNative: formatUnits(volumes.eth.buyRaw, 18),
      sellNative: formatUnits(volumes.eth.sellRaw, 18),
      totalRaw: (BigInt(volumes.eth.buyRaw) + BigInt(volumes.eth.sellRaw)).toString(),
      totalNative: formatUnits((BigInt(volumes.eth.buyRaw) + BigInt(volumes.eth.sellRaw)).toString(), 18),
      buyCount: volumes.eth.buyCount,
      sellCount: volumes.eth.sellCount,
      totalCount: volumes.eth.buyCount + volumes.eth.sellCount,
    },
    base: {
      unit: "wei" as const,
      symbol: "ETH" as const,
      buyRaw: volumes.base.buyRaw,
      sellRaw: volumes.base.sellRaw,
      buyNative: formatUnits(volumes.base.buyRaw, 18),
      sellNative: formatUnits(volumes.base.sellRaw, 18),
      totalRaw: (BigInt(volumes.base.buyRaw) + BigInt(volumes.base.sellRaw)).toString(),
      totalNative: formatUnits((BigInt(volumes.base.buyRaw) + BigInt(volumes.base.sellRaw)).toString(), 18),
      buyCount: volumes.base.buyCount,
      sellCount: volumes.base.sellCount,
      totalCount: volumes.base.buyCount + volumes.base.sellCount,
    },
    bsc: {
      unit: "wei" as const,
      symbol: "BNB" as const,
      buyRaw: volumes.bsc.buyRaw,
      sellRaw: volumes.bsc.sellRaw,
      buyNative: formatUnits(volumes.bsc.buyRaw, 18),
      sellNative: formatUnits(volumes.bsc.sellRaw, 18),
      totalRaw: (BigInt(volumes.bsc.buyRaw) + BigInt(volumes.bsc.sellRaw)).toString(),
      totalNative: formatUnits((BigInt(volumes.bsc.buyRaw) + BigInt(volumes.bsc.sellRaw)).toString(), 18),
      buyCount: volumes.bsc.buyCount,
      sellCount: volumes.bsc.sellCount,
      totalCount: volumes.bsc.buyCount + volumes.bsc.sellCount,
    },
    sol: {
      unit: "lamports" as const,
      symbol: "SOL" as const,
      buyRaw: volumes.sol.buyRaw,
      sellRaw: volumes.sol.sellRaw,
      buyNative: formatUnits(volumes.sol.buyRaw, 9),
      sellNative: formatUnits(volumes.sol.sellRaw, 9),
      totalRaw: (BigInt(volumes.sol.buyRaw) + BigInt(volumes.sol.sellRaw)).toString(),
      totalNative: formatUnits((BigInt(volumes.sol.buyRaw) + BigInt(volumes.sol.sellRaw)).toString(), 9),
      buyCount: volumes.sol.buyCount,
      sellCount: volumes.sol.sellCount,
      totalCount: volumes.sol.buyCount + volumes.sol.sellCount,
    },
  };

  return {
    chains,
    buyCount: TRACKED_VOLUME_CHAINS.reduce((sum, chain) => sum + volumes[chain].buyCount, 0),
    sellCount: TRACKED_VOLUME_CHAINS.reduce((sum, chain) => sum + volumes[chain].sellCount, 0),
    totalCount: TRACKED_VOLUME_CHAINS.reduce((sum, chain) => sum + volumes[chain].buyCount + volumes[chain].sellCount, 0),
  };
}

async function getVolumeStats(dayKey: string): Promise<ApiStatsVolume> {
  await ensureDatabaseReady();
  const result = await getPool().query<{
    eth_buy_wei: string;
    eth_sell_wei: string;
    eth_buy_count: string | number;
    eth_sell_count: string | number;
    base_buy_wei: string;
    base_sell_wei: string;
    base_buy_count: string | number;
    base_sell_count: string | number;
    bsc_buy_wei: string;
    bsc_sell_wei: string;
    bsc_buy_count: string | number;
    bsc_sell_count: string | number;
    sol_buy_lamports: string;
    sol_sell_lamports: string;
    sol_buy_count: string | number;
    sol_sell_count: string | number;
  }>(
    `
      SELECT eth_buy_wei, eth_sell_wei, eth_buy_count, eth_sell_count, base_buy_wei, base_sell_wei, base_buy_count, base_sell_count, bsc_buy_wei, bsc_sell_wei, bsc_buy_count, bsc_sell_count, sol_buy_lamports, sol_sell_lamports, sol_buy_count, sol_sell_count
      FROM api_daily_stats
      WHERE day_key = $1::date
      LIMIT 1
    `,
    [dayKey],
  );

  const row = result.rows[0];
  return buildApiStatsVolume({
    eth: { buyRaw: row?.eth_buy_wei ?? "0", sellRaw: row?.eth_sell_wei ?? "0", buyCount: parseCount(row?.eth_buy_count), sellCount: parseCount(row?.eth_sell_count) },
    base: { buyRaw: row?.base_buy_wei ?? "0", sellRaw: row?.base_sell_wei ?? "0", buyCount: parseCount(row?.base_buy_count), sellCount: parseCount(row?.base_sell_count) },
    bsc: { buyRaw: row?.bsc_buy_wei ?? "0", sellRaw: row?.bsc_sell_wei ?? "0", buyCount: parseCount(row?.bsc_buy_count), sellCount: parseCount(row?.bsc_sell_count) },
    sol: { buyRaw: row?.sol_buy_lamports ?? "0", sellRaw: row?.sol_sell_lamports ?? "0", buyCount: parseCount(row?.sol_buy_count), sellCount: parseCount(row?.sol_sell_count) },
  });
}

async function getAllTimeVolumeStats(): Promise<ApiAllTimeVolume> {
  const now = Date.now();
  if (allTimeVolumeCache && allTimeVolumeCache.expiresAt > now) {
    return allTimeVolumeCache.value;
  }

  await ensureDatabaseReady();
  const result = await getPool().query<{
    eth_buy_wei: string;
    eth_sell_wei: string;
    eth_buy_count: string;
    eth_sell_count: string;
    base_buy_wei: string;
    base_sell_wei: string;
    base_buy_count: string;
    base_sell_count: string;
    bsc_buy_wei: string;
    bsc_sell_wei: string;
    bsc_buy_count: string;
    bsc_sell_count: string;
    sol_buy_lamports: string;
    sol_sell_lamports: string;
    sol_buy_count: string;
    sol_sell_count: string;
  }>(
    `
      SELECT
        COALESCE(SUM(eth_buy_wei), 0)::text AS eth_buy_wei,
        COALESCE(SUM(eth_sell_wei), 0)::text AS eth_sell_wei,
        COALESCE(SUM(eth_buy_count), 0)::text AS eth_buy_count,
        COALESCE(SUM(eth_sell_count), 0)::text AS eth_sell_count,
        COALESCE(SUM(base_buy_wei), 0)::text AS base_buy_wei,
        COALESCE(SUM(base_sell_wei), 0)::text AS base_sell_wei,
        COALESCE(SUM(base_buy_count), 0)::text AS base_buy_count,
        COALESCE(SUM(base_sell_count), 0)::text AS base_sell_count,
        COALESCE(SUM(bsc_buy_wei), 0)::text AS bsc_buy_wei,
        COALESCE(SUM(bsc_sell_wei), 0)::text AS bsc_sell_wei,
        COALESCE(SUM(bsc_buy_count), 0)::text AS bsc_buy_count,
        COALESCE(SUM(bsc_sell_count), 0)::text AS bsc_sell_count,
        COALESCE(SUM(sol_buy_lamports), 0)::text AS sol_buy_lamports,
        COALESCE(SUM(sol_sell_lamports), 0)::text AS sol_sell_lamports,
        COALESCE(SUM(sol_buy_count), 0)::text AS sol_buy_count,
        COALESCE(SUM(sol_sell_count), 0)::text AS sol_sell_count
      FROM api_daily_stats
    `,
  );

  const row = result.rows[0];
  const baseVolume = buildApiStatsVolume({
    eth: { buyRaw: row?.eth_buy_wei ?? "0", sellRaw: row?.eth_sell_wei ?? "0", buyCount: parseCount(row?.eth_buy_count), sellCount: parseCount(row?.eth_sell_count) },
    base: { buyRaw: row?.base_buy_wei ?? "0", sellRaw: row?.base_sell_wei ?? "0", buyCount: parseCount(row?.base_buy_count), sellCount: parseCount(row?.base_sell_count) },
    bsc: { buyRaw: row?.bsc_buy_wei ?? "0", sellRaw: row?.bsc_sell_wei ?? "0", buyCount: parseCount(row?.bsc_buy_count), sellCount: parseCount(row?.bsc_sell_count) },
    sol: { buyRaw: row?.sol_buy_lamports ?? "0", sellRaw: row?.sol_sell_lamports ?? "0", buyCount: parseCount(row?.sol_buy_count), sellCount: parseCount(row?.sol_sell_count) },
  });
  const pricesUsd = await getCachedNativePricesUsd();
  const totalVolumeUsd = TRACKED_VOLUME_CHAINS.reduce((sum, chain) => {
    const nativeAmount = Number(baseVolume.chains[chain].totalNative);
    if (!Number.isFinite(nativeAmount)) {
      return sum;
    }
    const price = pricesUsd[getPriceKeyForChain(chain)];
    if (price === null) {
      return sum;
    }
    return sum + (nativeAmount * price);
  }, 0);

  const volume: ApiAllTimeVolume = {
    ...baseVolume,
    pricesUsd,
    totalVolumeUsd: formatUsd(totalVolumeUsd),
  };

  allTimeVolumeCache = {
    expiresAt: now + ALL_TIME_VOLUME_CACHE_TTL_MS,
    value: volume,
  };

  return volume;
}

export async function getApiRuntimeStats(): Promise<ApiRuntimeStatsResponse> {
  const metrics = await getTodayMetrics();
  const [requests, users, volume, allTimeRequests, allTimeUsers, allTimeVolume] = await Promise.all([
    getRequestsStats(metrics.dayKey),
    getUsersStats(metrics.dayKey),
    getVolumeStats(metrics.dayKey),
    getAllTimeRequestsStats(),
    getAllTimeUsersStats(),
    getAllTimeVolumeStats(),
  ]);

  return {
    endpoint: "adminStats",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    requests,
    users,
    volume,
    allTime: {
      requests: allTimeRequests,
      users: allTimeUsers,
      volume: allTimeVolume,
    },
  };
}

export async function getStatsOverview(): Promise<ApiStatsOverviewResponse> {
  const full = await getApiRuntimeStats();

  return {
    endpoint: "stats",
    dayKey: full.dayKey,
    startedAt: full.startedAt,
    resetsAt: full.resetsAt,
    requests: {
      total: full.requests.total,
      successful: full.requests.successful,
      failed: full.requests.failed,
      clientErrors: full.requests.clientErrors,
      serverErrors: full.requests.serverErrors,
      successRatePct: full.requests.successRatePct,
      failureRatePct: full.requests.failureRatePct,
      latency: full.requests.latency,
      allTimeTotal: full.allTime.requests.total,
      allTimeSuccessful: full.allTime.requests.successful,
      allTimeFailed: full.allTime.requests.failed,
      allTimeClientErrors: full.allTime.requests.clientErrors,
      allTimeServerErrors: full.allTime.requests.serverErrors,
      allTimeSuccessRatePct: full.allTime.requests.successRatePct,
      allTimeFailureRatePct: full.allTime.requests.failureRatePct,
      allTimeLatency: full.allTime.requests.latency,
    },
    users: {
      totalGenerated: full.users.totalGenerated,
      totalEverUsed: full.users.totalEverUsed,
      activeToday: full.users.activeToday,
      totalAgents: full.users.totalAgents,
      activeAgentsToday: full.users.activeAgentsToday,
    },
    volume: full.volume,
    allTime: full.allTime,
  };
}

export async function getStatsRequests(): Promise<ApiStatsRequestsResponse> {
  const metrics = await getTodayMetrics();
  return {
    endpoint: "statsRequests",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    requests: await getRequestsStats(metrics.dayKey),
    allTime: await getAllTimeRequestsStats(),
  };
}

export async function getStatsUsers(): Promise<ApiStatsUsersResponse> {
  const metrics = await getTodayMetrics();
  return {
    endpoint: "statsUsers",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    users: await getUsersStats(metrics.dayKey),
  };
}

export async function getStatsUser(input: StatsUserFilter): Promise<ApiStatsUserResponse> {
  const metrics = await getTodayMetrics();
  const filter = buildStatsUserFilter(input);
  const [daily, allTime] = await Promise.all([
    getFilteredDailyUserStats(metrics.dayKey, filter),
    getFilteredAllTimeUserStats(filter),
  ]);

  return {
    endpoint: "statsUser",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    filter,
    daily,
    allTime,
  };
}

export async function getStatsAgents(input?: { agentId?: string | null; includeKeys?: boolean }): Promise<ApiStatsAgentsResponse> {
  const metrics = await getTodayMetrics();
  const [users, allTimeUsers] = await Promise.all([
    getUsersStats(metrics.dayKey),
    getAllTimeUsersStats(),
  ]);

  const filterAgentId = input?.agentId?.trim() || null;
  const includeKeys = input?.includeKeys ?? false;
  const dailyAgents = users.agents.filter((agent) => !filterAgentId || agent.agentId === filterAgentId);
  const allTimeAgents = allTimeUsers.agents.filter((agent) => !filterAgentId || agent.agentId === filterAgentId);
  const agentIds = new Set<string>([
    ...dailyAgents.map((agent) => agent.agentId),
    ...allTimeAgents.map((agent) => agent.agentId),
  ]);

  const defaultLatency = { avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const defaultDaily = (agentId: string): ApiStatsAgentItem => ({
    agentId,
    keyCount: 0,
    activeKeysToday: 0,
    totalRequests: 0,
    requestsToday: 0,
    successfulToday: 0,
    failedToday: 0,
    clientErrorsToday: 0,
    serverErrorsToday: 0,
    successRatePctToday: 0,
    failureRatePctToday: 0,
    latencyToday: defaultLatency,
  });
  const defaultAllTime = (agentId: string): ApiAllTimeAgentItem => ({
    agentId,
    keyCount: 0,
    totalRequests: 0,
    successful: 0,
    failed: 0,
    clientErrors: 0,
    serverErrors: 0,
    successRatePct: 0,
    failureRatePct: 0,
    latency: defaultLatency,
  });

  const agents: ApiStatsAgentAnalyticsItem[] = [...agentIds]
    .sort((left, right) => left.localeCompare(right))
    .map((agentId) => {
      const daily = users.agents.find((agent) => agent.agentId === agentId) ?? defaultDaily(agentId);
      const allTime = allTimeUsers.agents.find((agent) => agent.agentId === agentId) ?? defaultAllTime(agentId);

      return {
        agentId,
        daily,
        allTime,
        ...(includeKeys ? {
          keys: {
            daily: users.items.filter((item) => item.agentId === agentId),
            allTime: allTimeUsers.items.filter((item) => item.agentId === agentId),
          },
        } : {}),
      };
    })
    .sort((left, right) => {
      if (right.allTime.failed !== left.allTime.failed) return right.allTime.failed - left.allTime.failed;
      if (right.allTime.totalRequests !== left.allTime.totalRequests) return right.allTime.totalRequests - left.allTime.totalRequests;
      return left.agentId.localeCompare(right.agentId);
    });

  return {
    endpoint: "statsAgents",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    filter: {
      agentId: filterAgentId,
      includeKeys,
    },
    summary: {
      matchedAgents: agents.length,
      totalAgents: allTimeUsers.totalAgents,
      activeAgentsToday: users.activeAgentsToday,
      totalEverUsedAgents: allTimeUsers.totalEverUsedAgents,
    },
    agents,
  };
}

export async function getStatsVolume(): Promise<ApiStatsVolumeResponse> {
  const metrics = await getTodayMetrics();
  return {
    endpoint: "statsVolume",
    dayKey: metrics.dayKey,
    startedAt: metrics.startedAt,
    resetsAt: metrics.resetsAt,
    volume: await getVolumeStats(metrics.dayKey),
    allTime: await getAllTimeVolumeStats(),
  };
}

export async function getRequests(): Promise<ApiRequestsResponse> {
  return {
    endpoint: "requests",
    requests: await getAllTimeRequestsStats(),
  };
}

export async function getVolume(): Promise<ApiVolumeResponse> {
  const volume = await getAllTimeVolumeStats();
  return {
    endpoint: "volume",
    volume,
  };
}
