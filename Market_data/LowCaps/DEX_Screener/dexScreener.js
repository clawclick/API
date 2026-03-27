export const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

export function toDexNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function getPairLiquidityUsd(pair) {
  return toDexNumber(pair?.liquidity?.usd);
}

export function getPairMarketCapUsd(pair) {
  return toDexNumber(pair?.marketCap) || toDexNumber(pair?.fdv);
}

export function getPairPriceUsd(pair) {
  return toDexNumber(pair?.priceUsd);
}

export function getPairPriceChange(pair, window) {
  return toDexNumber(pair?.priceChange?.[window]);
}

export function getPairVolume(pair, window) {
  return toDexNumber(pair?.volume?.[window]);
}

export function getPairTxns(pair, window) {
  const buys = toDexNumber(pair?.txns?.[window]?.buys);
  const sells = toDexNumber(pair?.txns?.[window]?.sells);
  const total = buys + sells;

  return {
    buys,
    sells,
    total,
    buyRatio: total > 0 ? buys / total : 0,
  };
}

export function getTrackedTokenInfo(pair, tokenAddress) {
  const normalizedTokenAddress = normalizeAddress(tokenAddress);
  const baseToken = pair?.baseToken ?? null;
  const quoteToken = pair?.quoteToken ?? null;

  if (normalizedTokenAddress) {
    if (normalizeAddress(baseToken?.address) === normalizedTokenAddress) {
      return baseToken;
    }

    if (normalizeAddress(quoteToken?.address) === normalizedTokenAddress) {
      return quoteToken;
    }
  }

  return baseToken ?? quoteToken;
}

export function selectDexScreenerPair(pairs, tokenAddress, preferredPairAddress = null) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return null;
  }

  const normalizedTokenAddress = normalizeAddress(tokenAddress);
  const normalizedPreferredPairAddress = normalizeAddress(preferredPairAddress);
  const solanaPairs = pairs.filter((pair) => pair?.chainId === "solana");

  if (solanaPairs.length === 0) {
    return null;
  }

  if (normalizedPreferredPairAddress) {
    const preferredPair = solanaPairs.find(
      (pair) => normalizeAddress(pair?.pairAddress) === normalizedPreferredPairAddress,
    );
    if (preferredPair) {
      return preferredPair;
    }
  }

  const matchingPairs = normalizedTokenAddress
    ? solanaPairs.filter((pair) => {
        const baseAddress = normalizeAddress(pair?.baseToken?.address);
        const quoteAddress = normalizeAddress(pair?.quoteToken?.address);
        return baseAddress === normalizedTokenAddress || quoteAddress === normalizedTokenAddress;
      })
    : solanaPairs;

  const candidates = matchingPairs.length > 0 ? matchingPairs : solanaPairs;
  return [...candidates].sort((a, b) => getPairLiquidityUsd(b) - getPairLiquidityUsd(a))[0] ?? null;
}

export async function fetchDexScreenerPair(tokenAddress, options = {}) {
  const {
    preferredPairAddress = null,
    fetchImpl = fetch,
  } = options;

  const res = await fetchImpl(`${DEXSCREENER_API}/${tokenAddress}`);
  if (!res.ok) {
    throw new Error(`DexScreener HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    data,
    pair: selectDexScreenerPair(data.pairs, tokenAddress, preferredPairAddress),
  };
}
