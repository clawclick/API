# Super API — Unified Crypto Intelligence API

A single Fastify server that aggregates 50+ crypto data providers behind clean REST endpoints (and one WebSocket stream). Designed for AI agents and trading bots.

**Base URL:** `http://localhost:3000`

---

## Adding a New Endpoint

Every new endpoint touches these files, in order:

| Step | File | What to do |
|------|------|------------|
| 1 | `src/types/domain.ts` | Add the name to the `EndpointName` union type |
| 2 | `src/services/providerRegistry.ts` | Add the endpoint name to each provider's `endpoints` array (or add a new provider entry) |
| 3 | `src/services/endpointContracts.ts` | Add an entry to both the `descriptions` and `cacheHints` `Record<EndpointName, …>` maps |
| 4 | `src/types/api.ts` | Define the response type |
| 5 | `src/routes/helpers.ts` | Create a Zod schema for query-param validation |
| 6 | `src/services/<name>.ts` | Implement the service function (call providers, aggregate, return response) |
| 7 | `src/routes/index.ts` | Register the route (`app.get(…)`) and import the service + schema |
| 8 | Provider folder (`Market_data/**/provider.ts`, etc.) | Write the adapter that calls the external API and normalizes the data |
| 9 | `.env` / `.env.example` | Add any new API keys |
| 10 | `README.md` | Document the endpoint below |

### Checklist (copy-paste for PRs)

```
☐ EndpointName union        (src/types/domain.ts)
☐ Provider registry         (src/services/providerRegistry.ts)
☐ Description + cacheHint   (src/services/endpointContracts.ts)
☐ Response type              (src/types/api.ts)
☐ Zod query schema           (src/routes/helpers.ts)
☐ Service function           (src/services/<name>.ts)
☐ Route registration         (src/routes/index.ts)
☐ Provider adapter           (<Category>/<Provider>/provider.ts)
☐ Env vars                   (.env / .env.example)
☐ README docs                (README.md)
```

> **providerHealth is automatic** — once a provider lists the new endpoint in step 2, `GET /providers` will report its status with no extra code.

---

## Quick Start

```bash
cp .env.example .env   # fill in your API keys
npm install
npx tsx src/server.ts   # starts on port 3000
```
---

