// momentumGains.js - Momentum Detection Scanner
//
// Monitors tokens for sustained upward momentum by detecting consecutive price gains
// of 10% or more every 3-minute period across multiple epochs.
// When +10% gains are sustained over 9-10 minutes or more, signals strong buying momentum.
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
// 🎯 STRATEGY FOR MOMENTUM GAINS:
//  ✅ Price UP +5% (or more) in last hour
//  ✅ Buy ratio 50%+ (more buyers than sellers pushing price up)
//  Together = CONFIRMED UPTREND (not just fake pump with no buyers)
//
// 📍 EXAMPLE FROM LOGS:
//  [1/4] UGOR...
//   1h: -37.67%, buy: 50.0%
//   ❌ FAIL
//
//  Why FAIL?
//  • 1h change: -37.67% ❌ (we want UP, not down)
//  • buy ratio: 50.0% ✅ (meets threshold, but price going DOWN = sellers winning)
//  → Token is failing because price is DOWN, not because of buy ratio
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { configureSignalSolLogging } from "./logging.js";
import { emitSignalEvent } from "./signalEmitter.js";
import { API_HEADERS, BASE_URL } from "./runtimeConfig.js";

configureSignalSolLogging();

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

// ===== CONFIG =====
const CONFIG = {
  // Token discovery (volatilityScanner)
  minVolume24: 100000,
  minSwingPct: 10, // Minimum swing size
  maxResults: 50, // Get top volatile candidates
  
  // Momentum filter
  minPriceChange1h: 5, // Only track +5%+ 1h gainers (more realistic)
  minBuyRatioPct: 50, // Minimum buy pressure
  
  // Tracking
  trackingDurationMinutes: 9, // Track for 9 minutes
  snapshotIntervalSeconds: 180, // Every 3 minutes
  
  // Momentum threshold
  minGainThreshold: 10, // 10% minimum per check
  sustainedGainTarget: 30, // Total +30% over tracking period = signal
  
  // Limit
  maxTokensToTrack: 15 // Track top 15 momentum candidates at once
};

// ===== STATE =====
const trackedTokens = new Map(); // tokenAddress -> {token, snapshots, alerts}
const seenTokens = new Set();

// ===== FETCH TOKENS WITH MOMENTUM POTENTIAL (VOLATILITY SCANNER) =====
async function fetchHighGainTokens() {
  try {
    console.log('📡 Fetching volatile tokens with momentum potential...');
    
    // Use volatilityScanner which actually works
    const params = new URLSearchParams({
      chain: 'sol',
      minVolume: CONFIG.minVolume24.toString(),
      minSwingPct: CONFIG.minSwingPct.toString(),
      maxResults: CONFIG.maxResults.toString()
    });
    
    const res = await fetch(`${BASE_URL}/volatilityScanner?${params}`, {
      headers: API_HEADERS
    });
    
    if (!res.ok) {
      console.log(`   ⚠️ volatilityScanner HTTP ${res.status}, retrying...`);
      return [];
    }
    
    const data = await res.json();
    let candidates = data.candidates || [];
    
    console.log(`✅ Found ${candidates.length} volatile tokens`);
    
    // Now fetch real-time data from DexScreener to check 1h gains
    const filtered = [];
    console.log(`\n📊 Verifying ${candidates.length} candidates against real-time thresholds...\n`);
    
    for (let i = 0; i < candidates.length; i++) {
      const token = candidates[i];
      try {
        console.log(`   [${i+1}/${candidates.length}] ${token.symbol}...`);
        
        const dexRes = await fetch(`${DEXSCREENER_API}/${token.address}`);
        if (!dexRes.ok) {
          console.log(`      ⚠️ DexScreener 404`);
          continue;
        }
        
        const dexData = await dexRes.json();
        const mainPair = dexData.pairs?.[0];
        
        if (!mainPair) {
          console.log(`      ⚠️ No pair`);
          continue;
        }
        
        const change1h = mainPair.priceChange?.h1 || 0;
        const buyRatio = (() => {
          const buys = mainPair.txns?.m5?.buys || 0;
          const sells = mainPair.txns?.m5?.sells || 0;
          const total = buys + sells;
          return total > 0 ? (buys / total) * 100 : 0;
        })();
        
        console.log(`      1h: ${change1h.toFixed(2)}%, buy: ${buyRatio.toFixed(1)}%`);
        
        // Only track if +5% in 1h and good buy pressure
        if (change1h >= CONFIG.minPriceChange1h && buyRatio >= CONFIG.minBuyRatioPct) {
          console.log(`      ✅ PASS`);
          filtered.push({
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            priceUsd: parseFloat(token.priceUsd),
            change1h: change1h,
            change24h: token.change24h,
            buyRatio: buyRatio,
            volume24h: token.volume24h
          });
        } else {
          console.log(`      ❌ FAIL`);
        }
        
        await new Promise(r => setTimeout(r, 300)); // Rate limit
      } catch (e) {
        console.log(`      ❌ Error: ${e.message}`);
      }
    }
    
    if (filtered.length > 0) {
      console.log(`\n🎯 Filtered to ${filtered.length} tokens with +${CONFIG.minPriceChange1h}% 1h gains`);
    } else {
      console.log(`\n📭 No tokens qualified (need +${CONFIG.minPriceChange1h}% 1h gain + ${CONFIG.minBuyRatioPct}%+ buy pressure)`);
    }
    return filtered;
  } catch (error) {
    console.error("Error fetching high-gain tokens:", error.message);
    return [];
  }
}

