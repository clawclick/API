#!/usr/bin/env node

/**
 * momentumStart.js - Early Momentum Detection for Solana New Pairs
 * 
 * Detects tokens at their LAUNCH phase by monitoring:
 * 1. Early transaction volume spikes (sudden activity increase)
 * 2. Buy-side pressure (% of transactions that are buys)
 * 3. Price momentum (initial gains in first minutes)
 * 4. Early adopter activity (holder count growth)
 * 
 * Signals tokens that show strong early momentum traits before price explodes.
 */

import { configureSignalSolLogging } from "./logging.js";
import { emitSignalEvent } from "./signalEmitter.js";
import { API_HEADERS, BASE_URL } from "./runtimeConfig.js";

configureSignalSolLogging();

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";
const SOLSCAN_API = "https://api-v2.solscan.io";

// ===== CONFIG =====
const CONFIG = {
  // Discovery: Look for new/small cap pairs
  minLiquidityUsd: 1000,      // Very new pairs might have low liquidity
  maxLiquidityUsd: 500000,    // Not too established yet
  maxAgeMinutes: 120,         // Pairs created in last 2 hours
  maxResults: 100,
  
  // Early momentum signals
  minInitialBuyRatio: 65,     // 65%+ buys = strong early interest
  minVolumeSpike: 200,        // Volume grew 2x+ in recent period
  minTransactionCount: 30,    // At least 30 transactions in tracking window
  minEarlyGainPct: 3,         // Just 3% in first few minutes
  
  // Tracking phase
  trackingDurationSeconds: 300,  // Track for 5 minutes from detection
  snapshotIntervalSeconds: 15,   // Frequent snapshots for new pairs
  
  // Detection thresholds
  volumeSpikeThreshold: 1.5,  // 50%+ volume increase = spike
  buyPressureThreshold: 70,   // 70%+ buys = strong pressure
  
  maxTokensToTrack: 20
};

// ===== STATE =====
const trackedTokens = new Map();
const detectedSignals = new Map();
const seenTokens = new Set();

// ===== FETCH NEW PAIRS =====
async function fetchNewPairs() {
  try {
    console.log('🔍 Scanning for new Solana pairs...');
    
    // Match the current local route contract, then apply age filters client-side.
    const params = new URLSearchParams({
      source: 'pumpfun',
      limit: Math.min(CONFIG.maxResults, 50).toString()
    });
    
    const res = await fetch(`${BASE_URL}/newPairs?${params}`, {
      headers: API_HEADERS
    });
    
    if (!res.ok) {
      console.log(`   ⚠️ newPairs HTTP ${res.status}, trying volatilityScanner...`);
      return await fetchNewPairsFallback();
    }
    
    const data = await res.json();
    const nowTs = Math.floor(Date.now() / 1000);
    const pairs = (data.pairs || data.candidates || [])
      .filter((pair) => {
        if (!pair?.tokenAddress) {
          return false;
        }

        const chainId = typeof pair.chainId === 'string' ? pair.chainId.toLowerCase() : '';
        if (chainId && chainId !== 'solana') {
          return false;
        }

        if (!pair.createdAt) {
          return true;
        }

        const createdAt = Number(pair.createdAt);
        if (!Number.isFinite(createdAt) || createdAt <= 0) {
          return true;
        }

        const ageMinutes = (nowTs - createdAt) / 60;
        return ageMinutes <= CONFIG.maxAgeMinutes;
      })
      .map((pair) => {
        const createdAt = Number(pair.createdAt);
        const ageMinutes = Number.isFinite(createdAt) && createdAt > 0
          ? Math.max(0, Math.floor((nowTs - createdAt) / 60))
          : null;

        return {
          address: pair.tokenAddress,
          symbol: pair.symbol,
          name: pair.name,
          liquidity: pair.tvl || 0,
          marketCap: pair.marketCap || 0,
          createdAt: pair.createdAt || null,
          age: ageMinutes === null ? 'new' : `${ageMinutes}m`
        };
      });
    
    console.log(`✅ Found ${pairs.length} new pairs`);
    return pairs;
    
  } catch (error) {
    console.error("Error fetching new pairs:", error.message);
    return [];
  }
}

