import { getPriceHistoryIndicators, type IndicatorTimeFrame } from "#services/indicators";
import { getDetailedTokenStats, getIsScam, getTokenPoolInfo } from "#services/liveEndpoints";
import type { DetailedTokenStatsResponse, ProviderStatus, RateMyEntryFactor, RateMyEntryResponse } from "#types/api";

export type RateMyEntryQuery = {
  chain: string;
  tokenAddress: string;
  indicatorTimeFrame: IndicatorTimeFrame;
};

type CacheEntry = {
  data: RateMyEntryResponse;
  expiresAt: number;
};

type SwingThresholds = {
  minVolume24hUsd: number;
  minLiquidityUsd: number;
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, CacheEntry>();
const DEFAULT_THRESHOLDS: SwingThresholds = { minVolume24hUsd: 100_000, minLiquidityUsd: 50_000 };
const SWING_THRESHOLDS: Record<string, SwingThresholds> = {
  eth: { minVolume24hUsd: 500_000, minLiquidityUsd: 200_000 },
  base: DEFAULT_THRESHOLDS,
  bsc: DEFAULT_THRESHOLDS,
  sol: DEFAULT_THRESHOLDS,
};

export async function getRateMyEntry(query: RateMyEntryQuery): Promise<RateMyEntryResponse> {
  const key = `${query.chain}:${query.tokenAddress}:${query.indicatorTimeFrame}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { ...hit.data, cached: true };
  }

  const [pool, indicatorsResponse, stats, scam] = await Promise.all([
    getTokenPoolInfo({ chain: query.chain, tokenAddress: query.tokenAddress, fresh: false }),
    getPriceHistoryIndicators(query),
    getDetailedTokenStats({
      chain: query.chain,
      tokenAddress: query.tokenAddress,
      durations: "hour1,hour4,day1",
      bucketCount: 12,
      statsType: "UNFILTERED",
    }),
    getIsScam({ chain: query.chain, tokenAddress: query.tokenAddress, fresh: false }),
  ]);

  const latestPoint = indicatorsResponse.points.at(-1) ?? null;
  const currentPriceUsd = firstNumber(pool.priceUsd, latestPoint?.close, latestPoint?.priceUsd);
  const strongestSupport = firstNumber(
    indicatorsResponse.indicators.supportResistance.support[0],
    pickPreferredStatsWindow(stats)?.statsUsd.lowest?.currentValue,
  );
  const strongestResistance = firstNumber(
    indicatorsResponse.indicators.supportResistance.resistance[0],
    pickPreferredStatsWindow(stats)?.statsUsd.highest?.currentValue,
  );
  const currentPosition = computeCurrentPosition(currentPriceUsd, strongestSupport, strongestResistance);
  const rangeWidthPct =
    strongestSupport != null && strongestResistance != null && strongestSupport > 0
      ? round(((strongestResistance - strongestSupport) / strongestSupport) * 100, 2)
      : null;

  const volumeMetrics = buildVolumeMetrics(indicatorsResponse.points, stats, query.chain, pool.volume24hUsd, pool.liquidityUsd);
  const latestCandle = classifyLatestCandle(latestPoint?.open, latestPoint?.close ?? latestPoint?.priceUsd);
  const summary = indicatorsResponse.indicators.summary;
  const ema = indicatorsResponse.indicators.ema;
  const emaStack = classifyEmaStack(ema?.short.value, ema?.medium.value, ema?.long.value);
  const buySellRatio = volumeMetrics.buySellRatio;
  const thresholds = SWING_THRESHOLDS[query.chain] ?? DEFAULT_THRESHOLDS;
  const requiredConfirmations: string[] = [];
  const hardStops: string[] = [];
  const factors: RateMyEntryFactor[] = [];

  const trendScore = scoreTrend(currentPriceUsd, ema?.medium.value ?? null, ema?.long.value ?? null, emaStack, requiredConfirmations, hardStops);
  pushFactor(factors, "Trend filter", trendScore.status, trendScore.score, 2, trendScore.detail);

  const locationScore = scoreLocation(currentPriceUsd, strongestSupport, strongestResistance, currentPosition, requiredConfirmations);
  pushFactor(factors, "Entry location", locationScore.status, locationScore.score, 2, locationScore.detail);

  const momentumScore = scoreMomentum(
    indicatorsResponse.indicators.rsi?.value ?? null,
    indicatorsResponse.indicators.rsi?.signal ?? null,
    indicatorsResponse.indicators.macd?.histogram ?? null,
    indicatorsResponse.indicators.macd?.trend ?? null,
    indicatorsResponse.indicators.bollingerBands?.percentB ?? null,
  );
  pushFactor(factors, "Momentum", momentumScore.status, momentumScore.score, 1.5, momentumScore.detail);

  const volumeScore = scoreVolumeAndLiquidity(
    pool.volume24hUsd,
    pool.liquidityUsd,
    thresholds,
    volumeMetrics.volumeConsistencyPct,
    volumeMetrics.volumeVsRecentAveragePct,
  );
  pushFactor(factors, "Volume and liquidity", volumeScore.status, volumeScore.score, 1.5, volumeScore.detail);

  const flowScore = scoreFlow(
    currentPriceUsd,
    indicatorsResponse.indicators.vwap?.value ?? null,
    latestCandle,
    buySellRatio,
  );
  pushFactor(factors, "Flow confirmation", flowScore.status, flowScore.score, 1, flowScore.detail);

  const summaryScore = scoreIndicatorSummary(summary.signal);
  pushFactor(factors, "Indicator summary", summaryScore.status, summaryScore.score, 1, summaryScore.detail);

  const safetyScore = scoreSafety(scam.isScam, scam.riskLevel, scam.warnings, hardStops);
  pushFactor(factors, "Safety", safetyScore.status, safetyScore.score, 1, safetyScore.detail);

  let ratingScore = round(
    trendScore.score +
      locationScore.score +
      momentumScore.score +
      volumeScore.score +
      flowScore.score +
      summaryScore.score +
      safetyScore.score,
    1,
  );

  if (trendScore.trendGateFailed) {
    ratingScore = Math.min(ratingScore, 6.4);
  }
  if (currentPosition != null && currentPosition > 0.7) {
    ratingScore = Math.min(ratingScore, 6.8);
  }
  if (scam.isScam === true || (scam.riskLevel ?? 0) >= 60) {
    ratingScore = Math.min(ratingScore, 2.5);
  }

  const betterEntryPriceUsd =
    ratingScore < 7
      ? computeBetterEntryPrice(currentPriceUsd, [
          strongestSupport,
          indicatorsResponse.indicators.bollingerBands?.lower ?? null,
          indicatorsResponse.indicators.vwap?.value ?? null,
          ema?.medium.value ?? null,
          ema?.long.value ?? null,
        ])
      : null;
  const betterEntryDiscountPct =
    currentPriceUsd != null && betterEntryPriceUsd != null && currentPriceUsd > 0
      ? round(((currentPriceUsd - betterEntryPriceUsd) / currentPriceUsd) * 100, 2)
      : null;
  const suggestedTakeProfitUsd =
    currentPriceUsd != null && strongestResistance != null && strongestResistance > currentPriceUsd
      ? strongestResistance
      : null;
  const estimatedUpsidePct =
    currentPriceUsd != null && suggestedTakeProfitUsd != null && currentPriceUsd > 0
      ? round(((suggestedTakeProfitUsd - currentPriceUsd) / currentPriceUsd) * 100, 2)
      : null;

  if (ratingScore < 7 && betterEntryPriceUsd != null) {
    requiredConfirmations.push(`Wait for price closer to ${formatPrice(betterEntryPriceUsd)} before treating this as a swing entry.`);
  }

  const action = scam.isScam === true || (scam.riskLevel ?? 0) >= 60
    ? "avoid"
    : ratingScore >= 7
      ? "enter_now"
      : "wait_for_pullback";
  const label = ratingScore >= 8.5 ? "strong" : ratingScore >= 7 ? "good" : ratingScore >= 5 ? "mixed" : "poor";

  const response: RateMyEntryResponse = {
    endpoint: "rateMyEntry",
    status: [pool.status, indicatorsResponse.status, stats.status, scam.status].every((status) => status === "live") ? "live" : "partial",
    chain: query.chain,
    tokenAddress: query.tokenAddress,
    indicatorTimeFrame: query.indicatorTimeFrame,
    cached: false,
    rating: {
      score: ratingScore,
      maxScore: 10,
      label,
      action,
      summary: buildSummaryText(action, ratingScore, betterEntryPriceUsd, summary.signal, hardStops),
      betterEntryPriceUsd: formatPrice(betterEntryPriceUsd),
      betterEntryDiscountPct,
      suggestedTakeProfitUsd: formatPrice(suggestedTakeProfitUsd),
      estimatedUpsidePct,
      requiredConfirmations: unique(requiredConfirmations),
      hardStops: unique(hardStops),
    },
    market: {
      currentPriceUsd: formatPrice(currentPriceUsd),
      liquidityUsd: pool.liquidityUsd != null ? round(pool.liquidityUsd, 2) : null,
      volume24hUsd: pool.volume24hUsd != null ? round(pool.volume24hUsd, 2) : null,
      priceChange24hPct: pool.priceChange24hPct != null ? round(pool.priceChange24hPct, 2) : null,
    },
    range: {
      supportUsd: formatPrice(strongestSupport),
      resistanceUsd: formatPrice(strongestResistance),
      currentPosition: currentPosition != null ? round(currentPosition, 3) : null,
      rangeWidthPct,
    },
    indicators: {
      summarySignal: summary.signal,
      bullishCount: summary.bullishCount,
      bearishCount: summary.bearishCount,
      neutralCount: summary.neutralCount,
      rsi: indicatorsResponse.indicators.rsi?.value ?? null,
      rsiSignal: indicatorsResponse.indicators.rsi?.signal ?? null,
      macdHistogram: indicatorsResponse.indicators.macd?.histogram ?? null,
      macdTrend: indicatorsResponse.indicators.macd?.trend ?? null,
      bollingerPercentB: indicatorsResponse.indicators.bollingerBands?.percentB ?? null,
      vwapUsd: formatPrice(indicatorsResponse.indicators.vwap?.value ?? null),
      emaShortUsd: formatPrice(ema?.short.value ?? null),
      emaMediumUsd: formatPrice(ema?.medium.value ?? null),
      emaLongUsd: formatPrice(ema?.long.value ?? null),
      emaStack,
      latestCandle,
    },
    volume: {
      threshold24hUsd: thresholds.minVolume24hUsd,
      thresholdLiquidityUsd: thresholds.minLiquidityUsd,
      hour1VolumeUsd: volumeMetrics.hour1VolumeUsd,
      hour4VolumeUsd: volumeMetrics.hour4VolumeUsd,
      volumeConsistencyPct: volumeMetrics.volumeConsistencyPct,
      latestCandleVolume: volumeMetrics.latestCandleVolume,
      recentAverageCandleVolume: volumeMetrics.recentAverageCandleVolume,
      volumeVsRecentAveragePct: volumeMetrics.volumeVsRecentAveragePct,
      buySellRatio,
      buyers: volumeMetrics.buyers,
      sellers: volumeMetrics.sellers,
    },
    risk: {
      isScam: scam.isScam,
      riskLevel: scam.riskLevel,
      warnings: scam.warnings,
    },
    factors,
    providers: mergeProviders(pool.providers, indicatorsResponse.providers, stats.providers, scam.providers),
  };

  cache.set(key, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  return response;
}

function buildVolumeMetrics(
  points: Array<{ volume?: number }>,
  stats: DetailedTokenStatsResponse,
  chain: string,
  volume24hUsd: number | null,
  liquidityUsd: number | null,
) {
  const volumes = points.map((point) => point.volume).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const latestCandleVolume = volumes.at(-1) ?? null;
  const recentAverageCandleVolume = volumes.length > 1
    ? round(average(volumes.slice(Math.max(0, volumes.length - 13), volumes.length - 1)), 2)
    : null;
  const volumeVsRecentAveragePct =
    latestCandleVolume != null && recentAverageCandleVolume != null && recentAverageCandleVolume > 0
      ? round(((latestCandleVolume - recentAverageCandleVolume) / recentAverageCandleVolume) * 100, 2)
      : null;

  const preferredWindow = pickPreferredStatsWindow(stats);
  const hour1VolumeUsd = stats.durations.hour1?.statsUsd.volume?.currentValue ?? null;
  const hour4VolumeUsd = stats.durations.hour4?.statsUsd.volume?.currentValue ?? null;
  const volumeConsistencyPct =
    hour1VolumeUsd != null && hour4VolumeUsd != null && hour4VolumeUsd > 0
      ? round((hour1VolumeUsd / (hour4VolumeUsd / 4)) * 100, 2)
      : null;
  const buyers = preferredWindow?.statsNonCurrency.buyers?.currentValue ?? null;
  const sellers = preferredWindow?.statsNonCurrency.sellers?.currentValue ?? null;
  const buys = preferredWindow?.statsNonCurrency.buys?.currentValue ?? null;
  const sells = preferredWindow?.statsNonCurrency.sells?.currentValue ?? null;
  const buySellRatio = buys != null && sells != null && sells > 0 ? round(buys / sells, 2) : null;

  return {
    chain,
    volume24hUsd,
    liquidityUsd,
    hour1VolumeUsd: hour1VolumeUsd != null ? round(hour1VolumeUsd, 2) : null,
    hour4VolumeUsd: hour4VolumeUsd != null ? round(hour4VolumeUsd, 2) : null,
    volumeConsistencyPct,
    latestCandleVolume: latestCandleVolume != null ? round(latestCandleVolume, 2) : null,
    recentAverageCandleVolume,
    volumeVsRecentAveragePct,
    buySellRatio,
    buyers,
    sellers,
  };
}

function pickPreferredStatsWindow(stats: DetailedTokenStatsResponse) {
  return stats.durations.hour4 ?? stats.durations.day1 ?? stats.durations.hour1 ?? null;
}

function scoreTrend(
  currentPriceUsd: number | null,
  emaMediumUsd: number | null,
  emaLongUsd: number | null,
  emaStack: "bullish" | "bearish" | "mixed" | "unknown",
  requiredConfirmations: string[],
  hardStops: string[],
) {
  if (currentPriceUsd == null || emaLongUsd == null) {
    return { score: 0.8, status: "neutral" as const, detail: "Long EMA trend filter is incomplete, so trend confidence is only moderate.", trendGateFailed: false };
  }

  if (currentPriceUsd >= emaLongUsd && emaStack === "bullish") {
    return { score: 2, status: "bullish" as const, detail: "Price is above the long EMA and the EMA stack is bullish.", trendGateFailed: false };
  }

  if (currentPriceUsd >= emaLongUsd) {
    requiredConfirmations.push("A cleaner bullish EMA stack would improve the setup quality.");
    return { score: 1.4, status: "neutral" as const, detail: "Price is above the long EMA, but the EMA stack is not fully bullish yet.", trendGateFailed: false };
  }

  if (emaMediumUsd != null && currentPriceUsd >= emaMediumUsd) {
    requiredConfirmations.push("Wait for price to reclaim and hold above the long EMA trend filter.");
    hardStops.push("Price is still below the long EMA trend filter from the swing strategy.");
    return { score: 0.6, status: "bearish" as const, detail: "Price is above the medium EMA but still below the long EMA trend filter.", trendGateFailed: true };
  }

  requiredConfirmations.push("Wait for price to reclaim the long EMA before considering an entry.");
  hardStops.push("Price is below both medium and long EMAs, which fails the swing-trade trend gate.");
  return { score: 0, status: "bearish" as const, detail: "Price is below the medium and long EMA trend filters.", trendGateFailed: true };
}

function scoreLocation(
  currentPriceUsd: number | null,
  supportUsd: number | null,
  resistanceUsd: number | null,
  currentPosition: number | null,
  requiredConfirmations: string[],
) {
  if (currentPriceUsd == null || supportUsd == null || resistanceUsd == null || currentPosition == null) {
    return { score: 0.8, status: "neutral" as const, detail: "Support and resistance are only partially available, so entry location is uncertain." };
  }

  if (currentPriceUsd <= supportUsd * 1.03 || currentPosition <= 0.3) {
    return { score: 2, status: "bullish" as const, detail: "Price is sitting near support in the lower part of the range." };
  }

  if (currentPosition <= 0.45) {
    return { score: 1.4, status: "bullish" as const, detail: "Price is in the lower half of the range, which is acceptable for a swing entry." };
  }

  if (currentPosition <= 0.55) {
    requiredConfirmations.push("A slightly deeper pullback toward support would improve the entry location.");
    return { score: 1, status: "neutral" as const, detail: "Price is mid-range, so the setup is not stretched but not especially cheap either." };
  }

  if (currentPosition <= 0.7) {
    requiredConfirmations.push("Wait for price to move closer to support before taking the trade.");
    return { score: 0.4, status: "bearish" as const, detail: "Price is already in the upper half of the range, which weakens the risk/reward." };
  }

  requiredConfirmations.push("Wait for a pullback because price is too close to resistance.");
  return { score: 0, status: "bearish" as const, detail: "Price is near resistance, which is a poor swing-trade entry zone." };
}

function scoreMomentum(
  rsiValue: number | null,
  rsiSignal: "overbought" | "oversold" | "neutral" | null,
  macdHistogram: number | null,
  macdTrend: "bullish" | "bearish" | "neutral" | null,
  percentB: number | null,
) {
  let score = 0;
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (rsiSignal === "oversold" || (rsiValue != null && rsiValue <= 35)) {
    score += 0.5;
    bullishSignals += 1;
  } else if (rsiValue != null && rsiValue <= 40) {
    score += 0.35;
    bullishSignals += 1;
  } else if (rsiSignal === "overbought" || (rsiValue != null && rsiValue >= 65)) {
    bearishSignals += 1;
  } else {
    score += 0.2;
  }

  if (macdTrend === "bullish" && macdHistogram != null && macdHistogram > 0) {
    score += 0.5;
    bullishSignals += 1;
  } else if (macdTrend === "bullish") {
    score += 0.35;
    bullishSignals += 1;
  } else if (macdTrend === "bearish") {
    bearishSignals += 1;
  } else {
    score += 0.2;
  }

  if (percentB != null && percentB <= 0.2) {
    score += 0.5;
    bullishSignals += 1;
  } else if (percentB != null && percentB <= 0.4) {
    score += 0.35;
    bullishSignals += 1;
  } else if (percentB != null && percentB > 0.8) {
    bearishSignals += 1;
  } else {
    score += 0.2;
  }

  const status: RateMyEntryFactor["status"] = bullishSignals > bearishSignals ? "bullish" : bearishSignals > bullishSignals ? "bearish" : "neutral";
  const detail = bullishSignals > bearishSignals
    ? "Momentum indicators lean constructive for a swing entry."
    : bearishSignals > bullishSignals
      ? "Momentum indicators still lean hot or weak, so entry timing is not ideal."
      : "Momentum indicators are mixed, so they are not giving a strong timing edge yet.";

  return { score: round(Math.min(score, 1.5), 2), status, detail };
}

function scoreVolumeAndLiquidity(
  volume24hUsd: number | null,
  liquidityUsd: number | null,
  thresholds: SwingThresholds,
  volumeConsistencyPct: number | null,
  volumeVsRecentAveragePct: number | null,
) {
  let score = 0;

  if (volume24hUsd != null && volume24hUsd >= thresholds.minVolume24hUsd) score += 0.5;
  else if (volume24hUsd != null && volume24hUsd >= thresholds.minVolume24hUsd * 0.5) score += 0.25;

  if (liquidityUsd != null && liquidityUsd >= thresholds.minLiquidityUsd) score += 0.5;
  else if (liquidityUsd != null && liquidityUsd >= thresholds.minLiquidityUsd * 0.5) score += 0.25;

  if (volumeConsistencyPct != null && volumeConsistencyPct >= 100) score += 0.5;
  else if (volumeConsistencyPct != null && volumeConsistencyPct >= 40) score += 0.35;
  else if (volumeVsRecentAveragePct != null && volumeVsRecentAveragePct >= 10) score += 0.35;
  else if (volumeVsRecentAveragePct != null && volumeVsRecentAveragePct > -20) score += 0.15;

  const status: RateMyEntryFactor["status"] = score >= 1.1 ? "bullish" : score >= 0.7 ? "neutral" : "bearish";
  const detail = status === "bullish"
    ? "Liquidity and participation are strong enough for a swing entry."
    : status === "neutral"
      ? "Liquidity is acceptable, but the tape is not especially strong right now."
      : "Volume and liquidity are below the preferred swing-trade thresholds.";

  return { score: round(Math.min(score, 1.5), 2), status, detail };
}

function scoreFlow(
  currentPriceUsd: number | null,
  vwapUsd: number | null,
  latestCandle: "bullish" | "bearish" | "flat" | "unknown",
  buySellRatio: number | null,
) {
  let score = 0;

  if (currentPriceUsd != null && vwapUsd != null && currentPriceUsd <= vwapUsd) score += 0.34;
  else if (currentPriceUsd != null && vwapUsd != null && currentPriceUsd <= vwapUsd * 1.01) score += 0.15;

  if (latestCandle === "bullish") score += 0.33;
  else if (latestCandle === "flat") score += 0.12;

  if (buySellRatio != null && buySellRatio >= 0.4 && buySellRatio <= 2.5) score += 0.33;
  else if (buySellRatio != null && buySellRatio >= 0.25 && buySellRatio <= 4) score += 0.15;

  const status: RateMyEntryFactor["status"] = score >= 0.7 ? "bullish" : score >= 0.35 ? "neutral" : "bearish";
  const detail = status === "bullish"
    ? "Order-flow style confirmation is supportive: price is not stretched versus VWAP and the tape is balanced."
    : status === "neutral"
      ? "Flow confirmation is mixed, so timing is acceptable but not especially strong."
      : "Flow confirmation is weak: the token is either stretched, printing weak candles, or has lopsided trade flow.";

  return { score: round(Math.min(score, 1), 2), status, detail };
}

function scoreIndicatorSummary(signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell") {
  switch (signal) {
    case "strong_buy":
      return { score: 1, status: "bullish" as const, detail: "The aggregate indicator summary is strong_buy." };
    case "buy":
      return { score: 0.8, status: "bullish" as const, detail: "The aggregate indicator summary is buy." };
    case "neutral":
      return { score: 0.4, status: "neutral" as const, detail: "The aggregate indicator summary is neutral." };
    case "sell":
      return { score: 0.15, status: "bearish" as const, detail: "The aggregate indicator summary is sell." };
    case "strong_sell":
      return { score: 0, status: "bearish" as const, detail: "The aggregate indicator summary is strong_sell." };
  }
}

function scoreSafety(
  isScam: boolean | null,
  riskLevel: number | null,
  warnings: string[],
  hardStops: string[],
) {
  if (isScam === true) {
    hardStops.push("Scam triage flagged this token as unsafe.");
    return { score: 0, status: "bearish" as const, detail: "Risk checks flag this token as a likely scam." };
  }

  if (riskLevel != null && riskLevel >= 60) {
    hardStops.push(`Risk level is ${riskLevel}, which is too high for a swing entry.`);
    return { score: 0, status: "bearish" as const, detail: "Risk level is high enough to invalidate the setup." };
  }

  if (riskLevel != null && riskLevel >= 30) {
    return {
      score: 0.4,
      status: "neutral" as const,
      detail: warnings.length ? `Risk is elevated and carries warnings: ${warnings.join("; ")}` : "Risk is elevated, so size should stay smaller than usual.",
    };
  }

  if (riskLevel != null) {
    return { score: 1, status: "bullish" as const, detail: "Risk checks are clean enough for a normal swing-trade review." };
  }

  return { score: 0.6, status: "neutral" as const, detail: "Risk data is incomplete, so safety confidence is moderate rather than high." };
}

function classifyLatestCandle(open: number | null | undefined, close: number | null | undefined) {
  if (open == null || close == null) return "unknown" as const;
  if (close > open) return "bullish" as const;
  if (close < open) return "bearish" as const;
  return "flat" as const;
}

function classifyEmaStack(
  emaShortUsd: number | null | undefined,
  emaMediumUsd: number | null | undefined,
  emaLongUsd: number | null | undefined,
) {
  if (emaShortUsd == null || emaMediumUsd == null || emaLongUsd == null) return "unknown" as const;
  if (emaShortUsd > emaMediumUsd && emaMediumUsd > emaLongUsd) return "bullish" as const;
  if (emaShortUsd < emaMediumUsd && emaMediumUsd < emaLongUsd) return "bearish" as const;
  return "mixed" as const;
}

function computeCurrentPosition(currentPriceUsd: number | null, supportUsd: number | null, resistanceUsd: number | null) {
  if (currentPriceUsd == null || supportUsd == null || resistanceUsd == null || resistanceUsd <= supportUsd) {
    return null;
  }
  return clamp((currentPriceUsd - supportUsd) / (resistanceUsd - supportUsd), 0, 1);
}

function computeBetterEntryPrice(currentPriceUsd: number | null, candidates: Array<number | null>) {
  if (currentPriceUsd == null) return null;
  const valid = candidates.filter((candidate): candidate is number => candidate != null && Number.isFinite(candidate) && candidate > 0 && candidate < currentPriceUsd * 0.995);
  if (!valid.length) return null;
  return Math.max(...valid);
}

function mergeProviders(...providerLists: ProviderStatus[][]): ProviderStatus[] {
  const merged = new Map<string, ProviderStatus>();
  for (const provider of providerLists.flat()) {
    const existing = merged.get(provider.provider);
    if (!existing || rankProviderStatus(provider.status) > rankProviderStatus(existing.status)) {
      merged.set(provider.provider, provider);
    }
  }
  return [...merged.values()];
}

function rankProviderStatus(status: ProviderStatus["status"]) {
  switch (status) {
    case "ok":
      return 3;
    case "error":
      return 2;
    case "skipped":
      return 1;
  }
}

function pushFactor(
  factors: RateMyEntryFactor[],
  name: string,
  status: RateMyEntryFactor["status"],
  score: number,
  maxScore: number,
  detail: string,
) {
  factors.push({ name, status, score: round(score, 2), maxScore, detail });
}

function buildSummaryText(
  action: "enter_now" | "wait_for_pullback" | "avoid",
  score: number,
  betterEntryPriceUsd: number | null,
  summarySignal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell",
  hardStops: string[],
) {
  if (action === "avoid") {
    return `Entry is rated ${score}/10. Risk controls reject this setup right now.${hardStops.length ? ` ${hardStops[0]}` : ""}`;
  }
  if (action === "enter_now") {
    return `Entry is rated ${score}/10. The setup clears the swing-trade checks with an aggregate indicator signal of ${summarySignal}.`;
  }
  if (betterEntryPriceUsd != null) {
    return `Entry is rated ${score}/10. Wait for a better pullback closer to ${formatPrice(betterEntryPriceUsd)} before treating it as a swing entry.`;
  }
  return `Entry is rated ${score}/10. The setup is not clean enough yet, so waiting for better confirmation is the higher-quality play.`;
}

function firstNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPrice(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 1000) return round(value, 2);
  if (value >= 1) return round(value, 4);
  if (value >= 0.01) return round(value, 6);
  if (value >= 0.0001) return round(value, 8);
  return Number(value.toPrecision(8));
}

function unique(values: string[]) {
  return [...new Set(values)];
}