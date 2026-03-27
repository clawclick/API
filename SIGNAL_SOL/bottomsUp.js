// bottomsUp.js - Bottom Reversal Signal Detector
//
// Identifies potential reversal opportunities by scanning for tokens that have fallen
// 65-90% from their all-time high but are showing recent strength with 20-50% gains
// in the last hour. This combination often signals capitulation bottoms followed by
// accumulation, making them prime candidates for bounce plays or reversal trades.
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
// 🎯 STRATEGY FOR BOTTOM REVERSALS:
//  ✅ Price DOWN (capitulation / weak hands selling)
//  ✅ Buy ratio 60%+ (buyers stepping in at lows = accumulation signal)
//  Together = BOTTOM BOUNCE (buyers accumulating at capitulation lows)
//
// 📍 EXAMPLE FROM LOGS:
//  [4/4] WW3...
//   1h: -6.94%, buy: 50.0%
//   ❌ FAIL
//
//  Why FAIL?
//  • 1h change: -6.94% ✅ (price is down, good for reversal setup)
//  • buy ratio: 50.0% ❌ (we need 60%+, buyers not strong enough yet)
//  → Token is failing because buy ratio too low (need more accumulation)
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { emitSignalEvent } from "./signalEmitter.js";
import { API_HEADERS, BASE_URL } from "./runtimeConfig.js";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

// ===== CONFIG =====
const CONFIG = {
  // Step 1: Initial filter (cheap)
  minLiquidity: 5000,
  maxMarketCap: 500000,
  minVolume24: 5000,
  
  // Price criteria for bottoms
  minChangeFrom24hPct: -80, // Down at least 80% in last 24h (was -90, more realistic)
  maxChangeFrom24hPct: 0, // From neutral to down (was -10, avoid flash crashes)
  minChange1hPct: 5, // Up at least 5% in last hour (bouncing, was 20)
  maxChange1hPct: 100, // Up to 100% (was 50, more realistic)
  
  // ATH criteria (step 2: verified)
  minDropFromAthPct: -90, // Down 90% from ATH
  maxDropFromAthPct: -65, // But not less than 65% drop
  
  // Accumulation signal
  minBuyRatioPct: 60, // At least 60% buy pressure in 5m
  minBuyCountTx: 10, // Minimum buy transactions
  
  // Tracking
  priceHistoryMonths: 3, // Look back 3 months for ATH
  maxCandidatesTracked: 12, // Track max 12 tokens
  processIntervalSeconds: 300 // Re-scan every 5 minutes
};

// ===== STATE =====
const candidates = new Map(); // tokenAddress -> {token, signal, timestamp}
const signalHistory = new Set(); // Deduplicate signals

