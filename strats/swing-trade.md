# Swing Trade Strategy

Automated swing-trading strategy for OpenClaw agents. Find volatile tokens with consistent 10%+ price swings, enter at support, exit at resistance, and know when to hold off.

---

## Overview

Swing trading profits from tokens that oscillate between predictable support and resistance levels. The ideal candidate has:

- **High volume** — enough liquidity to enter and exit without major slippage
- **Consistent volatility** — regular 10-20%+ swings up and down, not a one-time pump
- **Established range** — visible support/resistance levels on 1h or 4h candles
- **Not a scam** — passes basic safety checks (no honeypot, reasonable taxes)

---

## Phase 1: Find Candidates

### Step 1 — Screen for high-volume volatile tokens

Call `/filterTokens` to get tokens with meaningful volume and liquidity:

```
GET /filterTokens?network=sol&minVolume24=100000&minLiquidity=50000&sortBy=volume24&sortDirection=DESC&limit=50
```

Repeat for other chains:

```
GET /filterTokens?network=eth&minVolume24=500000&minLiquidity=200000&sortBy=volume24&sortDirection=DESC&limit=50
```

```
GET /filterTokens?network=base&minVolume24=100000&minLiquidity=50000&sortBy=volume24&sortDirection=DESC&limit=50
```

> **Why ETH thresholds are higher:** gas costs on Ethereum are significantly more expensive. Your minimum swing profit must cover round-trip gas, so only tokens with materially higher volume are worth trading on ETH. SOL and Base have cheap gas, so lower volume tokens can still be profitable.

**What to look for in results:**
- `change24h` — this is a **fraction** (e.g. `0.15` = 15%, `-0.08` = -8%). Absolute value > 0.10 means the token moves
- `liquidity` high enough that your position size won't move the price (aim for position < 1% of liquidity)
- `volume24h` at least 5x your intended position size
- `buyCount24h` vs `sellCount24h` — both should be active, not one-sided

### Step 2 — Call `/volatilityScanner` for swing-specific scoring

```
GET /volatilityScanner?chain=sol&minVolume=100000&minSwingPct=10&maxResults=20
```

This returns tokens pre-scored for swing suitability. Each candidate includes:
- `swingScore` — composite ranking 0-100 (higher = better swing candidate)
- `swingPct` — peak-to-trough swing percentage from the stats window high/low
- `avgSwingPct` — average percentage of each detected swing cycle in the price history
- `swingCount` — number of distinct swing cycles detected (peak→trough or trough→peak)
- `support` / `resistance` — estimated price levels from high/low of the window
- `currentPosition` — where price sits relative to the range (0.0 = at support, 1.0 = at resistance)
- `buyVsSellRatio` — buy txns / sell txns (1.0 = balanced)

**Prioritize tokens where:**
- `swingCount` >= 3 (proven repeating pattern — this is the strongest signal)
- `avgSwingPct` between 10 and 40 (too high = unstable, too low = not worth the gas)
- `currentPosition` < 0.3 (near support — good entry) or > 0.7 (near resistance — wait or short)
- `buyVsSellRatio` between 0.5 and 2.0 (balanced two-way market, not a dump)
- `swingScore` >= 60

### Step 3 — Safety check each candidate

Before committing to any token, run the scam triage:

```
GET /isScam?chain=sol&tokenAddress=<address>
```

Response fields: `isScam` (boolean), `riskLevel` (0-100 scale), `warnings` (string array).
- If `isScam` is `true`, skip immediately
- If `riskLevel` >= 60, skip (high-risk)
- If `riskLevel` >= 30, proceed with caution and smaller position

For deeper analysis on EVM chains:

```
GET /fullAudit?chain=eth&tokenAddress=<address>
```

**Disqualify tokens with:**
- `taxes.buyTax` or `taxes.sellTax` > 5 (eats your swing profit)
- `trading.cannotSellAll` is `true` (honeypot)
- `contract.isMintable` is `true` (supply can be inflated)
- `trading.transferPausable` is `true` (owner can freeze trading)
- `holders.holderCount` < 100

---

## Phase 2: Analyze Price Action

### Step 4 — Use technical indicators to confirm the setup

```
GET /priceHistoryIndicators?chain=sol&tokenAddress=<address>&indicatorTimeFrame=1h
```

This returns full OHLCV candles plus computed indicators. Check:

