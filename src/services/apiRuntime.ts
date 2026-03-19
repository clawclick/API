import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { isNativeIn } from "#lib/evm";
import type { ApiKeyGenerateResponse, ApiRuntimeStatsResponse } from "#types/api";

type StoredApiKey = {
  id: string;
  label: string | null;
  prefix: string;
  keyHash: string;
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
  ethVolume: {
    buyWei: string;
    sellWei: string;
    buyCount: number;
    sellCount: number;
  };
};

type RuntimeState = {
  version: 1;
  apiKeys: StoredApiKey[];
  metrics: DailyMetrics;
};

type ResolvedApiKey = {
  id: string;
  prefix: string;
};

export class AccessError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AccessError";
    this.statusCode = statusCode;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/providers"]);
const ADMIN_PATHS = new Set(["/admin/apiKeys/generate", "/admin/stats"]);
const PROTECTED_PREFIXES = [
  "/tokenPoolInfo",
  "/tokenPriceHistory",
  "/priceHistoryIndicators",
  "/detailedTokenStats",
  "/isScam",
  "/fullAudit",
  "/holderAnalysis",
  "/holders",
  "/fudSearch",
  "/marketOverview",
  "/walletReview",
  "/swap",
  "/swapQuote",
  "/swapDexes",
  "/approve",
  "/unwrap",
  "/trendingTokens",
  "/newPairs",
  "/topTraders",
  "/gasFeed",
  "/tokenSearch",
  "/tokenHolders",
  "/filterTokens",
  "/volatilityScanner",
  "/strats",
  "/ws/launchpadEvents",
  "/admin/",
];

const STATS_ROW_KEY = "global";
let pool: Pool | null = null;
let databaseReadyPromise: Promise<void> | null = null;

function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getNextResetAt(date = new Date()): string {
  const resetAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return resetAt.toISOString();
}

function createDailyMetrics(date = new Date()): DailyMetrics {
  return {
    dayKey: getDayKey(date),
    startedAt: date.toISOString(),
    resetsAt: getNextResetAt(date),
    totalRequests: 0,
    requestsByEndpoint: {},
    statusCodes: {},
    ethVolume: {
      buyWei: "0",
      sellWei: "0",
      buyCount: 0,
      sellCount: 0,
    },
  };
}