// ===== STEP 1: FETCH POTENTIAL BOTTOM CANDIDATES (VOLATILITY SCANNER) =====
async function fetchBottomCandidates() {
  try {
    console.log('📡 Step 1: Fetching volatile tokens (potential bottoms)...');
    
    // Use volatilityScanner - it actually works and has real data
    const params = new URLSearchParams({
      chain: 'sol',
      minVolume: '100000',
      minSwingPct: '10', // Use 10 like momentum (15 was causing 400)
      maxResults: '50' // Reasonable limit
    });
    
    const res = await fetch(`${BASE_URL}/volatilityScanner?${params}`, {
      headers: API_HEADERS
    });
    
    if (!res.ok) {
      console.log(`   ⚠️ volatilityScanner HTTP ${res.status}, trying fallback...`);
      // Fallback: return empty and continue
      return [];
    }
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.log(`   ⚠️ Failed to parse response`);
      return [];
    }
    
    let candidates = data.candidates || [];
    
    // Filter client-side: need recent losses but showing recovery in last hour
    // Get real-time data from DexScreener for each
    const filtered = [];
    
    for (const token of candidates) {
      try {
        const dexRes = await fetch(`${DEXSCREENER_API}/${token.address}`);
        if (!dexRes.ok) continue;
        
        const dexData = await dexRes.json();
        const mainPair = dexData.pairs?.[0];
        
        if (!mainPair) continue;
        
        const change24h = mainPair.priceChange?.h24 || 0;
        const change1h = mainPair.priceChange?.h1 || 0;
        
        // Need: down in 24h but up 20-50% in 1h (bounce signal)
        const matches24h = change24h >= CONFIG.minChangeFrom24hPct && change24h <= CONFIG.maxChangeFrom24hPct;
        const matches1h = change1h >= CONFIG.minChange1hPct && change1h <= CONFIG.maxChange1hPct;
        
        if (matches24h && matches1h) {
          filtered.push({
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            priceUsd: parseFloat(mainPair.priceUsd),
            change24h: change24h,
            change1h: change1h,
            volume24h: token.volume24h,
            liquidity: mainPair.liquidity?.usd || 0,
            marketCap: mainPair.marketCap?.usd || 0
          });
        }
        
        await new Promise(r => setTimeout(r, 200)); // Rate limit
      } catch (e) {
        // Skip token if DexScreener fails
      }
    }
    
    console.log(`✅ Found ${filtered.length} potential bottom candidates (down 10-90% in 24h, up 20-50% in 1h)`);
    return filtered;
  } catch (error) {
    console.error("Error fetching candidates:", error.message);
    return [];
  }
}

// ===== STEP 2: FETCH PRICE HISTORY & CALCULATE ATH =====
async function calculateAthDropPercent(tokenAddress, currentPrice) {
  try {
    console.log(`   🔍 Fetching 3-month price history for ATH calculation...`);
    
    const res = await fetch(
      `${BASE_URL}/tokenPriceHistory?chain=sol&tokenAddress=${tokenAddress}&limit=3m&interval=1d`,
      {
        headers: API_HEADERS
      }
    );
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    const points = data.points || [];
    
    if (points.length === 0) {
      console.log(`   ⚠️ No price history found`);
      return null;
    }
    
    // Find ATH (highest close price in history)
    let ath = 0;
    for (const point of points) {
      const closePrice = parseFloat(point.close) || 0;
      if (closePrice > ath) {
        ath = closePrice;
      }
    }
    
    if (ath === 0 || currentPrice === 0) {
      console.log(`   ⚠️ Invalid price data (ATH: ${ath}, Current: ${currentPrice})`);
      return null;
    }
    
    // Calculate drop from ATH as percentage
    const dropFromAthPct = ((currentPrice - ath) / ath) * 100;
    
    console.log(`   📊 ATH: $${ath.toFixed(8)}, Current: $${currentPrice.toFixed(8)}, Drop: ${dropFromAthPct.toFixed(2)}%`);
    
    return dropFromAthPct;
  } catch (error) {
    console.error(`   ❌ Error calculating ATH:`, error.message);
    return null;
  }
}

