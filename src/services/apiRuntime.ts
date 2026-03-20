import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { isNativeIn } from "#lib/evm";
import type {
  ApiKeyGenerateResponse,
  ApiRequestsResponse,
  ApiRuntimeStatsResponse,
  ApiVolumeResponse,
  ApiAllTimeVolume,
  ApiStatsOverviewResponse,
  ApiStatsRequests,
  ApiStatsRequestsResponse,
  ApiStatsUsers,
  ApiStatsUsersResponse,
  ApiStatsUserItem,
  ApiStatsVolume,
  ApiStatsVolumeResponse,
} from "#types/api";

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
  ethVolume: {
    buyWei: string;
    sellWei: string;
    buyCount: number;
    sellCount: number;
  };
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
const ADMIN_PATHS = new Set([
  "/admin/apiKeys/generate",
  "/admin/stats",
  "/admin/stats/requests",
  "/admin/stats/volume",
  "/stats",
  "/stats/requests",
  "/stats/users",
  "/stats/volume",
]);
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
const ALL_TIME_REQUESTS_CACHE_TTL_MS = 5 * 60 * 1000;
const ALL_TIME_VOLUME_CACHE_TTL_MS = 5 * 60 * 1000;

let pool: Pool | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let allTimeRequestsCache: { expiresAt: number; value: ApiStatsRequests } | null = null;
let allTimeVolumeCache: { expiresAt: number; value: ApiStatsVolume } | null = null;

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
    ethVolume: {
      buyWei: "0",
      sellWei: "0",
      buyCount: 0,
      sellCount: 0,
    },
  };
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
        eth_buy_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        eth_sell_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
        eth_buy_count INTEGER NOT NULL DEFAULT 0,
        eth_sell_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_endpoint_stats (
        day_key DATE NOT NULL REFERENCES api_daily_stats(day_key) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        request_count BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day_key, endpoint)
      )
    `,
  );

  await client.query(
    `
      CREATE TABLE IF NOT EXISTS api_daily_key_stats (
        day_key DATE NOT NULL REFERENCES api_daily_stats(day_key) ON DELETE CASCADE,
        api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        request_count BIGINT NOT NULL DEFAULT 0,
        last_used_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day_key, api_key_id)
      )
    `,
  );
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

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  await ensureDatabaseReady();
  const result = await getPool().query<{ id: string; prefix: string }>(
    `
      SELECT id, prefix
      FROM api_keys
      WHERE key_hash = $1
      LIMIT 1
    `,
    [keyHash],
  );
  const match = result.rows[0];
  if (!match) {
    throw new AccessError(401, "Invalid API key.");
  }

  return { id: match.id, prefix: match.prefix };
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
    const normalizedAgentWalletEvm = normalizeNullableText(agentWalletEvm);
    const normalizedAgentWalletSol = normalizeNullableText(agentWalletSol);

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

export async function recordRequestMetric(input: { path: string; statusCode: number; apiKeyId?: string | null }): Promise<void> {
  await withTransaction(async (client) => {
    const metrics = createDailyMetrics();
    await ensureDailyStatsRow(client, metrics);

    const endpoint = input.path || "unknown";
    const statusKey = String(input.statusCode || 0);

    const dailyStats = await client.query<{ status_codes: Record<string, number> | string }>(
      `
        SELECT status_codes
        FROM api_daily_stats
        WHERE day_key = $1::date
        FOR UPDATE
      `,
      [metrics.dayKey],
    );

    const existingStatusCodes = dailyStats.rows[0]?.status_codes;
    const statusCodes = typeof existingStatusCodes === "string"
      ? JSON.parse(existingStatusCodes) as Record<string, number>
      : (existingStatusCodes ?? {});
    statusCodes[statusKey] = (statusCodes[statusKey] ?? 0) + 1;

    await client.query(
      `
        UPDATE api_daily_stats
        SET total_requests = total_requests + 1,
            status_codes = $2::jsonb,
            updated_at = NOW()
        WHERE day_key = $1::date
      `,
      [metrics.dayKey, JSON.stringify(statusCodes)],
    );

    await client.query(
      `
        INSERT INTO api_daily_endpoint_stats (day_key, endpoint, request_count)
        VALUES ($1::date, $2, 1)
        ON CONFLICT (day_key, endpoint)
        DO UPDATE SET
          request_count = api_daily_endpoint_stats.request_count + 1,
          updated_at = NOW()
      `,
      [metrics.dayKey, endpoint],
    );

    if (input.apiKeyId) {
      const usedAt = new Date().toISOString();
      await client.query(
        `
          UPDATE api_keys
          SET last_used_at = $2::timestamptz,
              total_requests = total_requests + 1
          WHERE id = $1
        `,
        [input.apiKeyId, usedAt],
      );

      await client.query(
        `
          INSERT INTO api_daily_key_stats (day_key, api_key_id, request_count, last_used_at)
          VALUES ($1::date, $2, 1, $3::timestamptz)
          ON CONFLICT (day_key, api_key_id)
          DO UPDATE SET
            request_count = api_daily_key_stats.request_count + 1,
            last_used_at = EXCLUDED.last_used_at,
            updated_at = NOW()
        `,
        [metrics.dayKey, input.apiKeyId, usedAt],
      );
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

  await withTransaction(async (client) => {
    const metrics = createDailyMetrics();
    await ensureDailyStatsRow(client, metrics);

    await client.query(
      `
        UPDATE api_daily_stats
        SET eth_buy_wei = eth_buy_wei + $2::numeric,
            eth_sell_wei = eth_sell_wei + $3::numeric,
            eth_buy_count = eth_buy_count + $4,
            eth_sell_count = eth_sell_count + $5,
            updated_at = NOW()
        WHERE day_key = $1::date
      `,
      [
        metrics.dayKey,
        buyWei.toString(),
        sellWei.toString(),
        buyWei > 0n ? 1 : 0,
        sellWei > 0n ? 1 : 0,
      ],
    );
  });
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
    eth_buy_wei: string;
    eth_sell_wei: string;
    eth_buy_count: number | string;
    eth_sell_count: number | string;
  }>(
    `
      SELECT day_key, started_at, resets_at, total_requests, status_codes, eth_buy_wei, eth_sell_wei, eth_buy_count, eth_sell_count
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
    ethVolume: {
      buyWei: row.eth_buy_wei ?? "0",
      sellWei: row.eth_sell_wei ?? "0",
      buyCount: parseCount(row.eth_buy_count),
      sellCount: parseCount(row.eth_sell_count),
    },
  };
}

