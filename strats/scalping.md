# Hardened Scalping Strategy

API-first scalping playbook for OpenClaw agents. This strategy is built to harvest many small intraday moves while staying extremely selective on execution quality, scam risk, and liquidity.

Primary chain is `sol`. Secondary fallback is `bsc`. Do not route this strategy to Ethereum because fee drag is too high for small-profit scalps.

---

## Mission

Scalping is not "buy anything moving." The goal is to repeatedly capture small, fast, high-probability moves while keeping:

- fees tiny
- slippage controlled
- exit paths obvious
- scam risk near zero
- time-in-trade short

This strategy is intentionally stricter than the swing guide. It prefers missing a trade over getting trapped in one, but also alot of trades are needed to make a profit worth scalping for.

---

## Chain Policy

### Allowed

- `sol` first choice
- `bsc` only when SOL has no valid setups or wallet capital is isolated on BSC

### Not allowed

- `eth`
- `base`

### Why

- scalping needs cheap entry and cheap exit
- Ethereum gas can erase the expected edge from small intraday moves
- Base is cheap, but the user explicitly wants this strategy constrained to SOL or BSC

---

## Endpoint Map

### Core trading decisions

- `/filterTokens`
- `/volatilityScanner`
- `/priceHistoryIndicators`
- `/detailedTokenStats`
- `/tokenPriceHistory`
- `/tokenPoolInfo`
- `/swapQuote`
- `/swap`

### Safety and quality gates

- `/isScam`
- `/fullAudit` for `bsc`
- `/holderAnalysis`
- `/holders`
- `/tokenHolders`
- `/fudSearch`
- `/marketOverview`

### Discovery and queue building

- `/trendingTokens`
- `/newPairs`
- `/tokenSearch`
- `/topTraders`
- `WS /ws/launchpadEvents`

### Execution and wallet controls

- `/walletReview`
- `/swapDexes`
- `/approve` for `bsc`
- `/unwrap` for `bsc`
- `/gasFeed` for `bsc`

### Reliability and operator monitoring

- `/health`
- `/providers`
- `WS /ws/agentStats`
- `/admin/stats`
- `/admin/stats/agents`

### Explicitly not used for this strategy

- `/getTopEthTokens`
- `/getNewEthTradableTokens`

Those are ETH-only discovery endpoints and do not fit the SOL/BSC-only scope.

---

## Philosophy

This is a momentum-reversion scalp, not a launch sniper and not a long hold.

The agent looks for:

- liquid tokens already trading actively
- small pullbacks inside strong short-term participation
- entries near local support or VWAP discount
- exits into quick mean reversion, micro resistance, or fading momentum

The agent avoids:

- fresh, unseasoned launches
- one-candle pumps
- low-liquidity names
- tokens with heavy holder concentration
- names that need wide slippage to fill

---

## Phase 0: Infrastructure Preflight

Before any scan or trade, confirm the API and providers are healthy.

### Step 0a - API health

```
GET /health
GET /providers
```

Hold off if:

- the server is unhealthy
- a required provider for price, risk, or execution is failing
- route availability is partial for both pricing and swapping at the same time

### Step 0b - Agent quality telemetry

If the agent is running continuously, watch operational quality too:

- `WS /ws/agentStats`
- `/admin/stats`
- `/admin/stats/agents`

Do not auto-trade if request failure rate or latency has spiked enough that quotes may be stale before execution.

---

## Phase 1: Build the Tradable Universe

The tradable universe is narrow on purpose. Hardened scalping begins by filtering out most tokens.

### Step 1a - Primary universe with `/filterTokens`

Run SOL first:

```
GET /filterTokens?network=sol&minLiquidity=150000&minVolume24=750000&minHolders=500&sortBy=volume24&sortDirection=DESC&limit=50&statsType=FILTERED
```

Run BSC only as fallback:

```
GET /filterTokens?network=bsc&minLiquidity=200000&minVolume24=1000000&minHolders=600&sortBy=volume24&sortDirection=DESC&limit=50&statsType=FILTERED
```

### Hard filter rules

Discard any token with:

- `liquidity` below 10x intended position size
- `volume24h` below 25x intended position size
- `top10HoldersPct` above 35
- `devHeldPct` above 5
- `sniperCount` materially elevated for the liquidity profile
- `bundlerCount` elevated and recent
- `walletAgeAvg` extremely low relative to comparable names
- `change5m` already too extended in the same direction you would chase

### Step 1b - Add context from `/trendingTokens`

```
GET /trendingTokens
```

Use this as a discovery overlay, not a buy signal.