// ===== STEP 3: FETCH REAL-TIME DATA & VERIFY SIGNAL =====
async function verifyBottomSignal(token) {
  try {
    const tokenAddress = token.address || token.tokenAddress;
    
    console.log(`\n🔎 Verifying: ${token.symbol} (${tokenAddress.slice(0, 8)}...)`);
    console.log(`   24h change: ${token.change24h?.toFixed(2)}%, 1h change: ${token.change1h?.toFixed(2)}%`);
    
    // Fetch real-time data from DexScreener
    const dexResponse = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
    if (!dexResponse.ok) throw new Error(`DexScreener HTTP ${dexResponse.status}`);
    
    const dexData = await dexResponse.json();
    const mainPair = dexData.pairs?.[0];
    
    if (!mainPair) throw new Error('No pair found');
    
    const currentPrice = parseFloat(mainPair.priceUsd) || 0;
    const change1h = mainPair.priceChange?.h1 || 0;
    const change24h = mainPair.priceChange?.h24 || 0;
    
    // Verify 1h gain is in range
    if (change1h < CONFIG.minChange1hPct || change1h > CONFIG.maxChange1hPct) {
      console.log(`   ❌ 1h change ${change1h.toFixed(2)}% outside range [${CONFIG.minChange1hPct}, ${CONFIG.maxChange1hPct}]`);
      return null;
    }
    
    // Calculate ATH drop
    const athDropPct = await calculateAthDropPercent(tokenAddress, currentPrice);
    if (athDropPct === null) return null;
    
    // Verify ATH drop is in range (-90% to -65%)
    if (athDropPct > CONFIG.maxDropFromAthPct || athDropPct < CONFIG.minDropFromAthPct) {
      console.log(`   ❌ ATH drop ${athDropPct.toFixed(2)}% outside range [${CONFIG.minDropFromAthPct}, ${CONFIG.maxDropFromAthPct}]`);
      return null;
    }
    
    // Check buy pressure
    const buys = mainPair.txns?.m5?.buys || 0;
    const sells = mainPair.txns?.m5?.sells || 0;
    const totalTxns = buys + sells;
    const buyRatioPct = totalTxns > 0 ? (buys / totalTxns) * 100 : 0;
    
    if (buyRatioPct < CONFIG.minBuyRatioPct) {
      console.log(`   ❌ Buy ratio ${buyRatioPct.toFixed(1)}% below threshold ${CONFIG.minBuyRatioPct}%`);
      return null;
    }
    
    if (buys < CONFIG.minBuyCountTx) {
      console.log(`   ❌ Buy count ${buys} below threshold ${CONFIG.minBuyCountTx}`);
      return null;
    }
    
    // ✅ ALL CHECKS PASSED - SIGNAL!
    const signal = {
      type: 'BOTTOM_REVERSAL',
      severity: 'MEDIUM',
      token: token,
      tokenAddress: tokenAddress,
      currentPrice: currentPrice,
      change24h: change24h,
      change1h: change1h,
      athDropPct: athDropPct,
      buyRatioPct: buyRatioPct,
      buyCount5m: buys,
      volume5m: mainPair.volume?.m5 || 0,
      volume1h: mainPair.volume?.h1 || 0,
      liquidity: mainPair.liquidity?.usd || 0,
      marketCap: mainPair.marketCap?.usd || 0,
      detectedAt: new Date().toLocaleTimeString()
    };
    
    return signal;
  } catch (error) {
    console.error(`   ❌ Verification error:`, error.message);
    return null;
  }
}

// ===== DISPLAY SIGNAL =====
function displaySignal(signal) {
  console.log(`\n🎯 ===== BOTTOM REVERSAL SIGNAL ===== 🎯`);
  console.log(`\n💰 TOKEN: ${signal.token.name} (${signal.token.symbol})`);
  console.log(`📍 Address: ${signal.tokenAddress}`);
  console.log(`\n📊 PRICE & CHANGES:`);
  console.log(`   Current Price: $${signal.currentPrice.toFixed(8)}`);
  console.log(`   24h Change: ${signal.change24h.toFixed(2)}%`);
  console.log(`   1h Change: ${signal.change1h.toFixed(2)}% ✅ (${CONFIG.minChange1hPct}-${CONFIG.maxChange1hPct}% target)`);
  console.log(`   Drop from ATH: ${signal.athDropPct.toFixed(2)}% ✅ (${CONFIG.minDropFromAthPct}-${CONFIG.maxDropFromAthPct}% target)`);
  console.log(`\n⚡ ACCUMULATION SIGNALS:`);
  console.log(`   Buy Ratio (5m): ${signal.buyRatioPct.toFixed(1)}% ✅ (${CONFIG.minBuyRatioPct}%+ target)`);
  console.log(`   Buy Transactions (5m): ${signal.buyCount5m} ✅ (${CONFIG.minBuyCountTx}+ target)`);
  console.log(`   Volume 5m: $${Math.round(signal.volume5m).toLocaleString()}`);
  console.log(`   Volume 1h: $${Math.round(signal.volume1h).toLocaleString()}`);
  console.log(`\n💼 MARKET DATA:`);
  console.log(`   Liquidity: $${Math.round(signal.liquidity).toLocaleString()}`);
  console.log(`   Market Cap: $${Math.round(signal.marketCap).toLocaleString()}`);
  console.log(`\n⏰ Detected: ${signal.detectedAt}`);
  console.log(`\n🚀 INTERPRETATION: Token down ${Math.abs(signal.athDropPct).toFixed(0)}% from ATH but bouncing ${signal.change1h.toFixed(0)}% with strong buy pressure.`);
  console.log(`   This pattern often precedes significant reversals as weak holders capitulate.`);
  console.log(`\n✨ ===================================== ✨\n`);
}

