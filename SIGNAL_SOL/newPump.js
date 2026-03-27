// newPump.js - Fresh Token Discovery & Filtering Engine
//
// Discovers newly created or trending Solana tokens and applies rigorous filters
// to identify high-quality opportunities with strong fundamentals.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 📊 UNDERSTANDING BUY RATIO
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Buy Ratio = percentage of buy transactions vs total transactions in the last 5 minutes
// Formula: Buy Ratio = (Number of Buys) / (Buys + Sells) × 100
//
// Examples:
//  • 100% = All transactions were buys → 🚀 STRONG BULL - Major buying pressure
//  • 75%  = 3 buys, 1 sell → 📈 BULLISH - More buyers than sellers
//  • 50%  = Equal buys and sells → ⚖️ NEUTRAL - Balanced market
//  • 25%  = 1 buy, 3 sells → 📉 BEARISH - More sellers than buyers
//  • 0%   = All transactions were sells → 💥 STRONG DUMP - Panic selling
//
// 🎯 WHY BUY RATIO MATTERS:
//  • High buy ratio (70%+) = genuine interest, not fake volume
//  • Low buy ratio (<40%) = sellers dominating = warning sign
//  • Use as confirmation: token with good fundamentals + high buys = strong signal
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { configureSignalSolLogging } from "./logging.js";
import { fetchDexScreenerPair, getPairTxns, getPairVolume } from "../Market_data/LowCaps/DEX_Screener/dexScreener.js";
import { emitSignalEvent } from "./signalEmitter.js";
import { API_HEADERS, BASE_URL } from "./runtimeConfig.js";

configureSignalSolLogging();

// ===== CONFIG =====
const CONFIG = {
  limit: 100,
  
  minVolume: 5000,
  maxVolume: 500000,
  
  minTx: 100,
  maxTx: 6000,
  
  minLiquidity: 10000,
  maxLiquidity: 100000, // Add max liquidity filter
  minMarketCap: 30000,
  maxMarketCap: 500000, // Add max market cap for early stage tokens
  
  minMomentum: 0.15,
  
  minLpToMc: 0.1,  // FIXED: Should be liquidity/marketCap, so 0.1 = 10% liquidity to mcap
  maxLpToMc: 1.0   // FIXED: Max 100% liquidity to mcap ratio
};

const WSOL = "So11111111111111111111111111111111111111112";

// ===== MEMORY =====
const seenTokens = new Set();