## Endpoints Overview

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/providers` | GET | List all 50+ providers and their config status |
| `/admin/apiKeys/generate` | POST | Generate a new client API key |
| `/admin/apiKeys` | DELETE | Delete an existing client API key by id |
| `/admin/stats` | GET | Full daily analytics snapshot for admins |
| `/admin/stats/requests` | GET | Daily request totals by endpoint and status |
| `/admin/stats/users` | GET | API key issuance and usage totals |
| `/admin/stats/user` | GET | Filtered single-user analytics by `agentId` and/or `agentWalletEvm` |
| `/admin/stats/agents` | GET | Per-agent request quality and latency analytics |
| `/admin/stats/volume` | GET | Daily ETH buy/sell volume counters |
| `/tokenPoolInfo` | GET | Token price, market cap, liquidity, pair info |
| `/tokenPriceHistory` | GET | Historical OHLCV price data |
| `/rateMyEntry` | GET | Score whether a token is a good swing-trade entry right now (1 call per API key every 30 min) |
| `/detailedTokenStats` | GET | Bucketed token stats from Codex (cached 30 min) |
| `/isScam` | GET | Quick scam check with risk score |
| `/fullAudit` | GET | Deep contract audit (taxes, ownership, trading flags) |
| `/holderAnalysis` | GET | Holder distribution, concentration, whale tracking |
| `/holders` | GET | Top holder rows for a token (Moralis on EVM, RPC on Solana) |
| `/fudSearch` | GET | Search social mentions for FUD signals |
| `/marketOverview` | GET | Combined sentiment + pool + risk overview |
| `/walletReview` | GET | Wallet PnL, holdings, protocols, activity, approvals |
| `/approve` | GET | Build unsigned approval txs for router, fee wrapper, or Permit2 flows |
| `/swap` | GET | Build unsigned swap transaction |
| `/swapQuote` | GET | Get swap quote (amount out) |
| `/swapDexes` | GET | List available DEXes for a chain |
| `/unwrap` | GET | Build unsigned wrapped-native withdraw tx |
| `/trendingTokens` | GET | Currently trending tokens |
| `/getTopEthTokens` | GET | Top Ethereum tokens from Ethplorer (cached 10 min) |
| `/getNewEthTradableTokens` | GET | New tradable Ethereum tokens from Ethplorer (cached 10 min) |
| `/newPairs` | GET | Recently created pairs/pools |
| `/topTraders` | GET | Top traders for a token (multi-chain via Birdeye) |
| `/gasFeed` | GET | Current gas prices (EVM chains) |
| `/tokenSearch` | GET | Search tokens by name/symbol/address |
| `/filterTokens` | GET | Filter tokens by metrics (Codex, cached 5 min) |
| `/tokenHolders` | GET | Raw token-holder ledger for EVM and Solana tokens |
| `/volatilityScanner` | GET | Swing-trade volatility scanner (cached 5 min) |
| `/priceHistoryIndicators` | GET | OHLCV + technical indicators + aggregate signal (cached 60s) |
| `/strats` | GET | List available strategy guides |
| `/strats/:id` | GET | Fetch a strategy guide (markdown) |
| `/ws/launchpadEvents` | WS | Real-time launchpad token event stream |
| `/ws/agentStats` | WS | Live rolling 60-minute request and latency stats per agentId |

---

## Supported Chains

| Chain | ID | Notes |
|---|---|---|
| `eth` / `ethereum` | 1 | Full support |
| `base` | 8453 | Full support |
| `bsc` / `bnb` | 56 | Full support |
| `sol` / `solana` | — | Full support (non-EVM) |

---

## Common Response Shape

Every endpoint returns a JSON object with:

```json
{
  "endpoint": "endpointName",
  "status": "live" | "partial",
  "providers": [
    { "provider": "providerName", "status": "ok" | "skipped" | "error", "detail": "..." }
  ]
}
```

- **`live`**: All providers returned data.
- **`partial`**: Some providers were skipped or errored, but usable data was returned.
- **`providers`**: Shows which data sources contributed and their individual status.

---

## Auth

Most data endpoints require a client API key.

- Client auth: `x-api-key: <key>` or `Authorization: Bearer <key>`
- Admin auth: `x-admin-key: <ADMIN_API_KEY>`
- Client rate limits: `5 req/sec`, `120 req/min`, `3000 req/hour` per API key
- Public endpoints:
  - `/health`
  - `/providers`

---

### `POST /admin/apiKeys/generate`

Generate a new client API key. Admin-only endpoint.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | string | no | — | Optional label for the issued key |
| `agentId` | string | no | — | Optional agent identifier to attach to the key |
| `agentWalletEvm` | string | no | — | Optional EVM wallet address to attach to the key |
| `agentWalletSol` | string | no | — | Optional Solana wallet address to attach to the key |

```
POST /admin/apiKeys/generate?label=trading-bot&agentId=arb-bot-01&agentWalletEvm=0x1234...&agentWalletSol=So1111...
```

**Response:**
```json
{
  "endpoint": "apiKeyGenerate",
  "apiKey": "click_...",
  "keyId": "...",
  "prefix": "click_abcd12",
  "label": "trading-bot",
  "agentId": "arb-bot-01",
  "agentWalletEvm": "0x1234...",
  "agentWalletSol": "So1111...",
  "createdAt": "2026-03-19T00:00:00.000Z",
  "totalGenerated": 3,
  "activeToday": 1
}
```

If `agentWalletEvm` or `agentWalletSol` already has a key attached, the endpoint returns `409 Conflict`. Only one active key can exist per wallet address.

---

### `DELETE /admin/apiKeys`

Delete an existing client API key by id. Admin-only endpoint.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

| Param | Type | Required | Description |
|---|---|---|---|
| `keyId` | string | yes | The internal API key id returned at generation time |

```
DELETE /admin/apiKeys?keyId=abc123
```

**Response:**
```json
{
  "endpoint": "apiKeyDelete",
  "keyId": "abc123",
  "prefix": "click_abcd12",
  "label": "trading-bot",
  "agentId": "arb-bot-01",
  "agentWalletEvm": "0x1234...",
  "agentWalletSol": null,
  "createdAt": "2026-03-19T00:00:00.000Z",
  "lastUsedAt": "2026-03-20T13:10:00.000Z",
  "totalRequests": 421,
  "deletedAt": "2026-03-21T08:45:00.000Z"
}
```

---

### `GET /admin/stats`

Admin summary endpoint. Returns the current UTC-day totals plus all-time request, user, agent, and ETH volume aggregates.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

```
GET /admin/stats
```

**Response:**
```json
{
  "endpoint": "stats",
  "dayKey": "2026-03-19",
  "requests": {
    "total": 1240,
    "successful": 1218,
    "failed": 22,
    "clientErrors": 14,
    "serverErrors": 8,
    "successRatePct": 98.23,
    "failureRatePct": 1.77,
    "latency": { "avgMs": 142.6, "p50Ms": 100, "p95Ms": 500, "p99Ms": 1000 },
    "allTimeTotal": 98765,
    "allTimeSuccessful": 98000,
    "allTimeFailed": 765,
    "allTimeClientErrors": 500,
    "allTimeServerErrors": 265,
    "allTimeSuccessRatePct": 99.23,
    "allTimeFailureRatePct": 0.77,
    "allTimeLatency": { "avgMs": 188.2, "p50Ms": 100, "p95Ms": 1000, "p99Ms": 2000 }
  },
  "users": { "totalGenerated": 12, "totalEverUsed": 9, "activeToday": 4 },
  "volume": {
    "buyWei": "1000000000000000000",
    "sellWei": "500000000000000000",
    "buyEth": "1",
    "sellEth": "0.5",
    "buyCount": 3,
    "sellCount": 2
  },
  "allTime": {
    "requests": {
      "total": 98765,
      "byEndpoint": { "/holders": 25000, "/swap": 12000 },
      "byStatusCode": { "200": 98000, "400": 500, "500": 265 }
    },
    "users": {
      "totalGenerated": 12,
      "totalEverUsed": 9,
      "totalAgents": 3,
      "totalEverUsedAgents": 3,
      "agents": [
        {
          "agentId": "scanner-alpha",
          "keyCount": 2,
          "totalRequests": 18200,
          "successful": 17610,
          "failed": 590,
          "clientErrors": 410,
          "serverErrors": 180,
          "successRatePct": 96.76,
          "failureRatePct": 3.24,
          "latency": { "avgMs": 201.7, "p50Ms": 100, "p95Ms": 1000, "p99Ms": 2000 }
        }
      ],
      "items": [
        {
          "id": "6295b1195cefddaa6fc02bbf",
          "prefix": "click_30f0a1",
          "label": "test-client",
          "agentId": "scanner-alpha",
          "agentWalletEvm": null,
          "agentWalletSol": null,
          "createdAt": "2026-03-19T01:48:44.465Z",
          "lastUsedAt": "2026-03-19T03:12:18.110Z",
          "totalRequests": 9400,
          "successful": 9110,
          "failed": 290,
          "clientErrors": 210,
          "serverErrors": 80,
          "successRatePct": 96.91,
          "failureRatePct": 3.09,
          "latency": { "avgMs": 189.4, "p50Ms": 100, "p95Ms": 1000, "p99Ms": 2000 }
        }
      ]
    },
    "volume": {
      "buyWei": "123000000000000000000",
      "sellWei": "45000000000000000000",
      "buyEth": "123",
      "sellEth": "45",
      "buyCount": 120,
      "sellCount": 44
    }
  }
}
```

### `GET /admin/stats/requests`

Admin-only request analytics for the current UTC day, plus a matching all-time breakdown.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

```
GET /admin/stats/requests
```

**Response:**
```json
{
  "endpoint": "statsRequests",
  "dayKey": "2026-03-19",
  "startedAt": "2026-03-19T00:00:00.000Z",
  "resetsAt": "2026-03-20T00:00:00.000Z",
  "requests": {
    "total": 1240,
    "successful": 1218,
    "failed": 22,
    "clientErrors": 14,
    "serverErrors": 8,
    "successRatePct": 98.23,
    "failureRatePct": 1.77,
    "latency": { "avgMs": 142.6, "p50Ms": 100, "p95Ms": 500, "p99Ms": 1000 },
    "byEndpoint": { "/holders": 240, "/swap": 120 },
    "byStatusCode": { "200": 1218, "400": 14, "500": 8 },
    "endpointBreakdown": [
      {
        "key": "/holders",
        "total": 240,
        "successful": 236,
        "failed": 4,
        "clientErrors": 3,
        "serverErrors": 1,
        "successRatePct": 98.33,
        "failureRatePct": 1.67,
        "latency": { "avgMs": 121.4, "p50Ms": 100, "p95Ms": 250, "p99Ms": 500 }
      }
    ],
    "providers": [
      {
        "provider": "moralisOwners",
        "total": 120,
        "successful": 118,
        "failed": 2,
        "clientErrors": 1,
        "serverErrors": 1,
        "successRatePct": 98.33,
        "failureRatePct": 1.67,
        "latency": { "avgMs": 241.1, "p50Ms": 250, "p95Ms": 1000, "p99Ms": 2000 },
        "endpoints": [
          {
            "key": "/holders",
            "total": 90,
            "successful": 89,
            "failed": 1,
            "clientErrors": 1,
            "serverErrors": 0,
            "successRatePct": 98.89,
            "failureRatePct": 1.11,
            "latency": { "avgMs": 215.8, "p50Ms": 250, "p95Ms": 500, "p99Ms": 1000 }
          }
        ]
      }
    ]
  },
  "allTime": {
    "total": 98765,
    "successful": 98000,
    "failed": 765,
    "clientErrors": 500,
    "serverErrors": 265,
    "successRatePct": 99.23,
    "failureRatePct": 0.77,
    "latency": { "avgMs": 188.2, "p50Ms": 100, "p95Ms": 1000, "p99Ms": 2000 },
    "byEndpoint": { "/holders": 25000, "/swap": 12000 },
    "byStatusCode": { "200": 98000, "400": 500, "500": 265 },
    "endpointBreakdown": [
      {
        "key": "/holders",
        "total": 25000,
        "successful": 24880,
        "failed": 120,
        "clientErrors": 90,
        "serverErrors": 30,
        "successRatePct": 99.52,
        "failureRatePct": 0.48,
        "latency": { "avgMs": 121.4, "p50Ms": 100, "p95Ms": 250, "p99Ms": 500 }
      }
    ],
    "providers": [
      {
        "provider": "moralisOwners",
        "total": 12000,
        "successful": 11820,
        "failed": 180,
        "clientErrors": 120,
        "serverErrors": 60,
        "successRatePct": 98.5,
        "failureRatePct": 1.5,
        "latency": { "avgMs": 241.1, "p50Ms": 250, "p95Ms": 1000, "p99Ms": 2000 },
        "endpoints": [
          {
            "key": "/holders",
            "total": 9000,
            "successful": 8870,
            "failed": 130,
            "clientErrors": 100,
            "serverErrors": 30,
            "successRatePct": 98.56,
            "failureRatePct": 1.44,
            "latency": { "avgMs": 215.8, "p50Ms": 250, "p95Ms": 500, "p99Ms": 1000 }
          }
        ]
      }
    ]
  }
}
```

### `GET /admin/stats/users`

Admin-only API-key issuance and usage analytics for the current UTC day, including per-key and per-agent request quality and latency.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

```http
GET /admin/stats/users
```

**Response:**
```json
{
  "endpoint": "statsUsers",
  "dayKey": "2026-03-19",
  "users": {
    "totalGenerated": 12,
    "totalEverUsed": 9,
    "activeToday": 4,
    "totalAgents": 3,
    "activeAgentsToday": 2,
    "agents": [
      {
        "agentId": "scanner-alpha",
        "keyCount": 2,
        "activeKeysToday": 2,
        "totalRequests": 18200,
        "requestsToday": 740,
        "successfulToday": 712,
        "failedToday": 28,
        "clientErrorsToday": 21,
        "serverErrorsToday": 7,
        "successRatePctToday": 96.22,
        "failureRatePctToday": 3.78,
        "latencyToday": { "avgMs": 188.4, "p50Ms": 100, "p95Ms": 500, "p99Ms": 1000 }
      }
    ],
    "items": [
      {
        "id": "6295b1195cefddaa6fc02bbf",
        "prefix": "click_30f0a1",
        "label": "test-client",
        "agentId": "scanner-alpha",
        "agentWalletEvm": null,
        "agentWalletSol": null,
        "createdAt": "2026-03-19T01:48:44.465Z",
        "lastUsedAt": "2026-03-19T03:12:18.110Z",
        "totalRequests": 9400,
        "activeToday": true,
        "requestsToday": 410,
        "successfulToday": 396,
        "failedToday": 14,
        "clientErrorsToday": 11,
        "serverErrorsToday": 3,
        "successRatePctToday": 96.59,
        "failureRatePctToday": 3.41,
        "latencyToday": { "avgMs": 171.8, "p50Ms": 100, "p95Ms": 500, "p99Ms": 1000 }
      }
    ]
  }
}
```

### `GET /admin/stats/agents`

Admin-only agent analytics endpoint for dashboards. Returns daily and all-time request quality and latency per agent, with optional per-key detail.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

```http
GET /admin/stats/agents?agentId=scanner-alpha&includeKeys=true
```

**Response:**
```json
{
  "endpoint": "statsAgents",
  "dayKey": "2026-03-20",
  "filter": {
    "agentId": "scanner-alpha",
    "includeKeys": true
  },
  "summary": {
    "matchedAgents": 1,
    "totalAgents": 3,
    "activeAgentsToday": 2,
    "totalEverUsedAgents": 3
  },
  "agents": [
    {
      "agentId": "scanner-alpha",
      "daily": {
        "agentId": "scanner-alpha",
        "keyCount": 2,
        "activeKeysToday": 2,
        "totalRequests": 18200,
        "requestsToday": 740,
        "successfulToday": 712,
        "failedToday": 28,
        "clientErrorsToday": 21,
        "serverErrorsToday": 7,
        "successRatePctToday": 96.22,
        "failureRatePctToday": 3.78,
        "latencyToday": { "avgMs": 188.4, "p50Ms": 100, "p95Ms": 500, "p99Ms": 1000 }
      },
      "allTime": {
        "agentId": "scanner-alpha",
        "keyCount": 2,
        "totalRequests": 18200,
        "successful": 17610,
        "failed": 590,
        "clientErrors": 410,
        "serverErrors": 180,
        "successRatePct": 96.76,
        "failureRatePct": 3.24,
        "latency": { "avgMs": 201.7, "p50Ms": 100, "p95Ms": 1000, "p99Ms": 2000 }
      },
      "keys": {
        "daily": [],
        "allTime": []
      }
    }
  ]
}
```

### `GET /admin/stats/volume`

Admin-only ETH buy/sell volume counters for the current UTC day, plus matching all-time totals.

**Header:** `x-admin-key: <ADMIN_API_KEY>`

```
GET /admin/stats/volume
```

**Response:**
```json
{
  "endpoint": "statsVolume",
  "dayKey": "2026-03-19",
  "startedAt": "2026-03-19T00:00:00.000Z",
  "resetsAt": "2026-03-20T00:00:00.000Z",
  "volume": {
    "buyWei": "1000000000000000000",
    "sellWei": "500000000000000000",
    "buyEth": "1",
    "sellEth": "0.5",
    "buyCount": 3,
    "sellCount": 2
  },
  "allTime": {
    "buyWei": "123000000000000000000",
    "sellWei": "45000000000000000000",
    "buyEth": "123",
    "sellEth": "45",
    "buyCount": 120,
    "sellCount": 44
  }
}
```

Analytics writes are buffered in memory and flushed to Postgres in batches, currently every 5 minutes or after roughly 100 tracked requests. That keeps normal API requests off the database path, while stats endpoints may reflect a small delay and can take longer because they force a flush before reading.

---

## Endpoint Details

### `GET /health`

Health check.

```
GET /health
```

**Response:**
```json
{ "status": "ok", "service": "super-api" }
```

---

### `GET /providers`

List all registered providers and whether they're configured.

```
GET /providers
```

**Response:**
```json
{
  "providers": [
    { "id": "moralis", "label": "Moralis", "folder": "Alpha_Wallet_tracking/Moralis", "category": "walletTracking", "configured": true },
    { "id": "birdeye", "label": "Birdeye", "folder": "Market_data/LowCaps/Birdeye", "category": "marketData", "configured": true }
  ]
}
```

---

### `GET /tokenPoolInfo`

Get token price, market cap, liquidity, volume, and pool info. DexScreener is primary; Codex `listPairsForToken` is used as a backup source for pair discovery when DexScreener does not return a usable pair.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain to query |
| `tokenAddress` | string | **yes** | — | Token contract address |
| `poolAddress` | string | no | — | Specific pool address |
| `symbol` | string | no | — | Token symbol hint |
| `tokenName` | string | no | — | Token name hint |

```
GET /tokenPoolInfo?chain=eth&tokenAddress=0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
```

**Response:**
```json
{
  "endpoint": "tokenPoolInfo",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "0xA0b86991c...",
  "name": "USD Coin",
  "symbol": "USDC",
  "priceUsd": 1.0001,
  "marketCapUsd": 32000000000,
  "fdvUsd": 32000000000,
  "liquidityUsd": 150000000,
  "volume24hUsd": 5000000000,
  "priceChange24hPct": -0.01,
  "pairAddress": "0x...",
  "dex": "uniswap_v3",
  "providers": [...]
}
```

---

### `GET /tokenPriceHistory`

Historical OHLCV price data for charting. Supports both token contracts and major assets. Primary sources are GeckoTerminal/Birdeye, with Codex `getTokenBars` as an extra OHLCV fallback before Alchemy.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | conditional | — | Token address, or a major symbol like `btc`, `eth`, `sol`, `xrp`, `bnb` |
| `asset` | string | conditional | — | Optional explicit major asset name/symbol |
| `limit` | string | no | `3m` | Time range (`1d`, `7d`, `1m`, `3m`, `1y`) |
| `interval` | string | no | `1d` | Candle interval (`5m`, `15m`, `1h`, `4h`, `1d`) |

```
GET /tokenPriceHistory?chain=sol&tokenAddress=So111...&limit=7d&interval=1h
GET /tokenPriceHistory?chain=eth&tokenAddress=eth&limit=7d&interval=1d
GET /tokenPriceHistory?asset=bitcoin&limit=30d&interval=1d
```

**Response:**
```json
{
  "endpoint": "tokenPriceHistory",
  "status": "live",
  "chain": "sol",
  "tokenAddress": "So111...",
  "currency": "usd",
  "limit": "7d",
  "interval": "1h",
  "points": [
    { "timestamp": 1710000000, "priceUsd": 150.5, "open": 150, "high": 152, "low": 149, "close": 150.5, "volume": 1000000 }
  ],
  "providers": [...]
}
```

---

### `GET /detailedTokenStats`

Bucketed token stats from Codex, cached for 30 minutes. Useful for short-window and multi-window volume, price, liquidity, and trader-count deltas.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |
| `durations` | string | no | `hour1,day1` | Comma-separated durations: `min5`, `hour1`, `hour4`, `hour12`, `day1` |
| `bucketCount` | number | no | `6` | Number of buckets requested from Codex |
| `timestamp` | number | no | — | Optional unix timestamp snapshot |
| `statsType` | string | no | `UNFILTERED` | `FILTERED` or `UNFILTERED` |

```
GET /detailedTokenStats?chain=eth&tokenAddress=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&durations=hour1,day1&bucketCount=6
```

**Response:**
```json
{
  "endpoint": "detailedTokenStats",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "cached": false,
  "bucketCount": 6,
  "statsType": "UNFILTERED",
  "lastTransactionAt": 1773694307,
  "durations": {
    "hour1": {
      "duration": "hour1",
      "start": 1773690707,
      "end": 1773694308,
      "statsUsd": {
        "volume": { "currentValue": 13839617.47, "previousValue": 20042545.97, "change": -0.3094 },
        "close": { "currentValue": 2344.03, "previousValue": 2330.46, "change": 0.0058 }
      }
    },
    "day1": {
      "duration": "day1",
      "statsUsd": {
        "volume": { "currentValue": 680716557.75, "previousValue": 356002456.38, "change": 0.9121 }
      }
    }
  },
  "providers": [...]
}
```

---

### `GET /isScam`

Quick scam check — returns risk level and warnings.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |

```
GET /isScam?chain=bsc&tokenAddress=0x...
```

**Response:**
```json
{
  "endpoint": "isScam",
  "status": "live",
  "chain": "bsc",
  "tokenAddress": "0x...",
  "isScam": false,
  "risk": "low",
  "riskLevel": 1,
  "warnings": [],
  "cached": true,
  "providers": [...]
}
```

---

### `GET /fullAudit`

Deep contract audit — taxes, ownership, trading restrictions, holder stats, gas simulation.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |

```
GET /fullAudit?chain=eth&tokenAddress=0x...
```

**Response:**
```json
{
  "endpoint": "fullAudit",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "0x...",
  "cached": false,
  "summary": {
    "isScam": false,
    "risk": "medium",
    "riskLevel": 2,
    "warnings": ["High sell tax"]
  },
  "taxes": { "buyTax": 1, "sellTax": 5, "transferTax": 0 },
  "contract": {
    "openSource": true,
    "isProxy": false,
    "isMintable": false,
    "canTakeBackOwnership": false,
    "hiddenOwner": false,
    "selfDestruct": false,
    "ownerAddress": "0x...",
    "creatorAddress": "0x..."
  },
  "trading": {
    "cannotBuy": false,
    "cannotSellAll": false,
    "isAntiWhale": false,
    "tradingCooldown": false,
    "transferPausable": false,
    "isBlacklisted": false,
    "isWhitelisted": false
  },
  "holders": { "holderCount": 5000, "lpHolderCount": 10, "ownerPercent": 5, "creatorPercent": 2 },
  "simulation": { "buyGas": "150000", "sellGas": "175000" },
  "providers": [...]
}
```

---

### `GET /holderAnalysis`

Holder distribution, concentration, top holders, whale tracking, and change over time. Uses Moralis/Birdeye first, with Codex `top10HoldersPercent` as an extra concentration fallback.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |

```
GET /holderAnalysis?chain=eth&tokenAddress=0x...
```

**Response:**
```json
{
  "endpoint": "holderAnalysis",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "0x...",
  "cached": false,
  "summary": {
    "totalHolders": 15000,
    "analyzedHolders": 100,
    "top5Percent": 45,
    "top10Percent": 55,
    "largestHolderPercent": 12,
    "holdersOver1Pct": 8,
    "holdersOver5Pct": 2
  },
  "topHolders": [
    { "address": "0x...", "label": "Binance", "entity": "CEX", "isContract": false, "balance": 1000000, "percentOfSupply": 12 }
  ],
  "distribution": { "top25Percent": 65, "top50Percent": 75, "whales": 5, "sharks": 12, "dolphins": 25 },
  "holderChange": { "change24hPct": 2.5, "change7dPct": 10 },
  "concentration": { "top10HolderPercent": 55, "top10UserPercent": 45 },
  "signals": ["High concentration in top 10 holders"],
  "providers": [...]
}
```

---

### `GET /tokenHolders`

Raw token-holder ledger. This is separate from `holderAnalysis`: it returns holder rows rather than a concentration/risk summary.

- EVM chains use Sim by Dune and support pagination via `cursor`
- Solana uses Solana RPC-derived holder rows, so `nextOffset` is always `null` and acquisition metadata is not available

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `tokenAddress` | string | **yes** | — | Token contract address |
| `network` | string | no | `eth` | Chain: `eth`, `base`, `bsc`, `sol` |
| `cursor` | string | no | — | Pagination token from the previous response (EVM only) |
| `limit` | number | no | `50` | Results per page (1–200) |

```
GET /tokenHolders?tokenAddress=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&network=eth&limit=5
```

**Response:**
```json
{
  "endpoint": "tokenHolders",
  "status": "live",
  "cached": false,
  "tokenAddress": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "network": "eth",
  "holderCount": null,
  "top10HoldersPercent": 58.8,
  "nextOffset": "eyJwYWdlIjoyfQ==",
  "holders": [
    {
      "address": "0x...",
      "balance": "13794442047246482254818",
      "balanceUsd": null,
      "firstHeldTimestamp": 1738854667,
      "firstAcquired": "2025-02-06T15:11:07+00:00",
      "hasInitiatedTransfer": false
    }
  ],
  "providers": [...]
}
```

---

### `GET /holders`

Top-holder endpoint for a token.

- EVM chains use Moralis owner rows
- Solana uses direct Solana RPC holder scanning

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain: `eth`, `base`, `bsc`, `sol` |
| `tokenAddress` | string | **yes** | — | Token contract or mint address |
| `limit` | number | no | `150` | Maximum rows returned (1–150) |

```
GET /holders?chain=sol&tokenAddress=Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk&limit=5
```

**Response:**
```json
{
  "endpoint": "holders",
  "status": "live",
  "cached": false,
  "chain": "sol",
  "tokenAddress": "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk",
  "limit": 5,
  "holderCount": 36547,
  "totalSupplyRaw": "999111158353621",
  "totalSupplyFormatted": "999111158.353621",
  "holders": [
    {
      "address": "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w",
      "label": null,
      "entity": null,
      "isContract": null,
      "balance": "66226101364616",
      "balanceFormatted": "66226101.364616",
      "percentOfSupply": 6.6286
    }
  ],
  "providers": [
    { "provider": "solRpc:holders", "status": "ok" }
  ]
}
```

---

### `GET /fudSearch`

Search for FUD mentions across social platforms.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | no | — | Token address |
| `symbol` | string | no | — | Token symbol (**required**: symbol or tokenName) |
| `tokenName` | string | no | — | Token name (**required**: symbol or tokenName) |

```
GET /fudSearch?chain=eth&symbol=PEPE
```

**Response:**
```json
{
  "endpoint": "fudSearch",
  "status": "live",
  "chain": "eth",
  "query": "PEPE",
  "mentions": [
    {
      "source": "reddit",
      "id": "abc123",
      "title": "PEPE whale dumped 10B tokens",
      "author": "crypto_watcher",
      "createdAt": "2026-03-15T12:00:00Z",
      "url": "https://reddit.com/r/...",
      "metrics": { "upvotes": 150 }
    }
  ],
  "providers": [...]
}
```

---

### `GET /marketOverview`

Combined market overview — sentiment scoring, social signals, prediction markets, pool data, and risk check. Supports two modes: token-level or major-asset mode.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | conditional | — | Token address for token mode, or major symbol like `btc`, `eth`, `sol`, `xrp`, `bnb` |
| `asset` | string | conditional | — | Explicit major asset name/symbol like `bitcoin`, `ethereum`, `solana`, `xrp`, `bnb` |
| `poolAddress` | string | no | — | Specific pool |
| `symbol` | string | no | — | Symbol hint |
| `tokenName` | string | no | — | Name hint |

```
GET /marketOverview?chain=eth&tokenAddress=0x...
GET /marketOverview?asset=bitcoin
GET /marketOverview?chain=eth&tokenAddress=eth
```

Major mode behavior:
- Uses broad sentiment and macro context sources such as X, Reddit, and Polymarket.
- Skips token-specific risk checks like Honeypot and token-specific holder analysis.
- Returns `mode: "major"`, with `pool`, `risk`, and `social` set to `null`.

**Response:**
```json
{
  "endpoint": "marketOverview",
  "status": "live",
  "mode": "token",
  "chain": "eth",
  "tokenAddress": "0x...",
  "cached": false,
  "overallScore": 72,
  "sentimentLabel": "bullish",
  "summary": ["Strong social momentum", "Low risk score"],
  "topDrivers": [
    { "source": "reddit", "title": "...", "impactScore": 8 }
  ],
  "pool": { "...tokenPoolInfo fields..." },
  "risk": { "...isScam fields..." },
  "social": { "...fudSearch fields..." },
  "sources": {
    "xMentions": [...],
    "redditMentions": [...],
    "polymarketMarkets": [...]
  },
  "predictionMarkets": [...],
  "providers": [...]
}
```

---

### `GET /walletReview`

Comprehensive wallet analysis — PnL, holdings, protocols, activity, and risky approvals. Uses Moralis, Birdeye, DeBank, and Zerion as fallback sources.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `walletAddress` | string | **yes** | — | Wallet address |
| `days` | string | no | `30` | Lookback period |
| `pageCount` | number | no | `10` | Pages of history to fetch (1–20) |

```
GET /walletReview?chain=sol&walletAddress=8X35r...&days=30&pageCount=10
```

**Response:**
```json
{
  "endpoint": "walletReview",
  "status": "live",
  "chain": "sol",
  "walletAddress": "8X35r...",
  "days": "30",
  "summary": {
    "totalNetWorthUsd": 125000,
    "chainNetWorthUsd": 80000,
    "realizedProfitUsd": 15000,
    "realizedProfitPct": 23.5,
    "totalTradeVolumeUsd": 500000,
    "totalTrades": 150,
    "totalBuys": 80,
    "totalSells": 70,
    "profitable": true,
    "tokenCount": 15,
    "protocolCount": 5,
    "activeChains": ["sol", "eth"],
    "approvalExposureUsd": 0,
    "recentTransfers": 10,
    "recentApprovals": 0,
    "recentInteractions": 25
  },
  "topHoldings": [
    { "tokenAddress": "So111...", "chain": "sol", "symbol": "SOL", "amount": 500, "priceUsd": 160, "valueUsd": 80000, "source": "moralis" }
  ],
  "topProtocols": [
    { "id": "raydium", "chain": "sol", "name": "Raydium", "netUsdValue": 5000 }
  ],
  "recentActivity": [
    { "txHash": "abc...", "category": "swap", "chain": "sol", "timestamp": 1710000000, "gasUsd": 0.001 }
  ],
  "riskyApprovals": [],
  "providers": [...]
}
```

---

### `GET /swap`

Build an unsigned swap transaction. The caller signs and submits it.

Swap notes:
- Use `native`, `eth`, or `bnb` as the native-token sentinel for EVM native in/out.
- Native-in EVM buys use the configured fee wrapper when `*_FEE_WRAPPER_ADDRESS` is set.
- Native-out EVM sells also use the configured fee wrapper when enabled.
- Base Uniswap V4 sells now use the Permit2-enabled fee wrapper path.
- If `tokenIn` is an ERC-20, call `/approve` first unless the token is already approved for the resolved spender.

Supported DEXes:

| Chain | DEX ids |
|---|---|
| `eth` | `uniswapV2`, `uniswapV3`, `uniswapV4` |
| `base` | `uniswapV2`, `uniswapV3`, `uniswapV4`, `aerodromeV2`, `aerodromeV3` |
| `bsc` | `pancakeswapV2`, `pancakeswapV3` |
| `sol` | `raydium`, `meteora`, `pumpfun` |

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | **yes** | — | Chain (`eth`, `base`, `bsc`, `sol`) |
| `dex` | string | **yes** | — | DEX name (use `/swapDexes` to list) |
| `walletAddress` | string | **yes** | — | Wallet that will sign |
| `tokenIn` | string | **yes** | — | Input token address |
| `tokenOut` | string | **yes** | — | Output token address |
| `amountIn` | string | **yes** | — | Amount in raw units (wei/lamports) |
| `slippageBps` | number | no | `50` | Slippage tolerance in basis points (1–5000) |
| `deadline` | number | no | now+20min | Unix timestamp deadline (EVM only) |

```
GET /swap?chain=eth&dex=uniswapV3&walletAddress=0x...&tokenIn=0x...&tokenOut=0x...&amountIn=1000000000000000000&slippageBps=100
GET /swap?chain=base&dex=uniswapV4&walletAddress=0x...&tokenIn=native&tokenOut=0xB964cA8757B0d64c50B0da17f0150563139361aC&amountIn=100000000000000&slippageBps=500
GET /swap?chain=base&dex=aerodromeV3&walletAddress=0x...&tokenIn=0x6985884c4392d348587b19cb9eaaf157f13271cd&tokenOut=native&amountIn=105181035404990950&slippageBps=500
```

**Response (EVM):**
```json
{
  "endpoint": "swap",
  "status": "live",
  "chain": "eth",
  "dex": "uniswapV3",
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "slippageBps": 100,
  "tx": {
    "to": "0xRouterAddress",
    "data": "0xcalldata...",
    "value": "0x0",
    "chainId": 1,
    "from": "0xYourWallet",
    "gasLimit": "0x30000"
  },
  "providers": [...]
}
```

**Response (SOL):**
```json
{
  "tx": {
    "serializedTx": "base64EncodedTransaction...",
    "chainId": "solana",
    "from": "WalletPublicKey"
  }
}
```

---

### `GET /swapQuote`

Get a price quote without building the transaction.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | **yes** | — | Chain |
| `dex` | string | **yes** | — | DEX name |
| `tokenIn` | string | **yes** | — | Input token |
| `tokenOut` | string | **yes** | — | Output token |
| `amountIn` | string | **yes** | — | Raw amount in |
| `slippageBps` | number | no | `50` | Slippage (bps) |

```
GET /swapQuote?chain=eth&dex=uniswapV3&tokenIn=0x...&tokenOut=0x...&amountIn=1000000
```

**Response:**
```json
{
  "endpoint": "swapQuote",
  "status": "live",
  "chain": "eth",
  "dex": "uniswapV3",
  "amountOut": "997000",
  "amountOutMin": "992000",
  "providers": [...]
}
```

---

### `GET /swapDexes`

List available DEXes for a chain.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | **yes** | — | Chain |

```
GET /swapDexes?chain=eth
```

**Response:**
```json
{
  "endpoint": "swapDexes",
  "chain": "eth",
  "dexes": [
    { "id": "uniswapV2", "label": "Uniswap V2" },
    { "id": "uniswapV3", "label": "Uniswap V3" },
    { "id": "uniswapV4", "label": "Uniswap V4" }
  ]
}
```

---

### `GET /approve`

Build unsigned approval transaction steps for a later `/swap` call. In `auto` mode, the endpoint mirrors the current `/swap` path:
- wrapper-backed native-out sells return an ERC-20 approval to the fee wrapper
- direct Uniswap V4 flows return Permit2 steps
- direct router flows return a standard ERC-20 approval to the router

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | **yes** | — | Chain (`eth`, `base`, `bsc`) |
| `dex` | string | **yes** | — | DEX id from `/swapDexes` |
| `walletAddress` | string | **yes** | — | Wallet that will sign |
| `tokenIn` | string | **yes** | — | Token to approve |
| `tokenOut` | string | **yes** | — | Intended swap output; used by `auto` mode |
| `amount` | string | no | max approval | Optional Permit2 amount override |
| `approvalMode` | string | no | `auto` | `auto`, `erc20`, or `permit2` |
| `spender` | string | no | resolved automatically | Optional explicit spender override |
| `expiration` | number | no | now + 30 days | Optional Permit2 expiration timestamp |

Examples:
```
GET /approve?chain=base&dex=uniswapV3&walletAddress=0x...&tokenIn=0x18b0034be96c0b2828ac74319e4cf8670ce7e710&tokenOut=native
GET /approve?chain=base&dex=uniswapV4&walletAddress=0x...&tokenIn=0xB964cA8757B0d64c50B0da17f0150563139361aC&tokenOut=native
GET /approve?chain=eth&dex=uniswapV4&walletAddress=0x...&tokenIn=0x...&tokenOut=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&approvalMode=permit2
```

**Response:**
```json
{
  "endpoint": "approve",
  "status": "live",
  "chain": "base",
  "dex": "uniswapV4",
  "tokenIn": "0xB964cA8757B0d64c50B0da17f0150563139361aC",
  "tokenOut": "native",
  "approvalMode": "auto",
  "resolvedMode": "erc20",
  "spender": "0x946073C7fC556333253F88F92796A74F7FE0Eb61",
  "steps": [
    {
      "kind": "erc20",
      "label": "Approve fee wrapper to pull tokenIn",
      "spender": "0x946073C7fC556333253F88F92796A74F7FE0Eb61",
      "tx": {
        "to": "0xB964cA8757B0d64c50B0da17f0150563139361aC",
        "data": "0x095ea7b3...",
        "value": "0x0",
        "chainId": 8453,
        "from": "0xYourWallet"
      }
    }
  ],
  "notes": [
    "Auto mode matched the current /swap sell path and resolved to fee-wrapper approval."
  ],
  "providers": []
}
```

---

### `GET /unwrap`

Build an unsigned wrapped-native withdraw transaction so the caller can unwrap WETH or WBNB back into the chain gas token.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | **yes** | — | `eth`, `base`, or `bsc` |
| `walletAddress` | string | **yes** | — | Wallet that will sign |
| `amount` | string | **yes** | — | Raw wrapped-native amount |

```
GET /unwrap?chain=base&walletAddress=0x...&amount=100000000000000000
```

**Response:**
```json
{
  "endpoint": "unwrap",
  "chain": "base",
  "tx": {
    "to": "0x4200000000000000000000000000000000000006",
    "data": "0x2e1a7d4d...",
    "value": "0x0",
    "chainId": 8453,
    "from": "0xYourWallet"
  }
}
```

---

### `GET /trendingTokens`

Currently trending tokens across all chains.

```
GET /trendingTokens
```

**Response:**
```json
{
  "endpoint": "trendingTokens",
  "status": "live",
  "tokens": [
    {
      "chainId": "solana",
      "tokenAddress": "...",
      "name": "PepeCoin",
      "symbol": "PEPE",
      "priceUsd": 0.0001,
      "volume24hUsd": 50000000,
      "liquidityUsd": 2000000,
      "priceChange24hPct": 150,
      "marketCapUsd": 5000000,
      "boostAmount": 500,
      "source": "dexScreener"
    }
  ],
  "providers": [...]
}
```

---

### `GET /getTopEthTokens`

Top Ethereum tokens from Ethplorer. Ethereum mainnet only. Results are cached for 10 minutes.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `criteria` | string | no | `trade` | Sort by `trade`, `cap`, or `count` |
| `limit` | number | no | `50` | Max results (1–50) |

```
GET /getTopEthTokens?criteria=cap&limit=25
```

**Response:**
```json
{
  "endpoint": "getTopEthTokens",
  "status": "live",
  "criteria": "cap",
  "limit": 25,
  "cached": false,
  "tokens": [
    {
      "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "totalSupply": "1000000000000000",
      "name": "Tether USD",
      "symbol": "USDT",
      "decimals": "6",
      "price": {
        "rate": 1,
        "currency": "USD",
        "diff": 0.01,
        "diff7d": 0.03,
        "diff30d": 0.02,
        "marketCapUsd": 100000000000,
        "availableSupply": 100000000000,
        "volume24h": 50000000000,
        "ts": 1763000000
      },
      "countOps": 12345678,
      "holdersCount": 1000000,
      "lastUpdated": 1763000000
    }
  ],
  "providers": [...]
}
```

Ethplorer may include additional token fields in each row. This endpoint preserves those extra fields while normalizing the common token info fields above.

---

### `GET /getNewEthTradableTokens`

Newest tradable Ethereum tokens from Ethplorer. Ethereum mainnet only. Results are cached for 10 minutes.

```
GET /getNewEthTradableTokens
```

**Response:**
```json
{
  "endpoint": "getNewEthTradableTokens",
  "status": "live",
  "cached": false,
  "tokens": [
    {
      "address": "0x1234...",
      "totalSupply": "1000000000000000000",
      "name": "New Token",
      "symbol": "NEW",
      "decimals": "18",
      "price": {
        "rate": 0.00012,
        "currency": "USD",
        "diff": 4.2,
        "diff7d": 4.2,
        "diff30d": 4.2,
        "marketCapUsd": 120000,
        "availableSupply": 1000000000,
        "volume24h": 25000,
        "ts": 1763000000
      },
      "holdersCount": 145,
      "lastUpdated": 1763000000,
      "added": 1762999500
    }
  ],
  "providers": [...]
}
```

Ethplorer returns up to 100 newly tradable tokens sorted by creation time. This endpoint preserves any additional Ethplorer fields while normalizing the common token fields and the `added` timestamp.

---

### `GET /newPairs`

Recently created trading pairs/pools.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `source` | string | no | `all` | Filter: `all`, `dexscreener`, `pumpfun`, `raydium`, `uniswap` |
| `limit` | number | no | `10` | Results per source (1–50) |

```
GET /newPairs?source=pumpfun&limit=5
```

**Response:**
```json
{
  "endpoint": "newPairs",
  "status": "live",
  "source": "pumpfun",
  "pairs": [
    {
      "source": "pumpfun",
      "chainId": "solana",
      "pairAddress": null,
      "tokenAddress": "...",
      "name": "NewToken",
      "symbol": "NEW",
      "description": "A new meme token",
      "createdAt": 1710000000,
      "tvl": null,
      "marketCap": 50000,
      "url": "https://pump.fun/..."
    }
  ],
  "providers": [...]
}
```

---

### `GET /topTraders`

Top traders for a specific token. Multi-chain via Birdeye (solana, ethereum, base, bsc).

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `sol` | Chain (`sol`, `eth`, `base`, `bsc`) |
| `tokenAddress` | string | **yes** | — | Token address |
| `timeFrame` | string | no | `24h` | Time frame (`30m`, `1h`, `2h`, `4h`, `8h`, `24h`) |

```
GET /topTraders?chain=eth&tokenAddress=0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7&timeFrame=24h
```

**Response:**
```json
{
  "endpoint": "topTraders",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "...",
  "timeFrame": "24h",
  "traders": [
    { "address": "0x...", "tradeCount": 4, "volume": 394.10, "buyVolume": 394.10, "sellVolume": 0 }
  ],
  "providers": [...]
}
```

---

### `GET /gasFeed`

Current gas prices for EVM chains. Uses Etherscan V2 (single API key for all chains).

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain (`eth`, `base`, `bsc`) |

```
GET /gasFeed?chain=eth
```

**Response:**
```json
{
  "endpoint": "gasFeed",
  "status": "live",
  "chain": "eth",
  "lastBlock": "23467872",
  "safeGwei": "0.38",
  "proposeGwei": "0.38",
  "fastGwei": "0.42",
  "baseFeeGwei": "0.38",
  "providers": [...]
}
```

---

### `GET /tokenSearch`

Search for tokens/pairs by name, symbol, or address.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | **yes** | — | Search term |

```
GET /tokenSearch?query=pepe
```

**Response:**
```json
{
  "endpoint": "tokenSearch",
  "status": "live",
  "query": "pepe",
  "results": [
    {
      "chainId": "ethereum",
      "pairAddress": "0x...",
      "tokenAddress": "0x...",
      "name": "Pepe",
      "symbol": "PEPE",
      "priceUsd": 0.00001,
      "volume24hUsd": 200000000,
      "liquidityUsd": 50000000,
      "priceChange24hPct": 5.2,
      "fdvUsd": 4000000000,
      "dex": "uniswap"
    }
  ],
  "providers": [...]
}
```

---

### `GET /filterTokens`

Filter and rank tokens by on-chain metrics. Powered by Codex.io. Results cached for 5 minutes.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `network` | string | no | — | Chain filter: `eth`, `base`, `bsc`, `sol` (comma-separated for multiple) |
| `phrase` | string | no | — | Text search (prefix with `$` for symbol match, e.g. `$PEPE`) |
| `minLiquidity` | number | no | — | Minimum USD liquidity |
| `minVolume24` | number | no | — | Minimum 24h volume |
| `minMarketCap` | number | no | — | Minimum market cap |
| `maxMarketCap` | number | no | — | Maximum market cap |
| `minHolders` | number | no | — | Minimum holder count |
| `minWalletAgeAvg` | number | no | — | Minimum average wallet age of holders |
| `sortBy` | string | no | `trendingScore24` | Sort field (see table below) |
| `sortDirection` | string | no | `DESC` | `ASC` or `DESC` |
| `limit` | number | no | `25` | Results per page (1–200) |
| `offset` | number | no | `0` | Pagination offset |
| `includeScams` | boolean | no | `false` | Include flagged scam tokens |
| `launchpadName` | string | no | — | Filter by launchpad (comma-separated, e.g. `Pump,Clanker`) |
| `launchpadCompleted` | boolean | no | — | Filter by launchpad graduation status |
| `statsType` | string | no | — | `FILTERED` (removes MEV/bots) or `UNFILTERED` (raw) |

#### All Codex Filter Fields

These are all the filter fields supported by the underlying Codex `filterTokens` GraphQL query. Currently the API exposes the most common ones as query params (listed above). The full set can be passed directly via the Codex provider:

| Filter Field | Type | Description |
|---|---|---|
| `network` | int / int[] | Network ID(s): `1` (ETH), `8453` (BASE), `56` (BSC), `1399811149` (SOL) |
| `liquidity` | range | USD liquidity (`gt`, `gte`, `lt`, `lte`) |
| `volume24` | range | 24h trading volume |
| `circulatingMarketCap` | range | Market cap |
| `buyVolume24` | range | 24h buy volume |
| `sellVolume24` | range | 24h sell volume |
| `txnCount24` | range | 24h transaction count |
| `holders` | range | Total holder count |
| `priceUSD` | range | Current token price |
| `change24` | range | 24h price change % |
| `change1` | range | 1h price change % |
| `change5m` | range | 5m price change % |
| `createdAt` | range | Token creation timestamp (unix) |
| `sniperCount` | range | Number of snipers |
| `devHeldPercentage` | range | % held by dev wallet |
| `top10HoldersPercent` | range | % held by top 10 holders |
| `bundlerCount` | range | Number of bundlers |
| `insiderCount` | range | Number of insiders |
| `walletAgeAvg` | range | Average age of holder wallets |
| `buyCount1` | range | Buy count in last period |
| `sellCount1` | range | Sell count in last period |
| `includeScams` | boolean | Include tokens flagged as scams |
| `potentialScam` | boolean | Filter to only potential scams |
| `isVerified` | boolean | Only verified tokens |
| `launchpadName` | string[] | Filter by launchpad name(s) |
| `launchpadProtocol` | string[] | Filter by launchpad protocol(s) |
| `freezable` | boolean | Token can be frozen |
| `mintable` | boolean | Token is mintable |

> **Range filters** accept `{ gt, gte, lt, lte }` — greater than, greater than or equal, less than, less than or equal.

#### All sortBy Values

| Value | Description |
|---|---|
| `trendingScore24` | 24h trending score (default) |
| `volume24` | 24h trading volume |
| `liquidity` | USD liquidity |
| `circulatingMarketCap` | Market cap |
| `holders` | Holder count |
| `change24` | 24h price change |
| `change1` | 1h price change |
| `change5m` | 5m price change |
| `createdAt` | Token creation time |
| `txnCount24` | 24h transaction count |
| `buyCount24` | 24h buy count |
| `sellCount24` | 24h sell count |
| `buyVolume24` | 24h buy volume |
| `sellVolume24` | 24h sell volume |
| `priceUSD` | Token price |
| `walletAgeAvg` | Average wallet age of holders |
| `sniperCount` | Number of snipers |
| `devHeldPercentage` | Dev wallet holdings % |
| `top10HoldersPercent` | Top 10 holder concentration % |

```
GET /filterTokens?network=sol&minLiquidity=50000&maxMarketCap=1000000&sortBy=trendingScore24&limit=10
```

**Response:**
```json
{
  "endpoint": "filterTokens",
  "status": "live",
  "cached": true,
  "count": 10,
  "page": 0,
  "tokens": [
    {
      "address": "...",
      "name": "MemeToken",
      "symbol": "MEME",
      "imageUrl": "https://...",
      "createdAt": 1710000000,
      "creatorAddress": "...",
      "priceUsd": "0.0001",
      "liquidity": "65000",
      "marketCap": "500000",
      "volume24h": "12000000",
      "buyVolume24h": "7000000",
      "sellVolume24h": "5000000",
      "change24h": "0.15",
      "change1h": "0.03",
      "change5m": "-0.01",
      "txnCount24h": 5000,
      "buyCount24h": 3000,
      "sellCount24h": 2000,
      "holders": 4500,
      "walletAgeAvg": "50000000",
      "sniperCount": 5,
      "sniperHeldPct": 2.1,
      "bundlerCount": 3,
      "bundlerHeldPct": 1.2,
      "insiderCount": 2,
      "insiderHeldPct": 0.8,
      "devHeldPct": 1.5,
      "top10HoldersPct": 28,
      "description": "A meme token...",
      "totalSupply": "1000000000",
      "circulatingSupply": "800000000",
      "launchpad": {
        "name": "Pump",
        "protocol": "Pump",
        "completed": true,
        "migrated": true,
        "poolAddress": "...",
        "graduationPercent": 100
      },
      "socialLinks": {
        "twitter": "https://x.com/...",
        "telegram": "https://t.me/...",
        "website": "https://..."
      },
      "pairAddress": "..."
    }
  ],
  "providers": [...]
}
```

---

### `GET /volatilityScanner`

Scans high-volume tokens for repeating swing patterns. Fetches top tokens by volume, computes zigzag swing detection from OHLCV candles, and returns candidates ranked by a composite swing score. Results are cached for 5 minutes.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `sol` | Chain to scan |
| `minVolume` | number | no | `100000` | Minimum 24h volume (USD) |
| `minSwingPct` | number | no | `10` | Minimum median swing size (%) to qualify |
| `duration` | string | no | `hour4` | Stats window: `min5`, `hour1`, `hour4`, `hour12`, `day1` |
| `maxResults` | number | no | `20` | Max candidates to return |

```
GET /volatilityScanner?chain=sol&minVolume=500000&minSwingPct=10&duration=hour4&maxResults=10
```

**Response:**
```json
{
  "endpoint": "volatilityScanner",
  "chain": "sol",
  "duration": "hour4",
  "count": 5,
  "cached": false,
  "scanned": 50,
  "passedPreFilter": 18,
  "passedStats": 7,
  "candidates": [
    {
      "address": "TokenMint...",
      "name": "ExampleToken",
      "symbol": "EX",
      "priceUsd": "0.00523",
      "liquidity": "250000",
      "volume24h": "1200000",
      "change24h": "0.15",
      "support": 0.0042,
      "resistance": 0.0068,
      "swingPct": 18.5,
      "avgSwingPct": 21.3,
      "swingCount": 4,
      "currentPosition": 0.32,
      "buyVsSellRatio": 1.15,
      "volumeTrend": "rising",
      "volumeChangePct": 35.2,
      "swingScore": 85
    }
  ]
}
```

**Key fields:**
- `swingPct` — Median swing size across detected reversals (the "typical" tradeable swing)
- `avgSwingPct` — Average swing size (can be skewed by outliers)
- `swingCount` — Number of detected reversals (minimum 2 to qualify)
- `currentPosition` — Where price sits in the support/resistance range (0 = at support, 1 = at resistance)
- `volumeTrend` — `"rising"` / `"falling"` / `"flat"` based on recent vs older candle volume
- `volumeChangePct` — Exact % change in volume (e.g., `+35.2` means recent volume is 35% higher)
- `swingScore` — Composite 0-100 score (swing size, count, volume, buy/sell balance, position)

---

### `GET /priceHistoryIndicators`

Returns OHLCV price history plus timeframe-adaptive technical indicators with an aggregate buy/sell signal. Indicators auto-tune their periods based on the requested timeframe. Results are cached for 60 seconds.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |
| `indicatorTimeFrame` | string | no | `1h` | `1m`, `5m`, `10m`, `15m`, `30m`, `1h`, `4h`, `1d` |

```
GET /priceHistoryIndicators?chain=eth&tokenAddress=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&indicatorTimeFrame=1h
```

**Response:**
```json
{
  "endpoint": "priceHistoryIndicators",
  "status": "live",
  "chain": "eth",
  "tokenAddress": "0xC02...",
  "currency": "usd",
  "limit": "7d",
  "interval": "1h",
  "indicatorTimeFrame": "1h",
  "pointCount": 168,
  "cached": false,
  "points": [
    { "timestamp": 1710000000, "priceUsd": 2350, "open": 2345, "high": 2360, "low": 2340, "close": 2350, "volume": 500000 }
  ],
  "indicators": {
    "timeFrame": "1h",
    "config": { "rsiPeriod": 14, "macdFast": 12, "macdSlow": 26, "macdSignal": 9, "emaShort": 9, "emaMedium": 21, "emaLong": 55, "..." : "..." },
    "rsi": { "period": 14, "value": 55.3, "signal": "neutral" },
    "macd": { "macd": 12.5, "signal": 10.2, "histogram": 2.3, "trend": "bullish" },
    "ema": { "short": { "period": 9, "value": 2348 }, "medium": { "period": 21, "value": 2340 }, "long": { "period": 55, "value": 2310 } },
    "sma": { "period": 20, "value": 2342 },
    "bollingerBands": { "upper": 2400, "middle": 2342, "lower": 2284, "bandwidth": 0.049, "percentB": 0.57 },
    "atr": { "period": 14, "value": 25.6 },
    "stochRsi": { "k": 65, "d": 58, "signal": "neutral" },
    "supportResistance": { "support": [2300, 2280], "resistance": [2400, 2420] },
    "vwap": { "value": 2345, "upperBand": 2390, "lowerBand": 2300 },
    "obv": { "value": 12500000, "trend": "accumulating" },
    "summary": { "signal": "buy", "bullishCount": 4, "bearishCount": 1, "neutralCount": 2 }
  },
  "providers": [...]
}
```

**Indicators included:** RSI, MACD, EMA (short/medium/long), SMA, Bollinger Bands (%B, bandwidth), ATR, Stochastic RSI, Support/Resistance levels, VWAP (with bands), OBV (with trend).

**Aggregate signal:** `summary.signal` is one of `strong_buy`, `buy`, `neutral`, `sell`, `strong_sell` based on the count of bullish vs bearish indicator readings.

---

### `GET /rateMyEntry`

Rates whether the current token price is a good swing-trade entry using the same decision logic described in the swing-trade strategy guide. The endpoint combines current market price, technical indicators, detailed volume stats, and scam-risk checks. Results are cached for 60 seconds.

**Rate limit:** Each API key can call `/rateMyEntry` only once every 30 minutes. Additional calls inside that cooldown window return `429` with `retryAfterSeconds`.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain` | string | no | `eth` | Chain |
| `tokenAddress` | string | **yes** | — | Token address |
| `indicatorTimeFrame` | string | no | `1h` | `1m`, `5m`, `10m`, `15m`, `30m`, `1h`, `4h`, `1d` |