// ===== FALLBACK: GET NEW PAIRS VIA DEXSCREENER =====
async function fetchNewPairsFallback() {
  try {
    console.log('   📡 Fetching from DexScreener...');
    
    // DexScreener's boosts endpoint shows trending new pairs
    const res = await fetch('https://api.dexscreener.com/token/Solana/boosts');
    if (!res.ok) return [];
    
    const data = await res.json();
    const pairs = data.boosts || [];
    
    // Filter for very new tokens
    const newPairs = pairs.slice(0, 50).map(p => ({
      address: p.tokenAddress || p.address,
      symbol: p.tokenSymbol || p.symbol,
      name: p.tokenName || p.name,
      priceUsd: parseFloat(p.priceUsd) || 0,
      liquidity: p.liquidity?.usd || 0,
      volume24h: p.volume?.h24 || 0,
      age: 'new' // Boosted tokens are recent
    }));
    
    console.log(`✅ Got ${newPairs.length} boosted pairs from DexScreener`);
    return newPairs;
    
  } catch (error) {
    console.error("Fallback error:", error.message);
    return [];
  }
}

// ===== FETCH DETAILED METRICS =====
async function fetchDetailedMetrics(tokenAddress) {
  try {
    const dexRes = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
    if (!dexRes.ok) return null;
    
    const dexData = await dexRes.json();
    const mainPair = dexData.pairs?.[0];
    
    if (!mainPair) return null;
    
    // Extract symbol and name - try multiple sources
    let symbol = null;
    let name = null;
    
    // Try baseToken first (usually the actual token, not the pair)
    if (mainPair.baseToken) {
      symbol = mainPair.baseToken.symbol || null;
      name = mainPair.baseToken.name || null;
    }
    
    // Fallback to direct properties
    if (!symbol) symbol = mainPair.tokenSymbol || mainPair.symbol || null;
    if (!name) name = mainPair.tokenName || mainPair.name || null;
    
    // Calculate buy ratio from last 5 minutes
    const buys = mainPair.txns?.m5?.buys || 0;
    const sells = mainPair.txns?.m5?.sells || 0;
    const totalTxns = buys + sells;
    const buyRatio = totalTxns > 0 ? (buys / totalTxns) * 100 : 50;
    
    // Calculate volume spike
    const vol5m = mainPair.volume?.m5 || 0;
    const vol1h = mainPair.volume?.h1 || 1; // Avoid division by zero
    const volumeSpike = vol1h > 0 ? vol5m / vol1h : 0;
    
    return {
      timestamp: Date.now(),
      address: tokenAddress,
      symbol: symbol,
      name: name,
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      priceChange5m: mainPair.priceChange?.m5 || 0,
      priceChange15m: mainPair.priceChange?.m15 || 0,
      priceChange1h: mainPair.priceChange?.h1 || 0,
      
      volume: {
        vol5m: vol5m,
        vol1h: vol1h,
        vol24h: mainPair.volume?.h24 || 0,
        spike: volumeSpike
      },
      
      transactions: {
        buys: buys,
        sells: sells,
        total: totalTxns,
        buyRatio: buyRatio
      },
      
      liquidity: {
        usd: mainPair.liquidity?.usd || 0,
        base: mainPair.liquidity?.base || 0,
        quote: mainPair.liquidity?.quote || 0
      },
      
      holders: mainPair.holders || 0,
      pairCreated: mainPair.pairCreatedAt || 0
    };
  } catch (error) {
    console.error(`Error fetching metrics for ${tokenAddress}:`, error.message);
    return null;
  }
}

