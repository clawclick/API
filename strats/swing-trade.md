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

---

## Phase 3: Execute the Trade

### Step 6 — Check gas costs first

```
GET /gasFeed?chain=sol
```

For EVM chains, ensure gas costs don't eat a significant portion of your expected profit. If expected swing profit is $50 and gas round-trip is $20, the trade isn't worth it.

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

5. GET /swapQuote?chain=sol&dex=raydium&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=1000000000&slippageBps=100
   → Price at $0.043 (within 3% of support $0.042) ✓

6. GET /swap?chain=sol&dex=raydium&walletAddress=8X35...&tokenIn=So111...&tokenOut=Dz9mQ9...&amountIn=500000000&slippageBps=100
   → Entry placed (50% position at $0.043)

7. Monitor every 5 min with /priceHistoryIndicators?indicatorTimeFrame=5m...
   Price holds above support for 3 candles → add 25% position
   MACD confirms bullish crossover → add final 25%
   Price hits $0.049, RSI at 65 → set trailing stop at $0.046
   Price hits $0.050, RSI at 72 (overbought) → EXIT full position

8. Profit: ~16% on position (minus gas + slippage)
   Entry avg: ~$0.043 → Exit: $0.050
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
| `/tokenPriceHistory` | Raw OHLCV candles for manual analysis |
| `/detailedTokenStats` | Volume, buyer/seller balance, momentum across time windows |
| `/holderAnalysis` | Whale activity and concentration changes |
| `/fudSearch` | Social sentiment and scam chatter |
| `/marketOverview` | Broader market context |
| `/gasFeed` | Gas cost before executing trades |
| `/swapQuote` | Preview execution price before committing |
| `/swap` | Execute buy/sell trades |
| `/approve` | Token approval for EVM DEX trades |