```
GET /rateMyEntry?chain=base&tokenAddress=0x4200000000000000000000000000000000000006&indicatorTimeFrame=1h
```

**Response:**
```json
{
  "endpoint": "rateMyEntry",
  "status": "live",
  "chain": "base",
  "tokenAddress": "0x4200...0006",
  "indicatorTimeFrame": "1h",
  "cached": false,
  "rating": {
    "score": 7.6,
    "maxScore": 10,
    "label": "good",
    "action": "enter_now",
    "summary": "Entry is rated 7.6/10. The setup clears the swing-trade checks with an aggregate indicator signal of buy.",
    "betterEntryPriceUsd": null,
    "betterEntryDiscountPct": null,
    "suggestedTakeProfitUsd": 1.1275,
    "estimatedUpsidePct": 8.42,
    "requiredConfirmations": [],
    "hardStops": []
  },
  "market": {
    "currentPriceUsd": 1.04,
    "liquidityUsd": 860000,
    "volume24hUsd": 2450000,
    "priceChange24hPct": 5.7
  },
  "range": {
    "supportUsd": 0.99,
    "resistanceUsd": 1.1275,
    "currentPosition": 0.364,
    "rangeWidthPct": 13.89
  },
  "indicators": {
    "summarySignal": "buy",
    "bullishCount": 4,
    "bearishCount": 1,
    "neutralCount": 2,
    "rsi": 37.8,
    "rsiSignal": "neutral",
    "macdHistogram": 0.0041,
    "macdTrend": "bullish",
    "bollingerPercentB": 0.24,
    "vwapUsd": 1.06,
    "emaShortUsd": 1.05,
    "emaMediumUsd": 1.02,
    "emaLongUsd": 0.98,
    "emaStack": "bullish",
    "latestCandle": "bullish"
  },
  "volume": {
    "threshold24hUsd": 100000,
    "thresholdLiquidityUsd": 50000,
    "hour1VolumeUsd": 122000,
    "hour4VolumeUsd": 410000,
    "volumeConsistencyPct": 118.98,
    "latestCandleVolume": 31000,
    "recentAverageCandleVolume": 24500,
    "volumeVsRecentAveragePct": 26.53,
    "buySellRatio": 1.18,
    "buyers": 352,
    "sellers": 301
  },
  "risk": {
    "isScam": false,
    "riskLevel": 18,
    "warnings": []
  },
  "factors": [
    {
      "name": "Trend filter",
      "status": "bullish",
      "score": 2,
      "maxScore": 2,
      "detail": "Price is above the long EMA and the EMA stack is bullish."
    }
  ],
  "providers": []
}
```

