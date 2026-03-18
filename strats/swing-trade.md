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
GET /filterTokens?network=sol&minVolume24=100000&minLiquidity=50000&sortBy=volumeUsd24&sortDirection=DESC&limit=50
```

Repeat for other chains:

```
GET /filterTokens?network=eth&minVolume24=500000&minLiquidity=200000&sortBy=volumeUsd24&sortDirection=DESC&limit=50
```

```
GET /filterTokens?network=base&minVolume24=100000&minLiquidity=50000&sortBy=volumeUsd24&sortDirection=DESC&limit=50
```

**What to look for in results:**
- `priceChange24hPct` with absolute value > 10 (showing the token moves)
- `liquidityUsd` high enough that your position size won't move the price (aim for position < 1% of liquidity)
- `volume24hUsd` at least 5x your intended position size

### Step 2 — Call `/volatilityScanner` for swing-specific scoring

```
GET /volatilityScanner?chain=sol&minVolume=100000&minSwingPct=10&interval=1h&limit=7d&maxResults=20
```

This returns tokens pre-scored for swing suitability with:
- `swingScore` — composite ranking (higher = better swing candidate)
- `avgSwingPct` — average peak-to-trough swing percentage
- `swingCount` — how many full swings in the lookback period
- `support` / `resistance` — estimated price levels
- `currentPosition` — where price sits relative to the range (0 = at support, 1 = at resistance)

**Prioritize tokens where:**
- `swingCount` >= 3 (proven repeating pattern)
- `avgSwingPct` between 10% and 40% (too high = unstable, too low = not worth it)
- `currentPosition` < 0.3 (near support — good entry) or > 0.7 (near resistance — wait or short)

### Step 3 — Safety check each candidate

Before committing to any token, run the scam triage:

```
GET /isScam?chain=sol&tokenAddress=<address>
```

If `isScam` is true or `riskLevel` > 7, skip it. For deeper analysis:

```
GET /fullAudit?chain=eth&tokenAddress=<address>
```

**Disqualify tokens with:**
- Buy/sell tax > 5%
- Honeypot detected
- Owner can modify taxes or pause trading
- Insufficient holder count (< 100 holders)

---

## Phase 2: Analyze Price Action

### Step 4 — Pull price history and identify levels

```
GET /tokenPriceHistory?chain=sol&tokenAddress=<address>&limit=7d&interval=1h
```

From the `points` array, calculate:

1. **Support level**: Find the 2-3 lowest `low` values that held more than once. Average them.
2. **Resistance level**: Find the 2-3 highest `high` values that held more than once. Average them.
3. **Swing percentage**: `(resistance - support) / support * 100`
4. **Current price position**: `(current - support) / (resistance - support)`

**Good swing candidate metrics:**
- Swing percentage: 10-40%
- At least 3 touches of both support and resistance in 7 days
- Current price near support (within 20% of the range floor)

### Step 5 — Confirm with detailed stats

```
GET /detailedTokenStats?chain=sol&tokenAddress=<address>&durations=hour1,hour4,day1&bucketCount=12
```

Check the `hour4` window:
- `volume` should show consistent activity (not just one spike)
- `buyers` and `sellers` should both be active (not one-sided)
- `buys` vs `sells` ratio between 0.4 and 2.5 (balanced two-way market)

---

## Phase 3: Execute the Trade

### Step 6 — Get a quote first

Before placing a buy, always quote:

```
GET /swapQuote?chain=sol&dex=raydium&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<target_token>&amountIn=<amount_in_lamports>&slippageBps=100
```

Check `amountOut` and verify the price is still near your target entry. If price has moved more than 3% from your calculated support level, wait.

### Step 7 — Place the entry (buy at support)

```
GET /swap?chain=sol&dex=raydium&walletAddress=<wallet>&tokenIn=So11111111111111111111111111111111111111112&tokenOut=<target_token>&amountIn=<amount_in_lamports>&slippageBps=100
```

For EVM chains, you may need approval first:

```
GET /approve?chain=eth&dex=uniswap_v3&walletAddress=<wallet>&tokenIn=<token_in>&tokenOut=<token_out>
```

Then swap:

```
GET /swap?chain=eth&dex=uniswap_v3&walletAddress=<wallet>&tokenIn=<token_in>&tokenOut=<target_token>&amountIn=<amount_wei>&slippageBps=50
```

### Step 8 — Set exit target (sell at resistance)

Monitor price using `/tokenPriceHistory` with `interval=5m` or `/detailedTokenStats` with `durations=min5`.

When price reaches your resistance target (within 5%), place the sell:

```
GET /swap?chain=sol&dex=raydium&walletAddress=<wallet>&tokenIn=<target_token>&tokenOut=So11111111111111111111111111111111111111112&amountIn=<token_balance>&slippageBps=100
```

---

## Phase 4: Risk Management & Hold-Off Rules

### When to HOLD OFF (do not trade this round)

1. **Failed rebound**: Price broke below support by > 5% and hasn't recovered in 2 candles (on your interval). The range is breaking down — stay out until a new range forms.

2. **Volume collapse**: Check `/detailedTokenStats` — if `hour1` volume dropped > 60% compared to `hour4` average, the swing pattern may be dying.

3. **Buyer/seller imbalance**: If sells outnumber buys by > 3:1 in the last hour, momentum is one-directional. Wait for balance to return.

4. **Whale dump detected**: Use `/holderAnalysis` to check if top holders are reducing. If `top10HoldersPercent` increased suddenly, or you see large sells in recent activity, skip.

5. **Market-wide downturn**: Check `/marketOverview` for the chain's overall sentiment. If the broader market is crashing, individual token swings become unreliable.

6. **Negative sentiment**: Run `/fudSearch` with the token name — if there's active scam/exploit chatter, exit or avoid entirely.

### Stop-loss rules

- **Hard stop**: If price drops > 15% below your entry, sell immediately. The swing thesis is broken.
- **Time stop**: If price hasn't moved toward resistance within 24 hours of entry, re-evaluate. The pattern may have shifted.
- **Trailing stop**: Once price is > 50% of the way to resistance, set a mental trailing stop at 5% below current price.

### Position sizing

- Never put more than 5% of your total portfolio in a single swing trade
- Scale in: buy 50% at support, add 25% if it confirms the bounce (2-3 candle confirmation above support), add final 25% only if momentum accelerates
- Always keep enough gas token for exit transactions

---

## Monitoring Loop

Once a position is active, agents should poll on a schedule:

| Check | Endpoint | Frequency |
|-------|----------|-----------|
| Current price vs targets | `/tokenPriceHistory?interval=5m&limit=1h` | Every 5 min |
| Volume & momentum | `/detailedTokenStats?durations=min5,hour1` | Every 15 min |
| Safety re-check | `/isScam` | Every 6 hours |
| Holder changes | `/holderAnalysis` | Every 1 hour |
| Sentiment shifts | `/fudSearch` | Every 1 hour |
| Gas costs | `/gasFeed` | Before any trade |

---

## Example: Full Workflow

```
1. GET /volatilityScanner?chain=sol&minVolume=100000&minSwingPct=10&interval=1h&limit=7d&maxResults=10
   → Returns 10 candidates ranked by swingScore