// ===== SCAN & VERIFY =====
let isScanning = false;

async function scan() {
  if (isScanning) {
    console.log("⏭ Scan already in progress, skipping...");
    return;
  }
  
  isScanning = true;
  console.time("scan");
  
  try {
    // Step 1: Fetch loose candidates
    const looseCandidates = await fetchBottomCandidates();
    
    if (looseCandidates.length === 0) {
      console.log("📭 No bottom candidates found in this scan\n");
      isScanning = false;
      console.timeEnd("scan");
      return;
    }
    
    // Step 2: Verify top candidates (respecting rate limits)
    console.log(`\n🔬 Step 2: Verifying top ${Math.min(CONFIG.maxCandidatesTracked, looseCandidates.length)} candidates...`);
    
    let signalCount = 0;
    
    for (let i = 0; i < Math.min(CONFIG.maxCandidatesTracked, looseCandidates.length); i++) {
      const token = looseCandidates[i];
      const tokenAddress = token.address || token.tokenAddress;
      
      // Skip if already signaled recently
      if (signalHistory.has(tokenAddress)) {
        console.log(`⏭ Skipping ${token.symbol} (already signaled today)`);
        continue;
      }
      
      const signal = await verifyBottomSignal(token);
      
      if (signal) {
        displaySignal(signal);
        candidates.set(tokenAddress, signal);
        signalHistory.add(tokenAddress);
        signalCount++;
        emitSignalEvent("bottomsUp", "signal_detected", signal);
      }
      
      // Rate limit between verifications (2 API calls per token)
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    console.log(`\n✅ Scan complete: ${signalCount} bottom reversals detected`);
    console.log(`📊 Active signals: ${signalHistory.size} (dedup'd today)\n`);
    emitSignalEvent("bottomsUp", "scan_completed", {
      signalCount,
      activeSignals: signalHistory.size,
      candidatesScanned: Math.min(CONFIG.maxCandidatesTracked, looseCandidates.length),
    });
    
  } catch (error) {
    console.error("❌ Scan error:", error);
    emitSignalEvent("bottomsUp", "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  
  console.timeEnd("scan");
  isScanning = false;
}

// ===== STARTUP =====
async function start() {
  console.log("🚀 Starting bottom reversal detector...");
  emitSignalEvent("bottomsUp", "status", {
    status: "running",
    running: true,
  });
  console.log(`\n📋 SIGNAL CRITERIA:`);
  console.log(`   • Down ${Math.abs(CONFIG.minDropFromAthPct)}-${Math.abs(CONFIG.maxDropFromAthPct)}% from 3-month ATH`);
  console.log(`   • Up ${CONFIG.minChange1hPct}-${CONFIG.maxChange1hPct}% in last hour (bouncing)`);
  console.log(`   • ${CONFIG.minBuyRatioPct}%+ buy pressure in 5m window`);
  console.log(`   • Min ${CONFIG.minBuyCountTx} buy transactions\n`);
  console.log(`⏱ Re-scanning every ${CONFIG.processIntervalSeconds / 60} minutes\n`);
  
  // Initial scan
  await scan();
  
  // Periodic scanning
  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Running periodic bottom scan...`);
    await scan();
  }, CONFIG.processIntervalSeconds * 1000);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scan, start, CONFIG, candidates, signalHistory };
} else {
  start();
}