**Interpretation:**
- `rating.score` is the 0-10 entry quality rating.
- `rating.action` is `enter_now`, `wait_for_pullback`, or `avoid`.
- If `rating.score < 7`, `rating.betterEntryPriceUsd` gives the preferred pullback level to wait for.
- `range.currentPosition` shows where price sits inside the support/resistance range (`0` = at support, `1` = at resistance).
- `factors` breaks out how trend, location, momentum, volume, flow, summary, and safety contributed to the rating.

---

### `GET /strats`

List all available strategy guides.

```
GET /strats
```

**Response:**
```json
{
  "strategies": [
    {
      "id": "swing-trade",
      "name": "Swing Trader",
      "description": "Find volatile high-volume tokens with 10%+ price swings and place entries/exits at support & resistance levels.",
      "path": "/strats/swing-trade"
    },
    {
      "id": "scalping",
      "name": "Hardened Scalper",
      "description": "SOL-first, BSC-fallback intraday scalping guide focused on small, fast profits with strict liquidity, safety, slippage, and execution gates.",
      "path": "/strats/scalping"
    }
  ]
}
```

---

### `GET /strats/:id`

Fetch a strategy guide as markdown. Returns `Content-Type: text/markdown`.

```
GET /strats/swing-trade
```

Also available:

```
GET /strats/scalping
```

**Response:** Raw markdown document describing the full strategy playbook — API endpoints used, entry/exit criteria, risk management rules, and a monitoring decision tree. Designed to be consumed by autonomous trading agents.

---

### `WS /ws/launchpadEvents`

Real-time launchpad token event stream via WebSocket. Streams new token launches, updates, and migrations from PumpDotFun, Clanker, Virtuals, and more.

**Architecture:** The server maintains one upstream Codex subscription per unique filter set and fans out events to all clients with matching filters. Multiple clients with the same filter share one upstream connection.

#### Connection Flow

```
1. Connect:    ws://localhost:3000/ws/launchpadEvents
2. Receive:    {"type": "info", "data": "Connected. Send a JSON message with your filter..."}
3. Send:       {"protocol": "PumpDotFun", "eventType": "Created"}
4. Receive:    {"type": "subscribed", "data": {"filter": {...}}}
5. Receive:    {"type": "events", "data": [{...}, {...}]}  (continuous stream)
6. Close:      client disconnects when done
```

#### Filter Options

| Field | Type | Description |
|---|---|---|
| `protocol` | string | Single protocol enum value (see table below) |
| `protocols` | string[] | Multiple protocol enum values |
| `networkId` | number | Network ID: `1` (ETH), `8453` (BASE), `56` (BSC), `1399811149` (SOL) |
| `launchpadName` | string | Launchpad display name |
| `launchpadNames` | string[] | Multiple launchpad display names |
| `eventType` | string | Event type enum (see table below) |