// ===== CHECK FOR EARLY MOMENTUM SIGNAL =====
function detectEarlyMomentum(tokenAddress, tracker) {
  const snapshots = tracker.snapshots;
  if (snapshots.length < 2) return null;
  
  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  
  // Calculate gains since first snapshot
  const gainSince = first.priceUsd > 0
    ? ((latest.priceUsd - first.priceUsd) / first.priceUsd) * 100
    : 0;
  
  // Calculate average buy ratio
  const avgBuyRatio = snapshots.reduce((sum, s) => sum + s.transactions.buyRatio, 0) / snapshots.length;
  
  // Detect volume spike (5m volume much higher than normal)
  const avgVolumeSpike = snapshots.reduce((sum, s) => sum + s.volume.spike, 0) / snapshots.length;
  
  // Total transaction count
  const totalTxns = snapshots.reduce((sum, s) => sum + s.transactions.total, 0);
  
  // Signal criteria: strong buy pressure + volume activity + early gains
  const signals = {
    strongBuyPressure: avgBuyRatio >= CONFIG.buyPressureThreshold,
    volumeActivity: totalTxns >= CONFIG.minTransactionCount,
    earlyGains: gainSince >= CONFIG.minEarlyGainPct,
    highBuyRatio: avgBuyRatio >= CONFIG.minInitialBuyRatio
  };
  
  // Trigger alert if multiple conditions met
  const metConditions = Object.values(signals).filter(v => v).length;
  
  if (metConditions >= 3) {
    return {
      type: 'EARLY_MOMENTUM',
      confidence: Math.min(95, metConditions * 25),
      
      buyPressure: {
        avgRatio: Math.round(avgBuyRatio * 10) / 10,
        firstSnapshot: first.transactions.buyRatio,
        latestSnapshot: latest.transactions.buyRatio,
        threshold: CONFIG.buyPressureThreshold,
        pass: signals.strongBuyPressure
      },
      
      volumeActivity: {
        totalTransactions: totalTxns,
        avgVolumeSpike: Math.round(avgVolumeSpike * 100) / 100,
        threshold: CONFIG.minTransactionCount,
        pass: signals.volumeActivity
      },
      
      priceAction: {
        gainSince: Math.round(gainSince * 100) / 100,
        current1hChange: latest.priceChange1h,
        firstSnapshot: first.priceUsd,
        latestSnapshot: latest.priceUsd,
        threshold: CONFIG.minEarlyGainPct,
        pass: signals.earlyGains
      },
      
      snapshotsAnalyzed: snapshots.length,
      durationSeconds: Math.round((latest.timestamp - first.timestamp) / 1000),
      
      metrics: signals
    };
  }
  
  return null;
}

// ===== START TRACKING TOKEN =====
async function trackToken(pair) {
  const tokenAddress = pair.address || pair.tokenAddress;
  
  if (seenTokens.has(tokenAddress) || trackedTokens.has(tokenAddress)) {
    return;
  }
  
  console.log(`\n🎯 Tracking new pair: ${pair.symbol}`);
  console.log(`   Address: ${tokenAddress}`);
  console.log(`   Liquidity: $${pair.liquidity?.toLocaleString() || pair.liquidityUsd?.toLocaleString() || 'N/A'}`);
  console.log(`   Age: ${pair.age || 'new'}\n`);
  
  seenTokens.add(tokenAddress);
  trackedTokens.set(tokenAddress, {
    pair: pair,
    snapshots: [],
    signals: [],
    startTime: Date.now(),
    lastSnapshotTime: 0
  });
}