1. **RSI** (`indicators.rsi`):
   - `value` < 35 and `signal` = `"oversold"` → strong buy zone
   - `value` > 65 and `signal` = `"overbought"` → wait or sell
   - Between 35-65 → neutral, look at other indicators

2. **MACD** (`indicators.macd`):
   - `histogram` turning positive with `trend` = `"bullish"` → momentum shifting up
   - `histogram` negative and `trend` = `"bearish"` → don't enter yet

3. **Bollinger Bands** (`indicators.bollingerBands`):
   - `percentB` < 0.2 → price near lower band, potential bounce
   - `percentB` > 0.8 → price near upper band, potential reversal

4. **Support/Resistance** (`indicators.supportResistance`):
   - `support` array — up to 3 key support levels ranked by strength
   - `resistance` array — up to 3 key resistance levels ranked by strength
   - Use the strongest (first) support as your entry target
   - Use the strongest (first) resistance as your exit target

5. **EMA alignment** (`indicators.ema`):
   - `short > medium > long` → uptrend, good for buying dips
   - `short < medium < long` → downtrend, avoid or wait

6. **VWAP** (`indicators.vwap`):
   - Price below `value` → undervalued relative to volume, potential long
   - Price above `upperBand` → overextended

7. **Summary** (`indicators.summary`):
   - `signal` of `"strong_buy"` or `"buy"` → indicators align for entry
   - `signal` of `"sell"` or `"strong_sell"` → don't enter
   - Check `bullishCount` vs `bearishCount` — want at least 4 bullish out of 7

**Ideal entry conditions (at least 3 of these should be true):**
- RSI oversold or near 35
- Price at or below strongest support level
- MACD histogram turning positive
- Bollinger %B below 0.2
- Price below VWAP
- Summary signal is `"buy"` or `"strong_buy"`

### Step 5 — Confirm with detailed stats

```
GET /detailedTokenStats?chain=sol&tokenAddress=<address>&durations=hour1,hour4,day1&bucketCount=12
```

Check the `hour4` window:
- `statsUsd.volume.currentValue` should show consistent activity (not just one spike)
- `statsNonCurrency.buyers.currentValue` and `sellers.currentValue` should both be active
- `statsNonCurrency.buys.currentValue` vs `sells.currentValue` ratio between 0.4 and 2.5

Compare `hour1` volume vs `hour4` average:
- `hour1.statsUsd.volume.currentValue` should be at least 40% of `hour4.statsUsd.volume.currentValue / 4`
- If much lower, the token may be losing momentum

### Step 5b — Use raw candles for manual pattern analysis

If indicators alone are ambiguous (e.g. summary is `"neutral"`, mixed signals), pull raw OHLCV candles to visually inspect the structure:

```
GET /tokenPriceHistory?chain=sol&tokenAddress=<address>&timeFrame=1h
```

Use raw candles to:
- confirm the swing pattern visually — are the highs and lows actually alternating, or is it a stair-step trend?
- identify support/resistance levels that the computed `supportResistance` indicator may have missed
- spot range compression (narrowing candles) that often precedes a breakout — not ideal for swing entry
- verify that recent candles have healthy wicks in both directions (two-way trading, not one-side dumps)

If the raw candles show a clear downtrend (lower highs + lower lows) rather than oscillation, the swing thesis is invalid regardless of what other indicators say.

---

## Phase 3: Execute the Trade

### DEX selection

If the API supports multiple DEXes for a chain, quote across them and pick the best output. Default preferences when only one quote is needed:

| Chain | Default DEX | Notes |
|-------|-------------|-------|
| SOL | `raydium` | Best liquidity for most SPL tokens |
| ETH | `uniswap_v3` | Concentrated liquidity gives tighter spreads |
| Base | `uniswapV3` | Same router as ETH but cheaper gas |
| BSC | `pancakeswap_v2` | Dominant DEX for BEP-20 tokens |

When in doubt, call `/swapQuote` on two DEXes and take the one with the higher `amountOut`. The extra API call is cheap compared to getting a worse fill.

### Step 6 — Pre-trade checklist

Before executing any trade, verify all of the following:

**6a — Check wallet balance**

Verify on-chain that the wallet has enough of the input token (native or stablecoin) to cover the trade amount. If the API provides a balance endpoint, use it. Otherwise confirm the balance from the wallet's on-chain state before proceeding.

Abort the trade if the wallet balance is less than the intended trade amount.

**6b — Check gas costs**