Send `{}` (empty object) to receive all events across all protocols.

#### Protocol Values

| Value | Description |
|---|---|
| `PumpDotFun` | Pump.fun (Solana) |
| `Clanker` | Clanker (Base) |
| `Virtuals` | Virtuals Protocol |
| `Ape` | Ape (Ethereum) |
| `BoostFun` | Boost.fun |
| `BubbleMaps` | BubbleMaps launchpad |
| `Believe` | Believe |
| `Bonk` | Bonk launchpad |
| `Boop` | Boop |
| `CookFun` | Cook.fun |
| `DaosFun` | Daos.fun |
| `DebridgeLaunchpad` | deBridge launchpad |
| `Dexscreener` | DexScreener Moonshot |
| `Etherfun` | Etherfun |
| `FourMeme` | Four Meme (BSC) |
| `Gra` | Gra |
| `HighFun` | High.fun |
| `Letsbonk` | Letsbonk |
| `MakerFun` | Maker.fun |
| `Meteora` | Meteora |
| `Pumpswap` | PumpSwap |
| `WowFun` | Wow.fun |
| `Unknown` | Unknown launchpad |

#### Event Type Values

| Value | Description |
|---|---|
| `Created` | New token launched on launchpad |
| `Updated` | Token metrics updated (price, volume, holders change) |
| `Migrated` | Token migrated to DEX (graduated from bonding curve) |