// ===== CAPTURE SNAPSHOTS =====
async function captureSnapshots() {
  if (trackedTokens.size === 0) return;
  
  console.log(`⏱️ Capturing metrics for ${trackedTokens.size} pairs...`);
  
  for (const [tokenAddress, tracker] of trackedTokens) {
    const now = Date.now();
    const timeSinceSnapshot = now - tracker.lastSnapshotTime;
    
    if (timeSinceSnapshot < CONFIG.snapshotIntervalSeconds * 1000) {
      continue;
    }
    
    const metrics = await fetchDetailedMetrics(tokenAddress);
    
    if (metrics) {
      tracker.snapshots.push(metrics);
      tracker.lastSnapshotTime = now;
      
      const durationSec = Math.round((now - tracker.startTime) / 1000);
      const gainPct = ((metrics.priceUsd - tracker.snapshots[0].priceUsd) / tracker.snapshots[0].priceUsd * 100) || 0;
      
      const displaySymbol = metrics.symbol || tracker.pair.symbol || 'UNKNOWN';
      console.log(`   📊 [${displaySymbol}] @${durationSec}s - $${metrics.priceUsd.toFixed(8)} (+${gainPct.toFixed(2)}%, buy: ${metrics.transactions.buyRatio.toFixed(0)}%)`);
      
      // Check for signal
      const signal = detectEarlyMomentum(tokenAddress, tracker);
      if (signal) {
        tracker.signals.push(signal);
        detectedSignals.set(tokenAddress, signal);
        emitSignalEvent("momentumStart", "signal_detected", {
          tokenAddress,
          symbol: metrics.symbol || tracker.pair.symbol || null,
          name: metrics.name || tracker.pair.name || null,
          ...signal,
        });
        
        const tokenName = metrics.name || tracker.pair.name || 'Unknown Token';
        const tokenTicker = metrics.symbol || tracker.pair.symbol || 'UNKNOWN';
        
        console.log(`\n${'═'.repeat(90)}`);
        console.log(`🚀 EARLY MOMENTUM DETECTED!`);
        console.log(`${'═'.repeat(90)}`);
        console.log(`\n   Token: $${tokenTicker} - ${tokenName}`);
        console.log(`   📍 Contract: ${tokenAddress}`);
        console.log(`   Confidence: ${signal.confidence}%\n`);
        console.log(`   Buy Pressure: ${signal.buyPressure.avgRatio.toFixed(1)}% (threshold: ${CONFIG.buyPressureThreshold}%) ✅`);
        console.log(`   Volume Activity: ${signal.volumeActivity.totalTransactions} txns (threshold: ${CONFIG.minTransactionCount}) ✅`);
        console.log(`   Early Gains: +${signal.priceAction.gainSince.toFixed(2)}% in ${signal.durationSeconds}s ✅`);
        console.log(`   Current Price: $${signal.priceAction.latestSnapshot.toFixed(8)}`);
        console.log(`   1h Change: ${signal.priceAction.current1hChange.toFixed(2)}%\n`);
        console.log(`${'═'.repeat(90)}\n`);
      }
      
      // Stop tracking after duration
      const durationMin = (now - tracker.startTime) / 1000 / 60;
      if (durationMin > CONFIG.trackingDurationSeconds / 60) {
        console.log(`⏹️ Stopped tracking ${tracker.pair.symbol}`);
        trackedTokens.delete(tokenAddress);
      }
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
}

// ===== MAIN SCAN =====
let isScanning = false;

async function scan() {
  if (isScanning) {
    console.log("⏭️ Scan in progress, skipping...");
    return;
  }
  
  isScanning = true;
  console.time("scan");
  
  try {
    const pairs = await fetchNewPairs();
    
    // Start tracking new pairs
    const numToAdd = Math.min(
      CONFIG.maxTokensToTrack - trackedTokens.size,
      pairs.length
    );
    
    console.log(`📈 Adding ${numToAdd} new pairs to tracking (current: ${trackedTokens.size})`);
    
    for (let i = 0; i < numToAdd; i++) {
      await trackToken(pairs[i]);
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Capture metrics
    await captureSnapshots();
    
    console.log(`\n📊 Tracking: ${trackedTokens.size} new pairs | Signals detected: ${detectedSignals.size}\n`);
    emitSignalEvent("momentumStart", "scan_completed", {
      trackedTokens: trackedTokens.size,
      detectedSignals: detectedSignals.size,
      pairsFound: pairs.length,
    });
    
  } catch (error) {
    console.error("❌ Scan error:", error);
    emitSignalEvent("momentumStart", "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  
  console.timeEnd("scan");
  isScanning = false;
}

// ===== STARTUP =====
async function start() {
  console.log("🚀 Starting early momentum detector for Solana new pairs...");
  emitSignalEvent("momentumStart", "status", {
    status: "running",
    running: true,
  });
  console.log(`📋 Looking for: New pairs (${CONFIG.minLiquidityUsd}-${CONFIG.maxLiquidityUsd} liquidity, <${CONFIG.maxAgeMinutes}m old)`);
  console.log(`🎯 Signals: ${CONFIG.minInitialBuyRatio}%+ buy pressure + volume + ${CONFIG.minEarlyGainPct}%+ early gains\n`);
  
  await scan();
  
  // Scan every 5 minutes for new pairs
  setInterval(async () => {
    console.log("\n⏰ Running periodic scan...");
    await scan();
  }, 5 * 60 * 1000);
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scan, start, CONFIG, trackedTokens, detectedSignals };
} else {
  start();
}
