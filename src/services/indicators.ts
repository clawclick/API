import { getTokenPriceHistory } from "#services/liveEndpoints";
import type { PriceHistoryQuery } from "#routes/helpers";
import type { TokenPricePoint, ProviderStatus } from "#types/api";

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type IndicatorTimeFrame = "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "4h" | "1d";

export type IndicatorConfig = {
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  emaShort: number;
  emaMedium: number;
  emaLong: number;
  smaPeriod: number;
  bbPeriod: number;
  bbStdDev: number;
  atrPeriod: number;
  stochPeriod: number;
  stochSmooth: number;
  vwapAnchor: "session";
};

export type RSI = { period: number; value: number; signal: "overbought" | "oversold" | "neutral" };
export type MACDResult = { macd: number; signal: number; histogram: number; trend: "bullish" | "bearish" | "neutral" };
export type EMASet = { short: { period: number; value: number }; medium: { period: number; value: number }; long: { period: number; value: number } };
export type SMAResult = { period: number; value: number };
export type BollingerBands = { upper: number; middle: number; lower: number; bandwidth: number; percentB: number };
export type ATRResult = { period: number; value: number };
export type StochRSI = { k: number; d: number; signal: "overbought" | "oversold" | "neutral" };
export type SupportResistance = { support: number[]; resistance: number[] };
export type VWAPResult = { value: number; upperBand: number; lowerBand: number };
export type OBVResult = { value: number; trend: "accumulating" | "distributing" | "flat" };