#### Event Shape

```json
{
  "type": "events",
  "data": [
    {
      "address": "TokenMintAddress",
      "networkId": 1399811149,
      "eventType": "Created",
      "launchpadName": "Pump",
      "marketCap": "5000",
      "price": 0.000001,
      "liquidity": "3000",
      "holders": 1,
      "volume1": 500,
      "transactions1": 10,
      "buyCount1": 8,
      "sellCount1": 2,
      "sniperCount": 0,
      "sniperHeldPercentage": 0,
      "devHeldPercentage": 100,
      "tokenName": "NewMeme",
      "tokenSymbol": "NMEME",
      "tokenImage": "https://..."
    }
  ]
}
```

#### Example (Node.js)

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws/launchpadEvents');

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'info') {
    ws.send(JSON.stringify({ protocol: 'PumpDotFun' }));
  } else if (msg.type === 'events') {
    msg.data.forEach(event => {
      console.log(`New token: ${event.tokenSymbol} — $${event.marketCap} mcap`);
    });
  }
});
```

---

### `WS /ws/agentStats`

Live per-agent dashboard stream for frontend admin panels. Sends rolling 60-minute request counts and average response times for one or more `agentId` values.

Authentication:
- Send `x-admin-key: <ADMIN_API_KEY>` during the websocket handshake if your client supports custom headers.
- Browser clients can connect with `?adminKey=<ADMIN_API_KEY>` in the websocket URL.

#### Connection Flow

```
1. Connect:    ws://localhost:3000/ws/agentStats?adminKey=...
2. Receive:    {"type":"info","data":"Connected. Send JSON ..."}
3. Send:       {"agentId":"scanner-alpha"}
4. Receive:    {"type":"subscribed","data":{"agentIds":["scanner-alpha"],"snapshots":[...]}}
5. Receive:    {"type":"agentStats","data":{"agentId":"scanner-alpha",...}}  (about once per second while traffic changes)
6. Send:       {"agentIds":["scanner-alpha","scanner-beta"]} to replace subscriptions
```

#### Subscription Payload

```json
{ "agentId": "scanner-alpha" }
```

or

```json
{ "agentIds": ["scanner-alpha", "scanner-beta"] }
```

#### Event Shape

```json
{
  "type": "agentStats",
  "data": {
    "agentId": "scanner-alpha",
    "window": "rolling_60m",
    "requestsLastHour": 124,
    "avgResponseMsLastHour": 188.4,
    "updatedAt": "2026-03-21T20:15:00.000Z"
  }
}
```

Notes:
- The stream is in-memory and low overhead: request tracking is constant-time and websocket broadcasts are coalesced to roughly once per second.
- This is process-local. On multiple dynos/processes, each instance only knows about traffic it handled. Use Redis or another shared pub/sub store if you need one globally merged live stream across horizontal scaling.

---

## Error Handling

### Validation Errors (400)

```json
{
  "error": "Validation error",
  "message": "Invalid query parameters: tokenAddress — Required",
  "fields": [
    { "field": "tokenAddress", "message": "Required", "code": "invalid_type" }
  ]
}
```

### Invalid Chain (400)

```json
{
  "error": "Invalid chain",
  "message": "Unsupported chain \"polygon\". Valid chains: eth, base, bsc, sol"
}
```

### Not Found (404)

```json
{
  "error": "Not found",
  "message": "Route GET /foo does not exist. Available endpoints: /health, /providers, ..."
}
```

### Server Error (500)

```json
{
  "error": "Internal server error",
  "message": "Something went wrong processing GET /tokenPoolInfo. Check server logs for details."
}
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the keys you have. The API works with partial configuration — endpoints gracefully skip providers that aren't configured and return `"status": "skipped"` in the providers array.