```
GET /gasFeed?chain=sol
```

For EVM chains, ensure gas costs don't eat a significant portion of your expected profit. If expected swing profit is $50 and gas round-trip is $20, the trade isn't worth it.

**6c — Gas reserve gate**

After this trade, the wallet must retain enough native token to cover exit gas. Calculate:

- estimated exit gas cost = current gas price × estimated swap gas units (use 2x the entry gas as a safe estimate)
- post-trade native balance = current native balance - trade amount (if trading native) - entry gas
- if post-trade native balance < 2× estimated exit gas cost → **abort the trade**

This prevents getting stuck in a position you cannot afford to exit.

### Slippage guidance

Slippage tolerance controls how much price movement you accept between quoting and execution.

| Chain | Default slippage | When to increase |
|-------|-----------------|------------------|
| SOL | 100 bps (1%) | Low-liquidity tokens: up to 200 bps |
| ETH | 50 bps (0.5%) | Volatile memecoins: up to 150 bps |
| Base | 200 bps (2%) | Non-standard ERC-20s: up to 300 bps |

**Rules:**
- Never exceed 300 bps without explicit owner override
- If a swap fails due to slippage and the token is still worth buying, increase by 50 bps and retry once
- If a token consistently needs > 200 bps to fill, that's a liquidity red flag — reconsider the trade
- Higher slippage = more MEV exposure (sandwiching). Keep it as tight as possible while still filling

### Step 7 — Get a quote

Before placing a buy, always quote:

```
GET /swapQuote?chain=sol&dex=raydium&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<target_token>&amountIn=<amount_in_lamports>&slippageBps=100
```

Check `amountOut` and verify the price is still near your target entry. If price has moved more than 3% above your calculated support level, **wait for a pullback** — don't chase.

### Step 8 — Place the entry (buy at support)

```
GET /swap?chain=sol&dex=raydium&walletAddress=<wallet>&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<target_token>&amountIn=<amount_in_lamports>&slippageBps=100
```

For EVM chains, you need approval first:

```
GET /approve?chain=eth&dex=uniswap_v3&walletAddress=<wallet>&tokenIn=<token_in>&tokenOut=<token_out>
```

Then swap:

```
GET /swap?chain=eth&dex=uniswap_v3&walletAddress=<wallet>&tokenIn=<token_in>&tokenOut=<target_token>&amountIn=<amount_wei>&slippageBps=50
```

### Step 8b — Confirm the transaction landed

After every `/swap` call, verify the trade actually settled:

1. Check the returned transaction hash. If the response has no tx hash or returned an error, the trade did not execute — do **not** log a position.
2. Verify the token balance changed. If the wallet's token balance did not increase (for buys) or decrease (for sells), the transaction may have reverted silently.
3. Only after confirmed settlement should the agent log the position as open and record the entry price.

**If the swap fails:**
- Re-fetch a fresh `/swapQuote` — the old quote may have expired
- Retry once with the fresh quote
- If the retry also fails, skip this token for the current heartbeat cycle and log the failure
- If an EVM approval tx fails, do **not** proceed to the swap step
- Never retry more than once without re-checking gas + balance

### Step 9 — Monitor and exit at resistance

Monitor using indicators on a faster timeframe:

```
GET /priceHistoryIndicators?chain=sol&tokenAddress=<address>&indicatorTimeFrame=5m
```

**Exit signals (sell when ANY of these hit):**
- Price reaches strongest resistance level from Step 4
- RSI crosses above 70 (overbought)
- MACD histogram turns negative after being positive (momentum fading)
- Bollinger %B > 0.95 (price hitting upper band)
- Summary signal flips to `"sell"` or `"strong_sell"`

Place the sell:

```
GET /swap?chain=sol&dex=raydium&walletAddress=<wallet>&tokenIn=<target_token>&tokenOut=So11111111111111111111111111111111111111112&amountIn=<token_balance>&slippageBps=100
```

After every sell, confirm settlement using the same Step 8b process. Verify the token balance went to zero (or the intended sell amount) and native/stablecoin balance increased.

### API-first execution notes for Base / EVM memecoins

For Base memecoins and other non-standard ERC-20s, prefer an **API-first exit path** over local router assumptions:

1. Check balance on-chain first.
2. Call `/approve` with `approvalMode=auto`.
3. Submit the returned approval tx if any step is returned.
4. Call `/swap` for the sell route and sign/send that tx.
5. Re-check token balance after the sell.