export type Indicators = {
  timeFrame: string;
  config: IndicatorConfig;
  rsi: RSI | null;
  macd: MACDResult | null;
  ema: EMASet | null;
  sma: SMAResult | null;
  bollingerBands: BollingerBands | null;
  atr: ATRResult | null;
  stochRsi: StochRSI | null;
  supportResistance: SupportResistance;
  vwap: VWAPResult | null;
  obv: OBVResult | null;
  summary: { signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell"; bullishCount: number; bearishCount: number; neutralCount: number };
};

export type PriceHistoryIndicatorsResponse = {
  endpoint: "priceHistoryIndicators";
  status: "live" | "partial";
  chain: string;
  tokenAddress: string;
  currency: "usd";
  limit: string;
  interval: string;
  indicatorTimeFrame: string;
  pointCount: number;
  cached: boolean;
  points: TokenPricePoint[];
  indicators: Indicators;
  providers: ProviderStatus[];
};

/* ══════════════════════════════════════════════════════════════
   Timeframe-adaptive indicator configs
   ══════════════════════════════════════════════════════════════ */

const CONFIGS: Record<string, IndicatorConfig> = {
  // Scalping timeframes — faster periods
  "1m":  { rsiPeriod: 7,  macdFast: 5,  macdSlow: 13, macdSignal: 4, emaShort: 5,  emaMedium: 13, emaLong: 34,  smaPeriod: 10, bbPeriod: 12, bbStdDev: 2, atrPeriod: 7,  stochPeriod: 7,  stochSmooth: 3, vwapAnchor: "session" },
  "5m":  { rsiPeriod: 9,  macdFast: 8,  macdSlow: 17, macdSignal: 9, emaShort: 8,  emaMedium: 21, emaLong: 55,  smaPeriod: 20, bbPeriod: 15, bbStdDev: 2, atrPeriod: 10, stochPeriod: 9,  stochSmooth: 3, vwapAnchor: "session" },
  "10m": { rsiPeriod: 9,  macdFast: 8,  macdSlow: 17, macdSignal: 9, emaShort: 9,  emaMedium: 21, emaLong: 55,  smaPeriod: 20, bbPeriod: 15, bbStdDev: 2, atrPeriod: 10, stochPeriod: 9,  stochSmooth: 3, vwapAnchor: "session" },
  "15m": { rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, emaShort: 9,  emaMedium: 21, emaLong: 55,  smaPeriod: 20, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, stochPeriod: 14, stochSmooth: 3, vwapAnchor: "session" },
  "30m": { rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, emaShort: 9,  emaMedium: 21, emaLong: 55,  smaPeriod: 20, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, stochPeriod: 14, stochSmooth: 3, vwapAnchor: "session" },
  // Swing timeframes — standard periods
  "1h":  { rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, emaShort: 9,  emaMedium: 21, emaLong: 50,  smaPeriod: 20, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, stochPeriod: 14, stochSmooth: 3, vwapAnchor: "session" },
  // Position timeframes — slower periods
  "4h":  { rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, emaShort: 21, emaMedium: 50, emaLong: 200, smaPeriod: 50, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, stochPeriod: 14, stochSmooth: 3, vwapAnchor: "session" },
  "1d":  { rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9, emaShort: 21, emaMedium: 50, emaLong: 200, smaPeriod: 50, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, stochPeriod: 14, stochSmooth: 3, vwapAnchor: "session" },
};

function getConfig(tf: string): IndicatorConfig {
  return CONFIGS[tf] ?? CONFIGS["1h"];
}

// Map indicatorTimeFrame to an appropriate price history interval + limit
function getHistoryParams(tf: string): { interval: string; limit: string } {
  switch (tf) {
    case "1m":  return { interval: "1m",  limit: "1d" };
    case "5m":  return { interval: "5m",  limit: "3d" };   // ~864 candles
    case "10m": return { interval: "15m", limit: "7d" };   // approx 10m via 15m candles
    case "15m": return { interval: "15m", limit: "7d" };
    case "30m": return { interval: "30m", limit: "14d" };
    case "1h":  return { interval: "1h",  limit: "1m" };
    case "4h":  return { interval: "4h",  limit: "3m" };
    case "1d":  return { interval: "1d",  limit: "1y" };
    default:    return { interval: "1h",  limit: "1m" };
  }
}

/* ══════════════════════════════════════════════════════════════
   Main entry
   ══════════════════════════════════════════════════════════════ */

export type PriceHistoryIndicatorsQuery = {
  chain: string;
  tokenAddress: string;
  indicatorTimeFrame: string;
};

/* ── 60-second cache ─────────────────────────────────────── */
type IndicatorsCacheEntry = { data: PriceHistoryIndicatorsResponse; expiresAt: number };
const indicatorsCache = new Map<string, IndicatorsCacheEntry>();
const INDICATORS_CACHE_TTL_MS = 60 * 1000;

function indicatorsCacheKey(q: PriceHistoryIndicatorsQuery): string {
  return `${q.chain}:${q.tokenAddress}:${q.indicatorTimeFrame}`;
}

export async function getPriceHistoryIndicators(
  q: PriceHistoryIndicatorsQuery,
): Promise<PriceHistoryIndicatorsResponse> {
  const key = indicatorsCacheKey(q);
  const hit = indicatorsCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { ...hit.data, cached: true };
  }

  const tf = q.indicatorTimeFrame;
  const config = getConfig(tf);
  const { interval, limit } = getHistoryParams(tf);

  // Fetch OHLCV data via existing price history pipeline
  const priceQuery: PriceHistoryQuery = {
    chain: q.chain,
    tokenAddress: q.tokenAddress,
    interval,
    limit,
  };

  const history = await getTokenPriceHistory(priceQuery);
  const points = history.points;

  // Extract close/high/low/volume arrays, using priceUsd as fallback for close
  const closes = points.map((p) => p.close ?? p.priceUsd);
  const highs = points.map((p) => p.high ?? p.priceUsd);
  const lows = points.map((p) => p.low ?? p.priceUsd);
  const volumes = points.map((p) => p.volume ?? 0);
  const opens = points.map((p) => p.open ?? p.priceUsd);

  const indicators: Indicators = {
    timeFrame: tf,
    config,
    rsi: computeRSI(closes, config.rsiPeriod),
    macd: computeMACD(closes, config.macdFast, config.macdSlow, config.macdSignal),
    ema: computeEMASet(closes, config.emaShort, config.emaMedium, config.emaLong),
    sma: computeSMA(closes, config.smaPeriod),
    bollingerBands: computeBollingerBands(closes, config.bbPeriod, config.bbStdDev),
    atr: computeATR(highs, lows, closes, config.atrPeriod),
    stochRsi: computeStochRSI(closes, config.rsiPeriod, config.stochPeriod, config.stochSmooth),
    supportResistance: computeSupportResistance(highs, lows, closes),
    vwap: computeVWAP(highs, lows, closes, volumes),
    obv: computeOBV(closes, volumes),
    summary: { signal: "neutral", bullishCount: 0, bearishCount: 0, neutralCount: 0 },
  };

  // Build aggregate signal
  indicators.summary = buildSummary(indicators);

  const response: PriceHistoryIndicatorsResponse = {
    endpoint: "priceHistoryIndicators",
    status: history.status,
    chain: history.chain,
    tokenAddress: history.tokenAddress,
    currency: "usd",
    limit,
    interval,
    indicatorTimeFrame: tf,
    pointCount: points.length,
    cached: false,
    points,
    indicators,
    providers: history.providers,
  };

  indicatorsCache.set(key, { data: response, expiresAt: Date.now() + INDICATORS_CACHE_TTL_MS });
  return response;
}

/* ══════════════════════════════════════════════════════════════
   Indicator calculations
   ══════════════════════════════════════════════════════════════ */