### Required for core functionality

| Variable | Used By |
|---|---|
| `DATABASE_URL` | API key storage and analytics tables |
| `ADMIN_API_KEY` | Admin-only endpoints: `/admin/apiKeys/generate`, `/admin/stats`, `/admin/stats/*` |
| `MORALIS_API_KEY` | walletReview, holderAnalysis, tokenPoolInfo, holders |
| `BIRDEYE_API_KEY` | tokenPoolInfo, priceHistory, topTraders, walletReview |
| `ETHPLORER_API_KEY` | getTopEthTokens (Ethereum mainnet only) |
| `ETHERSCAN_API_KEY` | gasFeed (single key for ETH/BASE/BSC via Etherscan V2) |
| `ETH_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |
| `BASE_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |
| `BSC_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |
| `SOL_RPC_URL` | Solana `/holders` and `/tokenHolders` holder scanning, Solana swaps |

### Optional — additional providers

| Variable | Used By |
|---|---|
| `CODEX_API_KEY` | filterTokens, tokenPoolInfo (backup pair discovery), tokenPriceHistory (OHLCV fallback), holderAnalysis (top10 fallback), detailedTokenStats, ws/launchpadEvents |
| `ZERION_API_KEY` | walletReview (PnL fallback) |
| `CMC_API_KEY` | tokenPoolInfo, marketOverview |
| `GOPLUS_ACCESS_TOKEN` | isScam, fullAudit |
| `DEBANK_API_KEY` | walletReview (protocols, approvals) |
| `ARKHAM_API_KEY` | walletReview, holderAnalysis |
| `DUNE_API_KEY` + `DUNE_QUERY_ID` | holderAnalysis |
| `SIM_API_KEY` | tokenHolders (EVM only) |
| `LUNARCRUSH_API_KEY` | marketOverview (sentiment) |
| `REDDIT_CLIENT_ID` + `SECRET` + `USER_AGENT` | fudSearch, marketOverview |
| `X_BEARER_TOKEN` | fudSearch, marketOverview |
| `TELEGRAM_BOT_TOKEN` | fudSearch |
| `BUBBLEMAPS_API_KEY` | holderAnalysis |
| `QUICKINTEL_API_KEY` | isScam, fullAudit |
| `SANTIMENT_API_KEY` | marketOverview |
| `COINGECKO_PRO_API_KEY` | tokenPoolInfo |
| `DEXTOOLS_API_KEY` | tokenPoolInfo |
| `NANSEN_API_KEY` | walletReview |
| `SOL_FEE_TREASURY` | Solana `/swap` native-in fee recipient wallet |
| `SOL_FEE_TREASURY_WSOL_ACCOUNT` + `SOL_FEE_PROGRAM_ID` | Solana `/swap` token-to-SOL fee settlement |
| `SOL_PROTOCOL_FEE_BPS` | Solana `/swap` protocol fee basis points, default `10` |