Do **not** rely on a local allowance pre-check as the source of truth. Some tokens revert on `allowance()` calls even though the API-provided approval + swap path works.

If local price watchers disagree with API quotes or report zero / nonsense prices:
- trust `/swapQuote` and `/priceHistoryIndicators` over the local watcher
- do not auto-trigger stop-loss from a zero price read
- fall back to manual/API-driven exit handling

Suggested Base sell sequence:

```
GET /approve?chain=base&dex=uniswapV3&walletAddress=<wallet>&tokenIn=<token>&tokenOut=native&amount=<raw_token_amount>&approvalMode=auto
GET /swap?chain=base&dex=uniswapV3&walletAddress=<wallet>&tokenIn=<token>&tokenOut=native&amountIn=<raw_token_amount>&slippageBps=200
```

---

## Phase 4: Risk Management & Hold-Off Rules

### When to HOLD OFF (do not enter this round)

1. **Failed rebound**: Price broke below support by > 5% and hasn't recovered in 2+ candles on your timeframe. The range is breaking down — stay out until a new range forms.

2. **Volume collapse**: Check `/detailedTokenStats` — if `hour1` volume is less than 25% of `hour4` volume / 4, the swing pattern may be dying.

3. **Buyer/seller imbalance**: If sells outnumber buys by > 3:1 in the last hour, momentum is one-directional. Wait for balance to return.

4. **Whale dump detected**: Use `/holderAnalysis` to check if top holders are reducing. If `top10HoldersPercent` dropped significantly (> 5% change), whales may be exiting.

5. **Market-wide downturn**: Check `/marketOverview` for the chain's overall sentiment. If the broader market is crashing, individual token swings become unreliable.

6. **Negative sentiment**: Run `/fudSearch` with the token name — if there's active scam/exploit chatter, exit or avoid entirely.

7. **Indicators bearish**: If `/priceHistoryIndicators` returns `summary.signal` of `"strong_sell"` and `bearishCount` >= 5, stay out regardless of price level.

### Stop-loss rules

- **Hard stop**: If price drops > 12% below your actual entry price (not support), sell immediately. The swing thesis is broken.
- **Time stop**: If price hasn't moved toward resistance within 12 hours of entry (for 1h timeframe) or 4 hours (for 5m/15m timeframe), re-evaluate. Close if indicators have turned bearish.
- **Trailing stop**: Once price is > 50% of the way to resistance, set a trailing stop at 5% below current price. Tighten to 3% once > 75% of the way.
- **Indicator stop**: If RSI was oversold at entry but is now neutral and price hasn't moved up meaningfully (< 3%), consider cutting — the bounce may not come.

### Position sizing

- Never put more than 5% of your total portfolio in a single swing trade
- Never put more than 15% of portfolio across all active swing trades
- Scale in: buy 50% at support, add 25% if price holds above support for 2-3 candles, add final 25% only if momentum confirms (MACD bullish crossover or OBV accumulating)
- Always keep enough gas token reserved for exit transactions (at least 2x the gas cost of entry)
- For tokens with `riskLevel` between 30-60 from `/isScam`, halve your position size

### Re-entry rules

If the agent exits a position at resistance and the same token later drops back toward support, it may re-enter. This is a common and valid swing pattern.

**Re-entry is allowed if all of the following are true:**
- the last exit on this token was profitable
- at least 30 minutes have passed since the exit (cooling-off)
- the token passes a fresh safety check (`/isScam`)
- fresh indicators confirm a new buy setup (RSI oversold, summary signal buy/strong_buy, etc.)
- support level has not broken since the last exit
- the token still meets all Phase 1 screening criteria (volume, liquidity, swing score)

**Re-entry is NOT allowed if:**
- the last exit was a stop-loss (the thesis was invalidated)
- the token's risk level increased since last check
- liquidity dropped materially since the last trade
- the agent is trying to "revenge trade" a name that lost money

Treat each re-entry as a fresh position for sizing and stop-loss purposes. Do not anchor to the previous entry price.

---

## Monitoring Loop

Once a position is active, agents should poll on a schedule:

| Check | Endpoint | Frequency |
|-------|----------|-----------|
| Price + indicators | `/priceHistoryIndicators?indicatorTimeFrame=5m` | Every 5 min |
| Volume & momentum | `/detailedTokenStats?durations=min5,hour1` | Every 15 min |
| Safety re-check | `/isScam` | Every 6 hours |
| Holder changes | `/holderAnalysis` | Every 1 hour |
| Sentiment shifts | `/fudSearch` | Every 1 hour |
| Gas costs | `/gasFeed` | Before any trade |