// ===== FETCH NEW PAIRS FROM MULTIPLE SOURCES =====
async function fetchNewPairs() {
  try {
    const res = await fetch(`${BASE_URL}/newPairs?source=pumpfun&limit=30`, {
      headers: API_HEADERS
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    console.log(`Fetched ${data.pairs?.length || 0} new pairs from PumpFun`);
    return data.pairs || [];
  } catch (error) {
    console.error("Error fetching new pairs:", error.message);
    return [];
  }
}

// ===== FETCH TRENDING TOKENS =====
async function fetchTrendingTokens() {
  try {
    const res = await fetch(`${BASE_URL}/trendingTokens`, {
      headers: API_HEADERS
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    console.log(`Fetched ${data.tokens?.length || 0} trending tokens`);
    return data.tokens?.filter(t => t.chainId === "solana") || [];
  } catch (error) {
    console.error("Error fetching trending tokens:", error.message);
    return [];
  }
}

// ===== FETCH FILTERED TOKENS FROM CODEX =====
async function fetchFilteredTokens() {
  try {
    const params = new URLSearchParams({
      network: 'sol',
      minLiquidity: CONFIG.minLiquidity.toString(),
      maxMarketCap: CONFIG.maxMarketCap.toString(),
      minVolume24: CONFIG.minVolume.toString(),
      sortBy: 'trendingScore24',
      limit: '70',
      includeScams: 'false'
    });
    
    const res = await fetch(`${BASE_URL}/filterTokens?${params}`, {
      headers: API_HEADERS
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    console.log(`Fetched ${data.tokens?.length || 0} filtered tokens from Codex`);
    return data.tokens || [];
  } catch (error) {
    console.error("Error fetching filtered tokens:", error.message);
    return [];
  }
}

// ===== FILTER SOLANA TOKENS =====
function filterSolana(tokens) {
  return tokens.filter(token => {
    const address = token.tokenAddress || token.address;
    const chainId = token.chainId || token.chain;
    
    return (chainId === "solana" || chainId === "sol") &&
           address &&
           address !== WSOL &&
           address.length > 20; // Basic Solana address validation
  });
}

// ===== GET DETAILED TOKEN INFO =====
async function getTokenDetails(address) {
  try {
    const res = await fetch(`${BASE_URL}/tokenPoolInfo?chain=sol&tokenAddress=${address}`, {
      headers: API_HEADERS
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    
    // Validate essential data exists
    if (!data.priceUsd || !data.liquidityUsd || !data.marketCapUsd) {
      return null;
    }
    
    return {
      address: address,
      name: data.name,
      symbol: data.symbol,
      priceUsd: parseFloat(data.priceUsd) || 0,
      liquidityUsd: parseFloat(data.liquidityUsd) || 0,
      marketCapUsd: parseFloat(data.marketCapUsd) || 0,
      volume24hUsd: parseFloat(data.volume24hUsd) || 0,
      priceChange24hPct: parseFloat(data.priceChange24hPct) || 0,
      pairAddress: data.pairAddress,
      dex: data.dex
    };
  } catch (error) {
    console.error(`Error getting token details for ${address}:`, error.message);
    return null;
  }
}

async function getDexScreenerMetrics(address, preferredPairAddress = null) {
  try {
    const { pair: mainPair } = await fetchDexScreenerPair(address, { preferredPairAddress });
    if (!mainPair) {
      return {
        txCount5m: 0,
        txCount1h: 0,
        txCount: 0,
        volume1h: 0,
        volume24h: 0,
        volumeChange24h: 0
      };
    }

    const txCount5m = getPairTxns(mainPair, "m5").total;
    const txCount1h = getPairTxns(mainPair, "h1").total;
    const volume1h = getPairVolume(mainPair, "h1");
    const volume24h = getPairVolume(mainPair, "h24");

    // Approximate 24h-equivalent transaction activity from the recent 1h window
    const txCount = txCount1h * 24;

    // Compare the current 1h run-rate against the trailing 24h average
    const hourlyRunRate24h = volume1h * 24;
    const volumeChange24h = volume24h > 0
      ? ((hourlyRunRate24h - volume24h) / volume24h) * 100
      : 0;

    return {
      txCount5m,
      txCount1h,
      txCount,
      volume1h,
      volume24h,
      volumeChange24h
    };
  } catch (error) {
    console.error(`Error getting DexScreener metrics for ${address}:`, error.message);
    return {
      txCount5m: 0,
      txCount1h: 0,
      txCount: 0,
      volume1h: 0,
      volume24h: 0,
      volumeChange24h: 0
    };
  }
}

// ===== ENRICH TOKEN WITH FULL DATA =====
async function enrichToken(tokenAddress, originalTokenData = null, delayBeforeMs = 0) {
  // Optional delay before starting enrichment
  if (delayBeforeMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayBeforeMs));
  }
  
  const details = await getTokenDetails(tokenAddress);
  if (!details) return null;

  const activity = await getDexScreenerMetrics(tokenAddress, details.pairAddress);
  
  // FIXED CALCULATIONS
  const momentum = details.volume24hUsd > 0 && details.marketCapUsd > 0 
    ? details.volume24hUsd / details.marketCapUsd 
    : 0;
    
  const lpToMc = details.liquidityUsd > 0 && details.marketCapUsd > 0 
    ? details.liquidityUsd / details.marketCapUsd  // FIXED: This is the correct ratio
    : 0;
  
  return {
    ca: tokenAddress,
    name: details.name,
    ticker: details.symbol,
    volume: details.volume24hUsd,
    liquidity: details.liquidityUsd,
    marketCap: details.marketCapUsd,
    price: details.priceUsd,
    priceChange24h: details.priceChange24hPct,
    txCount: activity.txCount,
    txCount5m: activity.txCount5m,
    txCount1h: activity.txCount1h,
    momentum: momentum,
    lpToMc: lpToMc,
    pairAddress: details.pairAddress,
    dex: details.dex,
    volume1h: activity.volume1h,
    volumeChange24h: activity.volumeChange24h,
    createdAt: originalTokenData?.createdAt || null // Preserve original createdAt
  };
}

// ===== PROCESS ALL TOKENS =====
async function processTokens(addresses, tokenDataMap = null) {
  const enriched = [];
  const batchSize = 1; // 1 token at a time = 2 API calls sequential (safest)
  const delayBetweenTokens = 1250; // 1.25 sec between each token for breathing room
  
  console.log(`⏱ Processing ${addresses.length} tokens sequentially with ${delayBetweenTokens}ms delays`);
  console.log(`📌 Rate limit: 5 req/sec (1 token × 2 calls = 2 req/sec + buffer)`);
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    
    for (const addr of batch) {
      try {
        const originalData = tokenDataMap ? tokenDataMap.get(addr) : null;
        const result = await enrichToken(addr, originalData);
        
        if (result) {
          enriched.push(result);
        }
        
        // Progress update
        const progress = i + 1;
        console.log(`📊 Progress: ${progress}/${addresses.length} tokens processed`);
        
        // Delay before next token (unless it's the last one)
        if (i + 1 < addresses.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenTokens));
        }
      } catch (error) {
        console.error(`❌ Failed to enrich ${addr}:`, error.message);
      }
    }
  }
  
  return enriched;
}

// ===== APPLY FILTERS =====
function applyFilters(tokens) {
  return tokens.filter(token => {
    // Basic validation
    if (!token.volume || !token.liquidity || !token.marketCap) return false;
    
    // Volume filters
    if (token.volume < CONFIG.minVolume || token.volume > CONFIG.maxVolume) return false;
    
    // Transaction count filters (if available)
    if (token.txCount > 0) {
      if (token.txCount < CONFIG.minTx || token.txCount > CONFIG.maxTx) return false;
    }
    
    // Liquidity filters
    if (token.liquidity < CONFIG.minLiquidity || token.liquidity > CONFIG.maxLiquidity) return false;
    
    // Market cap filters
    if (token.marketCap < CONFIG.minMarketCap || token.marketCap > CONFIG.maxMarketCap) return false;
    
    // Momentum filter
    if (token.momentum < CONFIG.minMomentum) return false;
    
    // FIXED: Liquidity to Market Cap ratio filter
    if (token.lpToMc < CONFIG.minLpToMc || token.lpToMc > CONFIG.maxLpToMc) return false;
    
    return true;
  });
}

// ===== SCORING ALGORITHM =====
function scoreToken(token) {
  let score = 0;
  
  // Volume score (0-30 points)
  const volumeScore = Math.min((token.volume / 50000) * 30, 30);
  score += volumeScore;
  
  // Transaction count score (0-20 points)
  if (token.txCount > 0) {
    const txScore = Math.min((token.txCount / 1000) * 20, 20);
    score += txScore;
  }
  
  // Momentum score (0-25 points)
  const momentumScore = Math.min(token.momentum * 50, 25);
  score += momentumScore;
  
  // Liquidity ratio score (0-25 points) - favor balanced ratios
  const idealLpToMc = 0.3; // 30% liquidity to mcap is ideal
  const ratioDeviation = Math.abs(token.lpToMc - idealLpToMc);
  const ratioScore = Math.max(0, 25 - (ratioDeviation * 100));
  score += ratioScore;
  
  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

// ===== RANK AND SORT =====
function rankTokens(tokens) {
  return tokens
    .map(token => ({
      ...token,
      score: scoreToken(token)
    }))
    .sort((a, b) => b.score - a.score);
}

// ===== DEDUPLICATE =====
function deduplicateTokens(tokens) {
  const newTokens = [];
  
  for (const token of tokens) {
    if (!seenTokens.has(token.ca)) {
      seenTokens.add(token.ca);
      newTokens.push(token);
    }
  }
  
  // Clean up memory if it gets too large
  if (seenTokens.size > 1000) {
    seenTokens.clear();
    console.log("🧹 Cleared seen tokens memory");
  }
  
  return newTokens;
}

// ===== MAIN EXECUTION =====
let isRunning = false;

async function run() {
  if (isRunning) {
    console.log("⏭ Skipping run (still processing previous)");
    return;
  }
  
  isRunning = true;
  console.time("run");
  
  try {
    // console.log("🔍 Starting token discovery...");
    
    // Fetch tokens from multiple sources sequentially to avoid rate limiting
    // console.log("📡 Fetching new pairs...");
    const newPairs = await fetchNewPairs();
    await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause between fetches
    
    // console.log("📡 Fetching trending tokens...");
    const trendingTokens = await fetchTrendingTokens();
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // console.log("📡 Fetching filtered tokens...");
    // const filteredTokens = await fetchFilteredTokens();
    
    // Combine and extract addresses
    const allTokens = [
      ...filterSolana(newPairs),
      ...filterSolana(trendingTokens)
      ];
    
    // Create a map of address -> token data to preserve createdAt info
    const tokenDataMap = new Map();
    allTokens.forEach(token => {
      const address = token.tokenAddress || token.address;
      if (address && !tokenDataMap.has(address)) {
        tokenDataMap.set(address, token);
      }
    });
    
    const uniqueAddresses = [...tokenDataMap.keys()];
    // console.log(`📊 Found ${uniqueAddresses.length} unique Solana tokens to analyze`);
    
    // Process tokens in batches
    // console.log("📈 Enriching token data...");
    const enrichedTokens = await processTokens(uniqueAddresses, tokenDataMap);
    // console.log(`✅ Successfully enriched ${enrichedTokens.length} tokens`);
    
    // Apply filters
    const filteredTokens2 = applyFilters(enrichedTokens);
    // console.log(`🔍 ${filteredTokens2.length} tokens passed filters`);
    
    // Rank tokens
    const rankedTokens = rankTokens(filteredTokens2);
    
    // Remove previously seen tokens
    const newSignals = deduplicateTokens(rankedTokens);
    
    // console.log(`🆕 Found ${newSignals.length} new signals`);
    
    if (newSignals.length > 0) {
      // console.log("\n🎯 === TOP NEW SIGNALS ===");
      
      // Filter by age at display time - only show tokens 1-180 minutes old
      const freshSignals = newSignals
        .map(token => {
          const now = Math.floor(Date.now() / 1000);
          const ageMinutes = token.createdAt ? Math.floor((now - token.createdAt) / 60) : null;
          return { ...token, ageMinutes };
        })
        .filter(token => {
          return token.ageMinutes !== null && 
                 token.ageMinutes >= 1 && 
                 token.ageMinutes <= 180;
        });
      
      if (freshSignals.length > 0) {
        const topFreshSignals = freshSignals.slice(0, 10);
        // console.log(`🔥 Found ${freshSignals.length} fresh signals (1-180 minutes old):`);
        
        for (const token of topFreshSignals) {
          emitSignalEvent("newPump", "signal_detected", token);
          console.log({
            ca: token.ca,
            name: token.name,
            ticker: token.ticker,
            volume: Math.round(token.volume),
            liquidity: Math.round(token.liquidity),
            marketCap: Math.round(token.marketCap),
            momentum: Math.round(token.momentum * 1000) / 1000,
            lpToMc: Math.round(token.lpToMc * 1000) / 1000,
            score: token.score,
            ageMinutes: token.ageMinutes
          });
        }
      } else {
        console.log("📭 No fresh signals found (1-180 minutes old)");
      }

      emitSignalEvent("newPump", "scan_completed", {
        uniqueAddresses: uniqueAddresses.length,
        enrichedTokens: enrichedTokens.length,
        passedFilters: filteredTokens2.length,
        newSignals: newSignals.length,
        freshSignals: freshSignals.length,
      });
    } else {
      console.log("📭 No new signals found in this scan");
      emitSignalEvent("newPump", "scan_completed", {
        uniqueAddresses: uniqueAddresses.length,
        enrichedTokens: enrichedTokens.length,
        passedFilters: filteredTokens2.length,
        newSignals: 0,
        freshSignals: 0,
      });
    }
    
  } catch (error) {
    console.error("❌ Run error:", error);
    emitSignalEvent("newPump", "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  
  console.timeEnd("run");
  isRunning = false;
}

// ===== STARTUP =====
async function start() {
  console.log("🚀 Starting newPump discovery engine...");
  emitSignalEvent("newPump", "status", {
    status: "running",
    running: true,
  });
  console.log("📋 Config:", CONFIG);
  console.log("⏱ Age Filter: Only display tokens 1-180 minutes old");
  console.log("📊 Processing: ~100 tokens per scan with 500ms batch delays");
  
  // Initial run
  await run();
  
  // Set up periodic scanning - every 3 minutes
  setInterval(async () => {
    console.log("\n⏰ Running periodic scan...");
    await run();
  }, 3 * 60 * 1000); // Every 3 minutes
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { run, start, CONFIG };
} else {
  start();
}