Prefer tokens that are trending and also passed the stricter `/filterTokens` gates. Ignore names that are only trending because of a blow-off move.

### Step 1c - Use `/newPairs` and `WS /ws/launchpadEvents` only as early warning

```
GET /newPairs?source=all&limit=20
```

Fresh launches are not immediate scalps in this hardened version. They are watchlist candidates only.

Minimum seasoning before a token can become tradeable:

- at least 60 minutes since pair creation on SOL
- at least 120 minutes since pair creation on BSC
- enough trading history to compute 1m and 5m indicators reliably

If the launchpad stream surfaces a new token, queue it for later review instead of buying straight from the event feed.

---

## Phase 2: Microstructure Candidate Scoring

Once the broad universe is built, rank only short-term movers that still have two-way flow.

### Step 2a - Short-window volatility scan

SOL:

```
GET /volatilityScanner?chain=sol&minVolume=750000&minSwingPct=3&duration=min5&maxResults=20
```

BSC:

```
GET /volatilityScanner?chain=bsc&minVolume=1000000&minSwingPct=3&duration=min5&maxResults=20
```

For scalping, the important fields are:

- `swingScore`
- `swingPct`
- `currentPosition`
- `buyVsSellRatio`
- `volumeTrend`
- `volumeChangePct`

### Preferred candidate profile

- `swingScore >= 65`
- `swingPct` between 3 and 8
- `currentPosition` between 0.15 and 0.45 for long entries
- `buyVsSellRatio` between 0.8 and 1.8
- `volumeTrend = rising` or `flat`
- `volumeChangePct` not collapsing

Reject if:

- `swingPct` is too large and unstable for a scalp
- `currentPosition > 0.7`
- `buyVsSellRatio` is extremely one-sided
- `volumeTrend = falling` while price is still elevated

### Step 2b - Pool sanity check

```
GET /tokenPoolInfo?chain=sol&tokenAddress=<address>
GET /tokenPoolInfo?chain=bsc&tokenAddress=<address>
```

Use this to confirm:

- real pair/pool exists
- pool liquidity matches the screener profile
- market cap is not absurd relative to liquidity
- price and pair metadata are coherent across sources

---

## Phase 3: Safety Before Speed

Scalping still dies on bad tokens. Run safety checks before any indicator work.

### Step 3a - Fast scam gate

```
GET /isScam?chain=sol&tokenAddress=<address>
GET /isScam?chain=bsc&tokenAddress=<address>
```

Immediate reject if:

- `isScam = true`
- `riskLevel >= 40`
- warnings mention sell restrictions, freeze risk, or severe holder manipulation

### Step 3b - Deep audit on BSC

```
GET /fullAudit?chain=bsc&tokenAddress=<address>
```

Immediate reject if:

- `buyTax` or `sellTax` is above 2
- cannot fully sell
- token is mintable
- transfer can be paused
- ownership controls are dangerous

SOL does not use `/fullAudit`, so rely more heavily on scam score, holders, liquidity quality, and sentiment.

### Step 3c - Holder concentration

```
GET /holderAnalysis?chain=<chain>&tokenAddress=<address>
GET /holders?chain=<chain>&tokenAddress=<address>&limit=10
GET /tokenHolders?network=<chain>&tokenAddress=<address>&limit=25
```

Reject if:

- top holders dominate supply
- holder distribution is getting worse intraday
- one or two wallets clearly control the tape

Good scalping names usually have enough distribution that one wallet cannot instantly break the market.

### Step 3d - Sentiment and market regime

```
GET /fudSearch?chain=<chain>&symbol=<symbol>
GET /marketOverview?chain=<chain>&tokenAddress=<address>
```

Reject or downgrade if:

- there is active exploit, rug, freeze, or dev-dump chatter
- broader market conditions are risk-off and the token is weak relative to market

---

## Phase 4: Entry Setup Confirmation

Only now do we confirm whether the token is in a scalpable structure.

### Step 4a - Indicators on 1m and 5m

```
GET /priceHistoryIndicators?chain=<chain>&tokenAddress=<address>&indicatorTimeFrame=1m
GET /priceHistoryIndicators?chain=<chain>&tokenAddress=<address>&indicatorTimeFrame=5m
```

For a long scalp, prefer this alignment:

- 5m trend not bearish
- 1m shows pullback exhaustion or fresh turn upward
- RSI recovering from oversold instead of already overbought
- MACD histogram improving on 1m
- price near lower Bollinger zone or below VWAP but reclaiming
- OBV not deteriorating
- support levels nearby and intact

### Step 4b - Participation check

