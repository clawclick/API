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
| `/tokenPoolInfo` | GET | Token price, market cap, liquidity, pair info |
| `/tokenPriceHistory` | GET | Historical OHLCV price data |
| `/detailedTokenStats` | GET | Bucketed token stats from Codex (cached 30 min) |
| `/isScam` | GET | Quick scam check with risk score |
| `/fullAudit` | GET | Deep contract audit (taxes, ownership, trading flags) |
| `/holderAnalysis` | GET | Holder distribution, concentration, whale tracking |
| `/fudSearch` | GET | Search social mentions for FUD signals |
| `/marketOverview` | GET | Combined sentiment + pool + risk overview |
| `/walletReview` | GET | Wallet PnL, holdings, protocols, activity, approvals |
| `/approve` | GET | Build unsigned approval txs for router, fee wrapper, or Permit2 flows |
| `/swap` | GET | Build unsigned swap transaction |
| `/swapQuote` | GET | Get swap quote (amount out) |
| `/swapDexes` | GET | List available DEXes for a chain |
| `/unwrap` | GET | Build unsigned wrapped-native withdraw tx |
| `/trendingTokens` | GET | Currently trending tokens |
| `/newPairs` | GET | Recently created pairs/pools |
| `/topTraders` | GET | Top traders for a token (multi-chain via Birdeye) |
| `/gasFeed` | GET | Current gas prices (EVM chains) |
| `/tokenSearch` | GET | Search tokens by name/symbol/address |
| `/filterTokens` | GET | Filter tokens by metrics (Codex, cached 5 min) |
| `/tokenHolders` | GET | Raw token-holder ledger for EVM tokens (Sim by Dune) |
| `/ws/launchpadEvents` | WS | Real-time launchpad token event stream |

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

Raw token-holder ledger for EVM tokens via Sim by Dune. This is separate from `holderAnalysis`: it returns paginated holder rows rather than a concentration/risk summary.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `tokenAddress` | string | **yes** | — | Token contract address |
| `network` | string | no | `eth` | EVM chain: `eth`, `base`, `bsc` |
| `cursor` | string | no | — | Pagination token from the previous response |
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
      "source": "pumpFun",
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
| `MORALIS_API_KEY` | walletReview, holderAnalysis, tokenPoolInfo |
| `BIRDEYE_API_KEY` | tokenPoolInfo, priceHistory, topTraders, walletReview |
| `ETHERSCAN_API_KEY` | gasFeed (single key for ETH/BASE/BSC via Etherscan V2) |
| `ETH_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |
| `BASE_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |
| `BSC_RPC_URL` | tokenPoolInfo, holderAnalysis (on-chain calls) |

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
| `SIM_API_KEY` | tokenHolders |
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