async function getRequestsStats(dayKey: string): Promise<ApiStatsRequests> {
  await ensureDatabaseReady();
  const [dailyResult, endpointResult] = await Promise.all([
    getPool().query<{ total_requests: string; status_codes: Record<string, number> | string | null }>(
      `SELECT total_requests, status_codes FROM api_daily_stats WHERE day_key = $1::date LIMIT 1`,
      [dayKey],
    ),
    getPool().query<{ endpoint: string; request_count: string }>(
      `SELECT endpoint, request_count FROM api_daily_endpoint_stats WHERE day_key = $1::date ORDER BY request_count DESC, endpoint ASC`,
      [dayKey],
    ),
  ]);

  const daily = dailyResult.rows[0];
  const byEndpoint = Object.fromEntries(
    endpointResult.rows.map((row) => [row.endpoint, parseCount(row.request_count)]),
  );
  const rawStatusCodes = daily?.status_codes;

  return {
    total: parseCount(daily?.total_requests),
    byEndpoint,
    byStatusCode: typeof rawStatusCodes === "string"
      ? JSON.parse(rawStatusCodes) as Record<string, number>
      : (rawStatusCodes ?? {}),
  };
}

async function getAllTimeRequestsStats(): Promise<ApiStatsRequests> {
  const now = Date.now();
  if (allTimeRequestsCache && allTimeRequestsCache.expiresAt > now) {
    return allTimeRequestsCache.value;
  }

  await ensureDatabaseReady();
  const [totalResult, endpointResult, statusResult] = await Promise.all([
    getPool().query<{ total_requests: string }>(
      `SELECT COALESCE(SUM(total_requests), 0)::text AS total_requests FROM api_daily_stats`,
    ),
    getPool().query<{ endpoint: string; request_count: string }>(
      `
        SELECT endpoint, COALESCE(SUM(request_count), 0)::text AS request_count
        FROM api_daily_endpoint_stats
        GROUP BY endpoint
        ORDER BY COALESCE(SUM(request_count), 0) DESC, endpoint ASC
      `,
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
  ]);

  const result = {
    total: parseCount(totalResult.rows[0]?.total_requests),
    byEndpoint: Object.fromEntries(
      endpointResult.rows.map((row) => [row.endpoint, parseCount(row.request_count)]),
    ),
    byStatusCode: Object.fromEntries(
      statusResult.rows.map((row) => [row.status_code, parseCount(row.request_count)]),
    ),
  };

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
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM api_keys) AS total_generated,
          (SELECT COUNT(*) FROM api_keys WHERE total_requests > 0) AS total_ever_used,
          (SELECT COUNT(*) FROM api_daily_key_stats WHERE day_key = $1::date) AS active_today
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
          d.request_count AS requests_today
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
  const items: ApiStatsUserItem[] = itemsResult.rows.map((row) => ({
    id: row.id,
    prefix: row.prefix,
    label: row.label,
    agentId: row.agent_id,
    agentWalletEvm: row.agent_wallet_evm,
    agentWalletSol: row.agent_wallet_sol,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    totalRequests: parseCount(row.total_requests),
    activeToday: parseCount(row.requests_today) > 0,
    requestsToday: parseCount(row.requests_today),
  }));

  return {
    totalGenerated: parseCount(counts?.total_generated),
    totalEverUsed: parseCount(counts?.total_ever_used),
    activeToday: parseCount(counts?.active_today),
    items,
  };
}