```
GET /detailedTokenStats?chain=<chain>&tokenAddress=<address>&durations=min5,hour1&bucketCount=12
```

Require:

- active buyers and sellers in `min5`
- no severe collapse in current 5-minute participation
- `hour1` participation strong enough that the token is not a one-burst ghost

Reject if:

- volume is too thin in `min5`
- buys are absent
- only a few wallets are trading

### Step 4c - Raw candle confirmation

```
GET /tokenPriceHistory?chain=<chain>&tokenAddress=<address>&timeFrame=1m
GET /tokenPriceHistory?chain=<chain>&tokenAddress=<address>&timeFrame=5m
```

Use raw candles to verify:

- local higher low or support retest
- wick rejection instead of straight bleed
- no single giant candle dominating the whole move
- enough candle count for structure, not noise

### Step 4d - Smart money participation

```
GET /topTraders?chain=<chain>&tokenAddress=<address>&timeFrame=1h
```

This is not a copy-trading signal. It is a tape-quality filter.

Prefer:

- multiple active traders
- balanced buy and sell flow
- no evidence that one wallet is the whole market

Reject if the move looks manufactured by very few participants.

---

## Entry Rules

Enter only when all core rules and at least 3 confirmation rules are true.

### Core rules

- chain is `sol` or `bsc`
- token passed all safety gates
- liquidity and volume meet thresholds
- setup is not a fresh launch inside the no-trade seasoning window
- current position is below mid-range, not at breakout extension

### Confirmation rules

- 5m `summary.signal` is `buy` or `strong_buy`
- 1m RSI moved out of oversold and is rising
- 1m MACD histogram turned positive or less negative
- price reclaimed VWAP or strongest nearby support
- OBV trend is accumulating or stabilizing
- `min5` buyers and sellers are both active
- raw candles show higher-low behavior

### No-chase rule

Do not buy if price is already more than 1.5 ATR above local reclaim or already at upper Bollinger / near resistance. Let the trade go.

---

## Phase 5: Execution

### Step 5a - Wallet and route discovery

```
GET /walletReview?chain=sol&walletAddress=<wallet>&days=7&pageCount=5
GET /walletReview?chain=bsc&walletAddress=<wallet>&days=7&pageCount=5
GET /swapDexes?chain=sol
GET /swapDexes?chain=bsc
```

Use this to confirm:

- wallet has spendable balance
- no unresolved approval or routing assumptions
- DEX list is known before quoting

### Step 5b - Fee gate

For BSC:

```
GET /gasFeed?chain=bsc
```

For SOL, keep a native balance reserve via wallet review and on-chain balance confirmation. There is no dedicated SOL gas feed endpoint in this API.

Abort if:

- estimated round-trip fees exceed 10% of expected scalp profit
- post-trade native balance would be too low to exit safely

### Step 5c - Quote across routes

Always quote before entry, and re-quote right before submit.

Examples:

```
GET /swapQuote?chain=sol&dex=raydium&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=50
GET /swapQuote?chain=sol&dex=meteora&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=50
GET /swapQuote?chain=bsc&dex=pancakeswapV2&tokenIn=native&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=75
GET /swapQuote?chain=bsc&dex=pancakeswapV3&tokenIn=native&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=75
```

Take the route with:

- best `amountOut`
- acceptable price impact
- no weird output divergence across routes

### Slippage limits

- SOL default: `50` bps
- SOL hard max: `100` bps
- BSC default: `75` bps
- BSC hard max: `125` bps

If a token needs more than that to fill, it is not hardened-scalp quality.

### Step 5d - Approval flow for BSC only

```
GET /approve?chain=bsc&dex=<dex>&walletAddress=<wallet>&tokenIn=<tokenIn>&tokenOut=<tokenOut>&approvalMode=auto
```

Only run approvals when needed. Never assume old allowances are correct.

### Step 5e - Execute

SOL:

```
GET /swap?chain=sol&dex=<best_dex>&walletAddress=<wallet>&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=50
```

BSC:

```
GET /swap?chain=bsc&dex=<best_dex>&walletAddress=<wallet>&tokenIn=native&tokenOut=<token>&amountIn=<raw_amount>&slippageBps=75
```

### Step 5f - Settlement confirmation

After every buy or sell:

- confirm transaction hash exists
- confirm wallet balances changed in the intended direction
- confirm position is logged only after settlement

If execution failed:

- refresh quote once
- retry once only if all safety and fee checks still pass
- otherwise skip the trade

### Step 5g - Unwrap when needed on BSC

If the strategy exits into wrapped native and needs gas-token inventory normalized:

```
GET /unwrap?chain=bsc&walletAddress=<wallet>&amount=<raw_wbnb_amount>
```

---

## Exit Rules

Scalping exits should be quick and boring. Small wins compound. Overstaying kills the edge.

### Take-profit triggers

Exit when any one of these happens:

- price hits nearest 1m or 5m resistance
- price tags upper Bollinger and momentum flattens
- RSI pushes into overbought and stops expanding
- MACD histogram rolls over after entry impulse
- quote-implied profit target is reached after fees

### Hard stop triggers

Exit immediately when any one of these happens:

- price closes below local support or reclaim level
- price falls 1 ATR below entry after the setup was supposed to bounce
- 5m `summary.signal` flips to `strong_sell`
- safety profile worsens materially
- liquidity vanishes or spread widens sharply

### Time stop

If the scalp has not worked quickly, it is probably wrong.

- default max hold on SOL: 20 minutes
- default max hold on BSC: 30 minutes

If the trade is flat and opportunity cost is rising, exit and recycle capital.

### Partial profit rule

Optional for stronger names:

- sell 50% at first target
- move stop on remainder to breakeven or slightly positive
- exit the rest on momentum fade

If owner rules do not explicitly allow partials, use full exits only.

---

## Position Sizing

This strategy should trade small because it trades often.

- risk per scalp: 0.25% to 0.50% of total portfolio
- max per-position capital: 2% of portfolio
- max total deployed to active scalps: 8% of portfolio
- max concurrent scalps: 3
- if `riskLevel` is elevated but still allowed, halve size again

Never let one scalp matter emotionally or financially.

---

## Hold-Off Rules

Do not enter a new scalp when:

- API health is degraded
- execution providers are partial
- BSC gas spikes enough to compress edge
- wallet does not have exit-fee reserve
- token just launched and has not seasoned
- token is up too much already in the last 5 minutes
- holder concentration worsened intraday
- sentiment is deteriorating
- broader market regime is risk-off

Also hold off after 2 consecutive losses on the same token in the same session. Put that token into cooling-off.

---

## Cooling-Off Queue

Use a rejection queue so the agent does not re-enter broken names too quickly.

Suggested cooldowns:

- failed bounce: 15 minutes
- spread/slippage failure: 30 minutes
- support break: 60 minutes
- scam or sentiment escalation: rest of day

---

## Recommended Heartbeat

### Fast loop: every 1 minute

- review open positions
- refresh 1m indicators
- watch for take-profit or hard-stop conditions

### Medium loop: every 5 minutes

- refresh 5m indicators
- refresh `detailedTokenStats`
- re-rank watchlist

### Slow loop: every 15 minutes

- refresh safety checks on held/watchlist names
- refresh holder analysis
- refresh sentiment

### Event-driven

- process `WS /ws/launchpadEvents` as watchlist seeding only
- use `WS /ws/agentStats` to pause trading if request quality degrades

---

## Decision Tree

### New entry

1. `health/providers` healthy
2. universe passes `/filterTokens`
3. token still attractive in `/volatilityScanner`
4. token passes `/isScam`
5. token passes holder and sentiment checks
6. indicators align on 1m and 5m
7. quote is acceptable on at least one route
8. execute

### Open position

1. refresh 1m and 5m indicators
2. if hard stop hit, exit
3. if take-profit hit, exit or partial
4. if time stop hit, exit
5. otherwise continue monitoring

---

## Autonomous Guardrails

Before auto-execution begins, the owner must still define:

- max trade size
- max daily loss
- stop-after-profit threshold
- whether partial exits are allowed
- whether BSC is enabled or SOL-only

If those are not present in workspace rules, the agent may scan and propose but must not trade.

---

## Default Hardened Preset

If the owner explicitly asks for defaults, use this conservative preset:

- chain preference: `sol` only
- enable `bsc` only if no SOL setups for 3 consecutive scan cycles
- minimum liquidity: `$150k` on SOL, `$200k` on BSC
- minimum 24h volume: `$750k` on SOL, `$1m` on BSC
- max slippage: `50` bps SOL, `75` bps BSC
- max hold time: `20m` SOL, `30m` BSC
- no fresh-launch buys
- no averaging down
- no overnight holds

---

## Summary

This strategy uses nearly every relevant decision-making endpoint in the API, but with one priority order:

1. survive scams and bad liquidity
2. preserve fee efficiency
3. take only short, high-quality mean-reversion momentum scalps
4. exit fast

SOL should produce the majority of trades. BSC is acceptable, but only when it meets the same execution-quality standard.