function computeRSI(closes: number[], period: number): RSI | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial SMA of gains/losses
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed (Wilder's) RSI
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const value = round(100 - 100 / (1 + rs));
  const signal = value >= 70 ? "overbought" : value <= 30 ? "oversold" : "neutral";

  return { period, value, signal };
}

function computeMACD(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MACDResult | null {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fastEma = emaArray(closes, fastPeriod);
  const slowEma = emaArray(closes, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastEma[i] != null && slowEma[i] != null) {
      macdLine.push(fastEma[i]! - slowEma[i]!);
    }
  }

  if (macdLine.length < signalPeriod) return null;

  const signalLine = emaArray(macdLine, signalPeriod);
  const last = macdLine.length - 1;
  const macd = round(macdLine[last]);
  const signal = round(signalLine[last] ?? 0);
  const histogram = round(macd - signal);

  const trend = histogram > 0 && macd > 0 ? "bullish" : histogram < 0 && macd < 0 ? "bearish" : "neutral";

  return { macd, signal, histogram, trend };
}

function computeEMASet(
  closes: number[],
  shortP: number,
  medP: number,
  longP: number,
): EMASet | null {
  const shortArr = emaArray(closes, shortP);
  const medArr = emaArray(closes, medP);
  const longArr = emaArray(closes, longP);

  const s = shortArr[closes.length - 1];
  const m = medArr[closes.length - 1];
  const l = longArr[closes.length - 1];

  if (s == null || m == null) return null;

  return {
    short: { period: shortP, value: round(s) },
    medium: { period: medP, value: round(m) },
    long: { period: longP, value: l != null ? round(l) : round(m) },
  };
}

function computeSMA(closes: number[], period: number): SMAResult | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const value = round(slice.reduce((a, b) => a + b, 0) / period);
  return { period, value };
}

function computeBollingerBands(
  closes: number[],
  period: number,
  stdDevMult: number,
): BollingerBands | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDev * stdDevMult;
  const lower = middle - stdDev * stdDevMult;
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const price = closes[closes.length - 1];
  const percentB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;

  return {
    upper: round(upper),
    middle: round(middle),
    lower: round(lower),
    bandwidth: round(bandwidth),
    percentB: round(percentB),
  };
}

function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): ATRResult | null {
  if (closes.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trueRanges.push(tr);
  }

  // Wilder's smoothing
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return { period, value: round(atr) };
}

function computeStochRSI(
  closes: number[],
  rsiPeriod: number,
  stochPeriod: number,
  smooth: number,
): StochRSI | null {
  // Build RSI series
  if (closes.length < rsiPeriod + stochPeriod + smooth) return null;

  const rsiSeries: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= rsiPeriod; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= rsiPeriod;
  avgLoss /= rsiPeriod;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiSeries.push(100 - 100 / (1 + rs0));

  for (let i = rsiPeriod + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (rsiPeriod - 1) + (change > 0 ? change : 0)) / rsiPeriod;
    avgLoss = (avgLoss * (rsiPeriod - 1) + (change < 0 ? Math.abs(change) : 0)) / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiSeries.push(100 - 100 / (1 + rs));
  }

  if (rsiSeries.length < stochPeriod) return null;

  // Stochastic of RSI
  const stochKRaw: number[] = [];
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    const window = rsiSeries.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...window);
    const max = Math.max(...window);
    stochKRaw.push(max === min ? 50 : ((rsiSeries[i] - min) / (max - min)) * 100);
  }

  // Smooth K → K, smooth K again → D
  const kSmoothed = smaArray(stochKRaw, smooth);
  const dSmoothed = smaArray(kSmoothed, smooth);

  const k = round(kSmoothed[kSmoothed.length - 1] ?? 50);
  const d = round(dSmoothed[dSmoothed.length - 1] ?? 50);
  const signal = k >= 80 ? "overbought" : k <= 20 ? "oversold" : "neutral";

  return { k, d, signal };
}

function computeSupportResistance(
  highs: number[],
  lows: number[],
  closes: number[],
): SupportResistance {
  if (closes.length < 10) return { support: [], resistance: [] };

  // Find pivot highs and lows (look-back and look-ahead of 3)
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  const lookback = 3;

  for (let i = lookback; i < closes.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isHigh = false;
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs.push(highs[i]);
    if (isLow) pivotLows.push(lows[i]);
  }

  // Cluster nearby pivots (within 1.5%) and pick the 3 strongest
  const resistance = clusterLevels(pivotHighs, 0.015).slice(0, 3).map(round);
  const support = clusterLevels(pivotLows, 0.015).slice(0, 3).map(round);

  return { support, resistance };
}

function computeVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): VWAPResult | null {
  if (closes.length < 2 || volumes.every((v) => v === 0)) return null;

  let cumTPV = 0;
  let cumVol = 0;
  const vwapArr: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTPV += tp * volumes[i];
    cumVol += volumes[i];
    vwapArr.push(cumVol > 0 ? cumTPV / cumVol : closes[i]);
  }

  const value = vwapArr[vwapArr.length - 1];

  // Standard deviation bands
  let sumSqDev = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    sumSqDev += (tp - vwapArr[i]) ** 2;
  }
  const stdDev = Math.sqrt(sumSqDev / closes.length);

  return {
    value: round(value),
    upperBand: round(value + stdDev * 2),
    lowerBand: round(value - stdDev * 2),
  };
}

function computeOBV(closes: number[], volumes: number[]): OBVResult | null {
  if (closes.length < 10 || volumes.every((v) => v === 0)) return null;

  let obv = 0;
  const obvArr: number[] = [0];

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvArr.push(obv);
  }

  // Trend: compare last OBV vs its SMA(20)
  const period = Math.min(20, obvArr.length);
  const obvSma = obvArr.slice(-period).reduce((a, b) => a + b, 0) / period;
  const trend = obv > obvSma * 1.02 ? "accumulating" : obv < obvSma * 0.98 ? "distributing" : "flat";

  return { value: Math.round(obv), trend };
}

/* ══════════════════════════════════════════════════════════════
   Aggregate signal
   ══════════════════════════════════════════════════════════════ */

function buildSummary(ind: Indicators): Indicators["summary"] {
  let bull = 0;
  let bear = 0;
  let neutral = 0;

  // RSI
  if (ind.rsi) {
    if (ind.rsi.signal === "oversold") bull++;
    else if (ind.rsi.signal === "overbought") bear++;
    else neutral++;
  }

  // MACD
  if (ind.macd) {
    if (ind.macd.trend === "bullish") bull++;
    else if (ind.macd.trend === "bearish") bear++;
    else neutral++;
  }

  // EMA alignment
  if (ind.ema) {
    const { short: s, medium: m, long: l } = ind.ema;
    if (s.value > m.value && m.value > l.value) bull++;
    else if (s.value < m.value && m.value < l.value) bear++;
    else neutral++;
  }

  // Bollinger %B
  if (ind.bollingerBands) {
    if (ind.bollingerBands.percentB < 0.2) bull++; // near lower band
    else if (ind.bollingerBands.percentB > 0.8) bear++; // near upper band
    else neutral++;
  }

  // Stoch RSI
  if (ind.stochRsi) {
    if (ind.stochRsi.signal === "oversold") bull++;
    else if (ind.stochRsi.signal === "overbought") bear++;
    else neutral++;
  }

  // VWAP
  if (ind.vwap && ind.ema) {
    const price = ind.ema.short.value;
    if (price > ind.vwap.value) bull++;
    else if (price < ind.vwap.value) bear++;
    else neutral++;
  }

  // OBV
  if (ind.obv) {
    if (ind.obv.trend === "accumulating") bull++;
    else if (ind.obv.trend === "distributing") bear++;
    else neutral++;
  }

  const total = bull + bear + neutral;
  let signal: Indicators["summary"]["signal"] = "neutral";
  if (total > 0) {
    const bullRatio = bull / total;
    const bearRatio = bear / total;
    if (bullRatio >= 0.7) signal = "strong_buy";
    else if (bullRatio >= 0.5) signal = "buy";
    else if (bearRatio >= 0.7) signal = "strong_sell";
    else if (bearRatio >= 0.5) signal = "sell";
  }

  return { signal, bullishCount: bull, bearishCount: bear, neutralCount: neutral };
}

/* ══════════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════════ */

function round(v: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

// EMA array — returns array same length as input, null-filled until period is reached
function emaArray(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length < period) return data.map(() => null);

  const k = 2 / (period + 1);
  // Seed with SMA
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) result.push(null);
  result.push(ema);

  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// Simple moving average array
function smaArray(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(data[i]); // fill early values with raw data
    } else {
      const window = data.slice(i - period + 1, i + 1);
      result.push(window.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

// Cluster nearby price levels — returns sorted array of cluster averages
function clusterLevels(values: number[], threshold: number): number[] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastCluster = clusters[clusters.length - 1];
    const clusterAvg = lastCluster.reduce((a, b) => a + b, 0) / lastCluster.length;
    if (Math.abs(sorted[i] - clusterAvg) / clusterAvg <= threshold) {
      lastCluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }

  // Sort by cluster size (most touched = strongest), then return averages
  return clusters
    .sort((a, b) => b.length - a.length)
    .map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}