function createDefaultState(): RuntimeState {
  return {
    version: 1,
    apiKeys: [],
    metrics: createDailyMetrics(),
  };
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function normalizeState(state: RuntimeState): RuntimeState {
  const normalized = state.version === 1 ? state : createDefaultState();
  if (normalized.metrics.dayKey !== getDayKey()) {
    normalized.metrics = createDailyMetrics();
  }
  return normalized;
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

async function ensureStateTable(client: Pool | PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "ApiStats" (
      key TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureStateRow(client: Pool | PoolClient): Promise<void> {
  await client.query(
    `
      INSERT INTO "ApiStats" (key, state)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key) DO NOTHING
    `,
    [STATS_ROW_KEY, JSON.stringify(createDefaultState())],
  );
}

async function ensureDatabaseReady(): Promise<void> {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      const db = getPool();
      await ensureStateTable(db);
      await ensureStateRow(db);
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }

  await databaseReadyPromise;
}

function parseStoredState(value: unknown): RuntimeState {
  if (!value) {
    return createDefaultState();
  }

  if (typeof value === "string") {
    return normalizeState(JSON.parse(value) as RuntimeState);
  }

  return normalizeState(value as RuntimeState);
}

async function loadState(): Promise<RuntimeState> {
  await ensureDatabaseReady();
  const result = await getPool().query<{ state: unknown }>(
    `SELECT state FROM "ApiStats" WHERE key = $1 LIMIT 1`,
    [STATS_ROW_KEY],
  );
  return parseStoredState(result.rows[0]?.state);
}

async function mutateState<T>(mutator: (state: RuntimeState) => Promise<T> | T): Promise<T> {
  await ensureDatabaseReady();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await ensureStateRow(client);

    const result = await client.query<{ state: unknown }>(
      `SELECT state FROM "ApiStats" WHERE key = $1 FOR UPDATE`,
      [STATS_ROW_KEY],
    );

    const state = parseStoredState(result.rows[0]?.state);
    const output = await mutator(state);
    const normalized = normalizeState(state);

    await client.query(
      `
        UPDATE "ApiStats"
        SET state = $2::jsonb,
            updated_at = NOW()
        WHERE key = $1
      `,
      [STATS_ROW_KEY, JSON.stringify(normalized)],
    );

    await client.query("COMMIT");
    return output;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function classifyPath(pathname: string): "public" | "admin" | "protected" | "unknown" {
  if (PUBLIC_PATHS.has(pathname)) {
    return "public";
  }
  if (ADMIN_PATHS.has(pathname)) {
    return "admin";
  }
  if (isProtectedPath(pathname)) {
    return "protected";
  }
  return "unknown";
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

export async function requireApiKey(headers: Record<string, unknown>): Promise<ResolvedApiKey> {
  const presented = getPresentedApiKey(headers);
  if (!presented) {
    throw new AccessError(401, "Missing API key. Send x-api-key or Authorization: Bearer <key>.");
  }

  const keyHash = hashApiKey(presented);
  const state = await loadState();
  const match = state.apiKeys.find((item) => item.keyHash === keyHash);
  if (!match) {
    throw new AccessError(401, "Invalid API key.");
  }

  return { id: match.id, prefix: match.prefix };
}

export async function generateApiKey(label?: string | null): Promise<ApiKeyGenerateResponse> {
  return mutateState((state) => {
    const now = new Date().toISOString();
    const apiKey = `ska_${randomBytes(24).toString("hex")}`;
    const prefix = apiKey.slice(0, 12);
    const record: StoredApiKey = {
      id: randomBytes(12).toString("hex"),
      label: label?.trim() ? label.trim() : null,
      prefix,
      keyHash: hashApiKey(apiKey),
      createdAt: now,
      lastUsedAt: null,
      lastUsedDay: null,
      totalRequests: 0,
    };

    state.apiKeys.push(record);

    const activeToday = state.apiKeys.filter((item) => item.lastUsedDay === state.metrics.dayKey).length;
    return {
      endpoint: "apiKeyGenerate",
      apiKey,
      keyId: record.id,
      prefix: record.prefix,
      label: record.label,
      createdAt: record.createdAt,
      totalGenerated: state.apiKeys.length,
      activeToday,
    };
  });
}

export async function recordRequestMetric(input: { path: string; statusCode: number; apiKeyId?: string | null }): Promise<void> {
  await mutateState((state) => {
    const endpoint = input.path || "unknown";
    state.metrics.totalRequests += 1;
    state.metrics.requestsByEndpoint[endpoint] = (state.metrics.requestsByEndpoint[endpoint] ?? 0) + 1;
    const statusKey = String(input.statusCode || 0);
    state.metrics.statusCodes[statusKey] = (state.metrics.statusCodes[statusKey] ?? 0) + 1;

    if (input.apiKeyId) {
      const record = state.apiKeys.find((item) => item.id === input.apiKeyId);
      if (record) {
        record.lastUsedAt = new Date().toISOString();
        record.lastUsedDay = state.metrics.dayKey;
        record.totalRequests += 1;
      }
    }
  });
}

export async function recordEthSwapVolume(input: { chain: string; tokenIn: string; tokenOut: string; buyWei?: string | null; sellWei?: string | null }): Promise<void> {
  if (input.chain !== "eth") {
    return;
  }

  const buyWei = input.buyWei && isNativeIn(input.tokenIn) && !isNativeIn(input.tokenOut) ? BigInt(input.buyWei) : 0n;
  const sellWei = input.sellWei && !isNativeIn(input.tokenIn) && isNativeIn(input.tokenOut) ? BigInt(input.sellWei) : 0n;
  if (buyWei === 0n && sellWei === 0n) {
    return;
  }

  await mutateState((state) => {
    if (buyWei > 0n) {
      state.metrics.ethVolume.buyWei = (BigInt(state.metrics.ethVolume.buyWei) + buyWei).toString();
      state.metrics.ethVolume.buyCount += 1;
    }
    if (sellWei > 0n) {
      state.metrics.ethVolume.sellWei = (BigInt(state.metrics.ethVolume.sellWei) + sellWei).toString();
      state.metrics.ethVolume.sellCount += 1;
    }
  });
}

export async function getApiRuntimeStats(): Promise<ApiRuntimeStatsResponse> {
  const state = await loadState();
  const activeToday = state.apiKeys.filter((item) => item.lastUsedDay === state.metrics.dayKey);
  const everUsed = state.apiKeys.filter((item) => item.totalRequests > 0);
  const byEndpoint = Object.fromEntries(
    Object.entries(state.metrics.requestsByEndpoint).sort((a, b) => b[1] - a[1]),
  );

  return {
    endpoint: "adminStats",
    dayKey: state.metrics.dayKey,
    startedAt: state.metrics.startedAt,
    resetsAt: state.metrics.resetsAt,
    requests: {
      total: state.metrics.totalRequests,
      byEndpoint,
      byStatusCode: state.metrics.statusCodes,
    },
    ethVolume: {
      buyWei: state.metrics.ethVolume.buyWei,
      sellWei: state.metrics.ethVolume.sellWei,
      buyEth: formatUnits(state.metrics.ethVolume.buyWei, 18),
      sellEth: formatUnits(state.metrics.ethVolume.sellWei, 18),
      buyCount: state.metrics.ethVolume.buyCount,
      sellCount: state.metrics.ethVolume.sellCount,
    },
    apiKeys: {
      totalGenerated: state.apiKeys.length,
      totalEverUsed: everUsed.length,
      activeToday: activeToday.length,
      items: state.apiKeys.map((item) => ({
        id: item.id,
        prefix: item.prefix,
        label: item.label,
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt,
        totalRequests: item.totalRequests,
        activeToday: item.lastUsedDay === state.metrics.dayKey,
      })),
    },
  };
}