2. For top candidate (swingScore=87, currentPosition=0.15):
   GET /isScam?chain=sol&tokenAddress=Dz9mQ9...
   → isScam: false, riskLevel: 2 ✓

3. GET /tokenPriceHistory?chain=sol&tokenAddress=Dz9mQ9...&limit=7d&interval=1h
   → Support at $0.042, Resistance at $0.051 (21% swing)

4. GET /swapQuote?chain=sol&dex=raydium&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=1000000000&slippageBps=100
   → Price at $0.043 (near support) ✓

5. GET /swap?chain=sol&dex=raydium&walletAddress=8X35...&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=500000000&slippageBps=100
   → Entry placed (50% position)

6. Monitor every 5 min...
   Price hits $0.045 → add 25% position
   Price hits $0.049 → set trailing stop at $0.046
   Price hits $0.050 → close full position via /swap (sell)

7. Profit: ~16% on position (minus gas + slippage)
```

---

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/filterTokens` | Screen for high-volume tokens across chains |
| `/volatilityScanner` | Find tokens with consistent swing patterns + levels |
| `/isScam` | Quick safety check before entering |
| `/fullAudit` | Deep safety analysis for larger positions |
| `/tokenPriceHistory` | Derive support/resistance levels from OHLCV |
| `/detailedTokenStats` | Volume, buyer/seller balance, momentum |
| `/holderAnalysis` | Whale activity and concentration changes |
| `/fudSearch` | Social sentiment and scam chatter |
| `/marketOverview` | Broader market context |
| `/gasFeed` | Gas cost before executing trades |
| `/swapQuote` | Preview execution price before committing |
| `/swap` | Execute buy/sell trades |
| `/approve` | Token approval for EVM DEX trades |