// ===== FETCH REAL-TIME PRICE SNAPSHOT =====
async function fetchPriceSnapshot(tokenAddress) {
  try {
    const dexResponse = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
    if (!dexResponse.ok) throw new Error(`DexScreener HTTP ${dexResponse.status}`);
    
    const dexData = await dexResponse.json();
    const mainPair = dexData.pairs?.[0];
    
    if (!mainPair) throw new Error('No pair found');
    
    return {
      timestamp: Date.now(),
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      priceChange1h: mainPair.priceChange?.h1 || 0,
      priceChange5m: mainPair.priceChange?.m5 || 0,
      volume5m: mainPair.volume?.m5 || 0,
      volume1h: mainPair.volume?.h1 || 0,
      txns5m: {
        buys: mainPair.txns?.m5?.buys || 0,
        sells: mainPair.txns?.m5?.sells || 0,
        buyRatio: (() => {
          const buys = mainPair.txns?.m5?.buys || 0;
          const sells = mainPair.txns?.m5?.sells || 0;
          const total = buys + sells;
          return total > 0 ? buys / total : 0;
        })()
      }
    };
  } catch (error) {
    console.error(`❌ Error fetching price snapshot for ${tokenAddress}:`, error.message);
    return null;
  }
}

// ===== CHECK FOR MOMENTUM SIGNAL =====
function checkMomentumSignal(tokenAddress, snapshots) {
  if (snapshots.length < 2) return null;
  
  const latest = snapshots[snapshots.length - 1];
  const oldest = snapshots[0];
  
  // Calculate total price gain from oldest to latest
  const totalGainPct = oldest.priceUsd > 0 
    ? ((latest.priceUsd - oldest.priceUsd) / oldest.priceUsd) * 100
    : 0;
  
  // Check for consecutive gains
  let consecutiveGains = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const gainPct = prev.priceUsd > 0 
      ? ((curr.priceUsd - prev.priceUsd) / prev.priceUsd) * 100
      : 0;
    
    if (gainPct >= CONFIG.minGainThreshold) {
      consecutiveGains++;
    }
  }
  
  // Signal if: total gain >= 30% OR consecutive gains of 10%+ each
  const hasSignal = totalGainPct >= CONFIG.sustainedGainTarget || consecutiveGains >= 2;
  
  if (hasSignal) {
    return {
      type: 'MOMENTUM_DETECTED',
      totalGainPct: Math.round(totalGainPct * 100) / 100,
      consecutiveGains: consecutiveGains,
      snapshotCount: snapshots.length,
      durationMinutes: Math.round((latest.timestamp - oldest.timestamp) / 1000 / 60),
      currentPrice: latest.priceUsd,
      buyRatio5m: latest.txns5m.buyRatio,
      severity: totalGainPct >= CONFIG.sustainedGainTarget ? 'HIGH' : 'MEDIUM'
    };
  }
  
  return null;
}

// ===== TRACK TOKEN =====
async function startTrackingToken(token) {
  const tokenAddress = token.address || token.tokenAddress;
  
  if (seenTokens.has(tokenAddress) || trackedTokens.has(tokenAddress)) {
    return; // Already tracking
  }
  
  console.log(`\n🎯 Starting momentum tracking: ${token.symbol}`);
  console.log(`   📍 Contract: ${tokenAddress}`);
  console.log(`   Initial 1h gain: ${token.change1h?.toFixed(2) || 'N/A'}%`);
  console.log(`   Price: $${token.priceUsd?.toFixed(8) || 'N/A'}\n`);
  
  seenTokens.add(tokenAddress);
  trackedTokens.set(tokenAddress, {
    token: token,
    snapshots: [],
    alerts: [],
    startTime: Date.now(),
    lastSnapshotTime: 0
  });
}