### Monitoring decision tree

1. Check `priceHistoryIndicators` summary signal
   - `strong_sell` → **EXIT immediately**
   - `sell` → check if price is near resistance → if yes, EXIT (take profit); if no, set tight trailing stop
   - `neutral` → hold, continue monitoring
   - `buy` / `strong_buy` → hold, consider adding to position if not at max size

2. Check if price hit stop-loss → **EXIT**
3. Check if price hit resistance → **EXIT (take profit)**
4. Check if time stop exceeded → re-evaluate with fresh indicators → EXIT if bearish

---

## Autonomous operation bootstrap

If the owner wants the agent to run autonomously, do **not** start trading immediately unless these owner-defined limits are explicitly known.

### First questions the agent must ask the owner

Before autonomous trading begins, ask for all of the following:

1. **Max trade size**
   - maximum dollar amount per trade
   - optionally also maximum % of wallet per trade
2. **Max daily loss / max loss before stopping entirely**
   - e.g. "$500 daily loss cap" or "stop forever if down $2,000 until owner resets"
3. **Profit lock / stop-after-profit threshold**
   - e.g. "if profit reaches $5,000 total, stop trading and wait for owner"
4. **Allowed chains and token types**
   - e.g. Base only, no brand-new launches, no illiquid tokens, no leveraged products
5. **Position limits**
   - max concurrent positions
   - whether overnight holds are allowed
6. **Risk controls**
   - default stop loss
   - target take profit
   - max slippage
7. **Autonomy mode**
   - scan only / propose only / fully auto-execute

If any of these are missing, the agent should ask the owner first and avoid autonomous execution.

### After the owner answers

The agent should immediately write the confirmed rules into workspace control files so future heartbeat runs stay consistent:

- `HEARTBEAT.md` → short recurring checklist + hard stop conditions
- `MYRULES.md` → durable trading policy and risk limits
- optionally `USER.md` → owner preferences / allowed scope

Keep `HEARTBEAT.md` short and action-oriented. Put detailed rules in `MYRULES.md`.

### Required behavior once autonomous mode is enabled

On heartbeat or scheduled wakeups, the agent should:

1. Check whether autonomy settings are present in workspace files.
2. Refuse to trade if max trade size / max loss / stop-after-profit rules are missing.
3. Check current wallet balances and open positions first.
4. Check whether any stop condition has already been hit:
   - loss cap hit
   - profit cap hit
   - owner pause flag
   - too many open positions
5. Only then scan for swing setups.
6. Only execute trades that fit the stored owner constraints.
7. After each trade, update local state / notes so the next run knows:
   - amount spent
   - token bought
   - stop / target
   - realized P&L if closed
8. If a hard stop is reached, stop trading and alert the owner instead of continuing.

### Hard safety rules for autonomous swing trading

- Never assume risk limits.
- Never increase trade size after losses to "win it back".
- Never continue trading after hitting the owner-defined max loss threshold.
- Never continue trading after hitting the owner-defined stop-after-profit threshold.
- Never bypass missing settings by inventing defaults unless the owner explicitly authorized defaults.
- Prefer no trade over a low-quality trade.

### Heartbeat writing rule

When owner limits are collected, the agent should rewrite `HEARTBEAT.md` into a compact checklist that includes:

- autonomy enabled / disabled
- allowed trading mode
- max trade size
- max loss stop condition
- profit stop condition
- max open positions
- current required actions: manage positions first, then scan, then trade only if valid

If `HEARTBEAT.md` becomes stale or no longer matches the owner rules, update it.

### Suggested `HEARTBEAT.md` structure for swing trading

For this strategy, `HEARTBEAT.md` should define the recurring loop clearly enough that the agent can wake up, inspect state, and act consistently.

Recommended sections:

1. **Mode**
   - scan only / propose only / auto-execute
   - allowed chains
   - allowed DEXes

2. **Cadence**
   - full market scan interval
   - open-position review interval
   - sentiment and holder recheck interval
   - wallet/P&L sync interval

3. **Capital rules**
   - max per-position size
   - max total deployed capital
   - max concurrent positions
   - max daily loss
   - stop-after-profit threshold