async function getVolumeStats(dayKey: string): Promise<ApiStatsVolume> {
  await ensureDatabaseReady();
  const result = await getPool().query<{
    eth_buy_wei: string;
    eth_sell_wei: string;
    eth_buy_count: string | number;
    eth_sell_count: string | number;
  }>(
    `
      SELECT eth_buy_wei, eth_sell_wei, eth_buy_count, eth_sell_count
      FROM api_daily_stats
      WHERE day_key = $1::date
      LIMIT 1
    `,
    [dayKey],
  );

  const row = result.rows[0];
  const buyWei = row?.eth_buy_wei ?? "0";
  const sellWei = row?.eth_sell_wei ?? "0";

  return {
    buyWei,
    sellWei,
    buyEth: formatUnits(buyWei, 18),
    sellEth: formatUnits(sellWei, 18),
    buyCount: parseCount(row?.eth_buy_count),
    sellCount: parseCount(row?.eth_sell_count),
  };
}

async function getAllTimeVolumeStats(): Promise<ApiStatsVolume> {
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
  }>(
    `
      SELECT
        COALESCE(SUM(eth_buy_wei), 0)::text AS eth_buy_wei,
        COALESCE(SUM(eth_sell_wei), 0)::text AS eth_sell_wei,
        COALESCE(SUM(eth_buy_count), 0)::text AS eth_buy_count,
        COALESCE(SUM(eth_sell_count), 0)::text AS eth_sell_count
      FROM api_daily_stats
    `,
  );

  const row = result.rows[0];
  const buyWei = row?.eth_buy_wei ?? "0";
  const sellWei = row?.eth_sell_wei ?? "0";

  const volume = {
    buyWei,
    sellWei,
    buyEth: formatUnits(buyWei, 18),
    sellEth: formatUnits(sellWei, 18),
    buyCount: parseCount(row?.eth_buy_count),
    sellCount: parseCount(row?.eth_sell_count),
  };

  allTimeVolumeCache = {
    expiresAt: now + ALL_TIME_VOLUME_CACHE_TTL_MS,
    value: volume,
  };

  return volume;
}

function summarizeAllTimeVolume(volume: ApiStatsVolume): ApiAllTimeVolume {
  const totalWei = (BigInt(volume.buyWei) + BigInt(volume.sellWei)).toString();
  return {
    ...volume,
    totalWei,
    totalEth: formatUnits(totalWei, 18),
    totalCount: volume.buyCount + volume.sellCount,
  };
}

export async function getApiRuntimeStats(): Promise<ApiRuntimeStatsResponse> {
  const metrics = await getTodayMetrics();
  const [requests, users, volume, allTimeRequests, allTimeVolume] = await Promise.all([
    getRequestsStats(metrics.dayKey),
    getUsersStats(metrics.dayKey),
    getVolumeStats(metrics.dayKey),
    getAllTimeRequestsStats(),
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
      allTimeTotal: full.allTime.requests.total,
    },
    users: {
      totalGenerated: full.users.totalGenerated,
      totalEverUsed: full.users.totalEverUsed,
      activeToday: full.users.activeToday,
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
    volume: summarizeAllTimeVolume(volume),
  };
}