// ===== TRACK ALL ACTIVE TOKENS =====
async function captureSnapshots() {
  if (trackedTokens.size === 0) return;
  
  console.log(`\n⏱ Capturing snapshots for ${trackedTokens.size} tracked tokens...`);
  
  for (const [tokenAddress, tracker] of trackedTokens) {
    const now = Date.now();
    const timeSinceLastSnapshot = now - tracker.lastSnapshotTime;
    
    // Only capture snapshot if interval has passed
    if (timeSinceLastSnapshot < CONFIG.snapshotIntervalSeconds * 1000) {
      continue;
    }
    
    const snapshot = await fetchPriceSnapshot(tokenAddress);
    
    if (snapshot) {
      tracker.snapshots.push(snapshot);
      tracker.lastSnapshotTime = now;
      
      // Check for momentum signal
      const signal = checkMomentumSignal(tokenAddress, tracker.snapshots);
      
      if (signal) {
        tracker.alerts.push({
          ...signal,
          timestamp: Date.now()
        });
        emitSignalEvent("momentumGains", "signal_detected", {
          tokenAddress,
          symbol: tracker.token.symbol,
          name: tracker.token.name,
          ...signal,
        });
        
        console.log(`\n${'═'.repeat(80)}`);
        console.log(`🚀 MOMENTUM SIGNAL DETECTED!`);
        console.log(`${'═'.repeat(80)}`);
        console.log(`\n   Token: ${tracker.token.symbol}`);
        console.log(`   📍 Contract Address: ${tokenAddress}\n`);
        console.log(`   📊 Performance:`);
        console.log(`      Total Gain: ${signal.totalGainPct}%`);
        console.log(`      Snapshots: ${signal.snapshotCount} over ${signal.durationMinutes} minutes`);
        console.log(`      Current Price: $${signal.currentPrice?.toFixed(8)}`);
        console.log(`      Buy Ratio (5m): ${(signal.buyRatio5m * 100).toFixed(1)}%`);
        console.log(`      Severity: ${signal.severity}`);
        console.log(`\n${'═'.repeat(80)}\n`);
      }
      
      // Log snapshot
      const durationMin = Math.round((now - tracker.startTime) / 1000 / 60);
      const priceChange = ((snapshot.priceUsd - tracker.snapshots[0]?.priceUsd) / tracker.snapshots[0]?.priceUsd * 100) || 0;
      console.log(`   📊 [${tracker.token.symbol}] Snapshot #${tracker.snapshots.length} @ ${durationMin}m`);
      console.log(`      Price: $${snapshot.priceUsd?.toFixed(8)} (momentum: ${priceChange.toFixed(2)}%, 1h: ${snapshot.priceChange1h?.toFixed(2)}%)`);
      
      // Stop tracking if duration exceeded
      if (durationMin > CONFIG.trackingDurationMinutes) {
        console.log(`   ⏹ Stopped tracking ${tracker.token.symbol} (duration exceeded)`);
        trackedTokens.delete(tokenAddress);
      }
    }
    
    // Rate limit between tokens
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// ===== CLEANUP STALE ENTRIES =====
function cleanupStaleTracking() {
  const now = Date.now();
  
  for (const [tokenAddress, tracker] of trackedTokens) {
    const durationMs = now - tracker.startTime;
    const durationMinutes = durationMs / 1000 / 60;
    
    if (durationMinutes > CONFIG.trackingDurationMinutes + 1) {
      console.log(`🧹 Cleaned up ${tracker.token.symbol}`);
      trackedTokens.delete(tokenAddress);
    }
  }
}

// ===== MAIN SCANNING LOOP =====
let isScanning = false;

async function scan() {
  if (isScanning) {
    console.log("⏭ Scan already in progress, skipping...");
    return;
  }
  
  isScanning = true;
  console.time("scan");
  
  try {
    // Fetch fresh candidates
    const candidates = await fetchHighGainTokens();
    
    // Start tracking new tokens (up to max)
    const numToAdd = Math.min(
      CONFIG.maxTokensToTrack - trackedTokens.size,
      candidates.length
    );
    
    console.log(`📈 Adding ${numToAdd} new tokens to tracking (current: ${trackedTokens.size})`);
    
    for (let i = 0; i < numToAdd; i++) {
      await startTrackingToken(candidates[i]);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Capture snapshots for all tracked tokens
    await captureSnapshots();
    
    // Cleanup old entries
    cleanupStaleTracking();
    
    console.log(`📊 Tracking: ${trackedTokens.size} tokens\n`);
    emitSignalEvent("momentumGains", "scan_completed", {
      trackedTokens: trackedTokens.size,
      candidatesFound: candidates.length,
    });
    
  } catch (error) {
    console.error("❌ Scan error:", error);
    emitSignalEvent("momentumGains", "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  
  console.timeEnd("scan");
  isScanning = false;
}

// ===== STARTUP =====
async function start() {
  console.log("🚀 Starting momentum gains detector...");
  emitSignalEvent("momentumGains", "status", {
    status: "running",
    running: true,
  });
  console.log(`📋 Config: Max 3-day tokens with +${CONFIG.minPriceChange1h}% 1h gains`);
  console.log(`⏱ Tracking: ${CONFIG.trackingDurationMinutes} minutes with ${CONFIG.snapshotIntervalSeconds}s snapshots`);
  console.log(`🎯 Signal: ${CONFIG.minGainThreshold}% consecutive gains or ${CONFIG.sustainedGainTarget}% total\n`);
  
  // Initial scan
  await scan();
  
  // Set up periodic scanning every 1 minute
  setInterval(async () => {
    console.log("\n⏰ Running periodic scan...");
    await scan();
  }, 4 * 60 * 1000);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scan, start, CONFIG, trackedTokens };
} else {
  start();
}