4. **Open-position priority rule**
   - always review held positions before searching for new ones
   - if any hard stop is hit, exit first before scanning new trades

5. **Required outputs after every heartbeat**
   - updated watchlist
   - updated open position table
   - actions taken
   - pending orders / pending approvals

### Recommended swing-trade heartbeat cadence

Use two nested loops instead of one giant scan every few minutes.

1. **Fast loop: every 5 minutes**
   - check all open positions
   - refresh indicators for held names
   - evaluate exit, de-risk, hold, or add rules

2. **Medium loop: every 15 minutes**
   - refresh detailed stats for held names
   - refresh shortlist/watchlist candidates
   - remove dead setups and add new candidates

3. **Slow loop: every 60 minutes**
   - run deeper holder/sentiment/safety checks
   - re-rank the watchlist
   - review wallet balances, realized P&L, and available buying power

4. **Event-driven checks**
   - always run `/gasFeed` before a trade
   - always run a fresh `/swapQuote` immediately before buy/sell execution
   - if an asset moves sharply between loops, allow an immediate out-of-band position review

### What the heartbeat should do on each run

Every heartbeat should follow this order:

1. Load owner rules from `MYRULES.md` and current loop state from `HEARTBEAT.md`
2. Load or reconstruct current open positions
3. Sync wallet balances and available cash / native gas reserves
4. Review every open position before looking for new entries
5. Close, reduce, or add to positions if rules say so
6. Only if capital and risk allow, scan for new swing setups
7. Rank new setups and either propose or execute top candidates
8. Write back updated state so the next heartbeat is not guessing

### Multi-chain portfolio management

When trading across SOL, ETH, and Base simultaneously:

- **Loss cap is global**: the daily max loss applies across all chains combined, not per-chain. A $300 loss on SOL + a $200 loss on Base = $500 total, which hits a $500 daily cap.
- **Position limits are global**: if the owner allows 5 concurrent positions, that's 5 total across all chains.
- **Gas reserves are per-chain**: each chain needs its own native token reserve. Having plenty of SOL doesn't help exit an ETH position. Track gas reserves separately for each chain.
- **Rebalancing between chains is out of scope**: this strategy does not bridge funds. If one chain runs low on capital, reduce activity there rather than trying to move funds cross-chain.
- **Scan priority**: concentrate scanning on chains where the agent has capital available. Don't waste API calls scanning ETH if the ETH wallet has $10.

---

## Heartbeat State Model

Autonomous swing trading should not rely on memory alone. The agent should maintain a small, explicit state snapshot for each run.

### Minimum state to persist between heartbeat runs

For each open position, track:

- token address
- chain
- wallet used
- entry timestamp
- average entry price
- current size
- remaining size
- highest price seen since entry
- strongest support at entry
- strongest resistance at entry
- current stop-loss
- current take-profit target
- whether scale-in is still allowed
- whether a partial take-profit already occurred
- last indicator check time
- last sentiment/safety re-check time
- thesis status: active / weakening / invalidated / exiting

For portfolio-level state, track:

- total deployed capital
- available stablecoin or native balance
- gas reserve balance (per chain)
- realized P&L today
- unrealized P&L
- open position count
- whether any hard stop is active

For the watchlist, track:

- token address and chain
- when the token was added to the watchlist
- last swing score and current position
- last safety check result and timestamp
- target entry price (support level)
- reason the token is on the watchlist

For the cooling-off / rejected queue, track:

- token address and chain
- reason for rejection (failed momentum, support break, sentiment, etc.)
- timestamp of rejection
- cooling-off expiry (when the agent may re-evaluate)

### Why this matters

Without persistent position state, the agent cannot answer basic questions reliably:

- Is this token already owned?
- Has the first scale-in already happened?
- Has a trailing stop been tightened already?
- Is the position still inside the original swing thesis?
- Did the owner max-position rule already get hit?

Without a persistent watchlist and cooling-off queue, the agent wastes API calls re-evaluating the same tokens that already failed, every single loop.

If the heartbeat cannot answer those, it should not auto-trade.

## Open Position Review Logic

The open-position review is the most important heartbeat task. It should happen before new token discovery.

### Step 1 — Re-price each open position

For each held token:

```
GET /priceHistoryIndicators?chain=<chain>&tokenAddress=<address>&indicatorTimeFrame=5m
```

Use this to refresh:

- current price
- RSI
- MACD trend
- Bollinger position
- support / resistance drift
- summary signal

### Step 2 — Refresh momentum and participation

```
GET /detailedTokenStats?chain=<chain>&tokenAddress=<address>&durations=min5,hour1,hour4&bucketCount=12
```

Use this to see whether the move still has participation or is fading.

### Step 3 — Re-check risk when required

On slower cadence or after an abnormal move:

```
GET /isScam?chain=<chain>&tokenAddress=<address>
GET /holderAnalysis?chain=<chain>&tokenAddress=<address>
GET /fudSearch?chain=<chain>&symbol=<symbol>&tokenName=<name>
```

### Position review decisions

For each held token, the heartbeat must choose one of five actions:

1. **Hold**
   - thesis remains valid
   - no exit trigger hit
   - no scale-in trigger hit

2. **Take profit / full exit**
   - resistance reached
   - overbought reversal setup
   - momentum breaks down after a strong move

3. **Partial de-risk**
   - price moved strongly in your favor but not to full target
   - sentiment weakened
   - market-wide conditions turned risk-off

4. **Add to position**
   - only if pre-approved by owner rules
   - only if capital remains available
   - only if the token is still respecting support and momentum improved

5. **Hard stop / thesis invalidated exit**
   - stop-loss hit
   - support broke decisively
   - safety or scam flags worsened materially

### When the heartbeat should SELL immediately

Sell now if any of the following are true:

- current price is below hard stop
- price closes below support by more than 5% and does not reclaim
- `summary.signal` becomes `strong_sell`
- MACD trend flips bearish and price is failing to bounce
- a fresh safety check shows sell restriction / honeypot / severe risk escalation
- owner-wide loss cap or emergency pause was hit

### When the heartbeat can SELL partially instead of full exit

Partial exit is better than all-or-nothing in these situations:

- price reached 70-90% of target resistance but not the full target
- RSI is above 68 and flattening
- volume is weakening while price is still elevated
- broader market is turning down, but token has not fully broken yet

Suggested default partial-profit ladder if owner approved it:

- sell 25% near 70% of target range
- sell another 25% near resistance
- let the rest trail with a tighter stop

### When the heartbeat can BUY MORE

Buying more should be much rarer than buying initially. Only allow it if all of these are true:

- the owner explicitly allowed scaling in
- position is still below max allowed size
- support held for at least 2-3 candles after entry
- MACD improved from flat/bearish to bullish
- `summary.signal` is `buy` or `strong_buy`
- no new negative safety/sentiment flags appeared
- current deployed capital remains below portfolio cap

Good scale-in cases:

- first entry filled at support, then price confirms bounce without breaking structure
- position is up modestly but still far from resistance
- volume improves on the rebound

Bad scale-in cases:

- price is already near resistance
- token is moving only because of one impulsive candle
- liquidity dropped materially
- the agent is trying to average down after a broken thesis

Never "buy more" just because price is lower than entry. Average down only if the structure is still intact and rules explicitly allow it.

## New Token Discovery During Heartbeat

Only search for new opportunities after open positions are handled.

### Discovery flow on the 15-minute / 60-minute loop

1. Pull a fresh volatile-token universe:

```
GET /volatilityScanner?chain=<chain>&minVolume=<threshold>&minSwingPct=10&maxResults=20
```

2. Cross-check with broad screeners when needed:

```
GET /filterTokens?network=<chain>&minVolume24=<threshold>&minLiquidity=<threshold>&sortBy=volume24&sortDirection=DESC&limit=50
```

3. Remove tokens already owned unless topping up is allowed.
4. Remove tokens that recently failed the safety checks.
5. Remove tokens that are in the cooling-off queue and haven't expired yet.
6. Rank remaining candidates by:
   - swing score
   - distance to support
   - liquidity quality
   - buy/sell balance
   - indicator alignment
7. Run final confirmation on only the top few names.

### Candidate queue policy

The heartbeat should maintain three buckets:

- **Open positions**: already owned, highest priority
- **Watchlist**: valid candidates not yet bought
- **Rejected / cooling off**: tokens recently disqualified, temporarily ignored

Use a cooling-off period for bad setups so the agent does not re-evaluate the same broken token every 5 minutes.

Recommended cooling-off examples:

- 30 minutes after failed momentum confirmation
- 2 hours after support break
- 6 hours after negative sentiment or whale-dump signal

## Example Heartbeat Routine

### Every 5 minutes

1. Load open positions
2. For each position call `/priceHistoryIndicators?indicatorTimeFrame=5m`
3. Check stop-loss, resistance proximity, MACD change, RSI condition
4. If exit needed, call `/gasFeed`, then `/swapQuote`, then `/swap`, then confirm settlement (Step 8b)
5. If add-to-position is allowed and setup improved, quote the add
6. Persist updated stop levels, highest seen price, and action log

### Every 15 minutes

1. Run `/detailedTokenStats` for every open position
2. Re-rank watchlist candidates with `/volatilityScanner`
3. Remove any candidates already invalidated
4. Expire cooling-off entries that have passed their timer
5. If position slots are available, promote top watchlist names to "ready for entry"

### Every 60 minutes

1. Re-run `/holderAnalysis` on held tokens
2. Re-run `/fudSearch` on held tokens and top watchlist names
3. Re-run `/isScam` on any token that is about to be bought or scaled into
4. Recompute portfolio exposure and realized/unrealized P&L
5. If owner stop conditions are hit, disable further entries in `HEARTBEAT.md`

---

## Example: Full Workflow

```
1. GET /volatilityScanner?chain=sol&minVolume=100000&minSwingPct=10&maxResults=10
   → Returns 10 candidates ranked by swingScore
   → Top hit: address=Dz9mQ9..., swingScore=87, currentPosition=0.15, swingPct=21.4

2. GET /isScam?chain=sol&tokenAddress=Dz9mQ9...
   → isScam: false, riskLevel: 12, warnings: [] ✓

3. GET /priceHistoryIndicators?chain=sol&tokenAddress=Dz9mQ9...&indicatorTimeFrame=1h
   → indicators.rsi: { value: 28, signal: "oversold" } ✓
   → indicators.macd: { histogram: 0.0003, trend: "bullish" } ✓
   → indicators.bollingerBands: { percentB: 0.12 } ✓
   → indicators.supportResistance: { support: [0.042, 0.040], resistance: [0.051, 0.054] }
   → indicators.summary: { signal: "strong_buy", bullishCount: 6, bearishCount: 0 } ✓
   → Entry target: $0.042 (support), Exit target: $0.051 (resistance)

4. GET /gasFeed?chain=sol
   → Gas is cheap, proceed ✓

5. Verify wallet balance: SOL balance > trade amount + 2× exit gas ✓

6. GET /swapQuote?chain=sol&dex=raydium&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=1000000000&slippageBps=100
   → Price at $0.043 (within 3% of support $0.042) ✓

7. GET /swap?chain=sol&dex=raydium&walletAddress=8X35...&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=500000000&slippageBps=100
   → Tx returned, verify settlement: token balance increased ✓
   → Entry placed (50% position at $0.043)

8. Monitor every 5 min with /priceHistoryIndicators?indicatorTimeFrame=5m...
   Price holds above support for 3 candles → add 25% position
   MACD confirms bullish crossover → add final 25%
   Price hits $0.049, RSI at 65 → set trailing stop at $0.046
   Price hits $0.050, RSI at 72 (overbought) → EXIT full position

9. Confirm sell settled: token balance → 0, SOL balance increased ✓

10. Profit: ~16% on position (minus gas + slippage)
    Entry avg: ~$0.043 → Exit: $0.050

11. Token enters re-entry cooldown (30 min). If it drops back to support
    and passes fresh checks, may re-enter as a new position.
```

---

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/filterTokens` | Screen for high-volume tokens across chains |
| `/volatilityScanner` | Find tokens with consistent swing patterns + levels |
| `/isScam` | Quick safety check (isScam, riskLevel 0-100, warnings) |
| `/fullAudit` | Deep safety: taxes, contract flags, holder concentration |
| `/priceHistoryIndicators` | OHLCV + RSI, MACD, EMA, BB, ATR, Stoch RSI, S/R, VWAP, OBV + aggregate signal |
| `/tokenPriceHistory` | Raw OHLCV candles for manual pattern analysis when indicators are ambiguous |
| `/detailedTokenStats` | Volume, buyer/seller balance, momentum across time windows |
| `/holderAnalysis` | Whale activity and concentration changes |
| `/fudSearch` | Social sentiment and scam chatter |
| `/marketOverview` | Broader market context |
| `/gasFeed` | Gas cost before executing trades |
| `/swapQuote` | Preview execution price before committing |
| `/swap` | Execute buy/sell trades |
| `/approve` | Token approval for EVM DEX trades |
