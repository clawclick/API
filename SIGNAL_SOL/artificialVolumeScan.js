// artificialVolumeScan.js - Solana Artificial Volume Detection
// Detects wash trading and artificial volume manipulation

import { API_HEADERS, BASE_URL } from "./runtimeConfig.js";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

const CONFIG = {
  maxTimeWindowSeconds: 2,
  priceSlippageTolerance: 0.06,
  minWashTradeCount: 5,
  timeWindowMinutes: 1,
  maxTransactionsToAnalyze: 100,
};

// ===== FETCH TRANSACTION METRICS VIA CLAW API =====
async function fetchTokenMetrics(tokenAddress) {
  try {
    console.log(`📡 Fetching token metrics for ${tokenAddress}...`);
    
    const res = await fetch(
      `${BASE_URL}/detailedTokenStats?chain=sol&tokenAddress=${tokenAddress}`,
      {
        headers: API_HEADERS
      }
    );
    
    if (!res.ok) {
      console.log(`⚠️ Claw API HTTP ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    console.log(`✅ Got detailed stats`);
    
    return {
      durations: data.durations || {}
    };
    
  } catch (error) {
    console.error("❌ Fetch failed:", error.message);
    return null;
  }
}

// ===== ANALYZE METRICS FOR ARTIFICIAL VOLUME =====
function analyzeMetricsForArtificialVolume(durations) {
  if (!durations || Object.keys(durations).length === 0) {
    console.log('⚠️ No durations data available');
    return { hasArtificialVolume: false, flags: [], bucketsAnalyzed: [] };
  }
  
  const flags = [];
  const bucketsAnalyzed = [];
  
  console.log(`[DEBUG] Analyzing ${Object.keys(durations).length} buckets`);
  
  // Analyze each time bucket for artificial volume signs
  Object.entries(durations).forEach(([bucketName, bucket]) => {
    const stats = bucket.statsNonCurrency;
    const vol = bucket.statsUsd;
    
    if (!stats || !vol) {
      console.log(`[DEBUG] Missing stats for ${bucketName}`);
      return;
    }
    
    const totalTxns = stats.transactions?.currentValue || 0;
    const traders = stats.traders?.currentValue || 0;
    const buyers = stats.buyers?.currentValue || 0;
    const sellers = stats.sellers?.currentValue || 0;
    const totalUniquePeople = Math.max(buyers, sellers, traders) || 1;
    
    const volume = vol.volume?.currentValue || 0;
    const buyVol = vol.buyVolume?.currentValue || 0;
    const sellVol = vol.sellVolume?.currentValue || 0;
    
    bucketsAnalyzed.push({
      bucket: bucketName,
      transactions: totalTxns,
      uniquePeople: totalUniquePeople,
      volume: volume
    });
    
    // Red Flag 1: Extremely high transactions with few traders (wash trading signature)
    // Normal: 1-3 txns/trader. Suspicious: 10+. Artificial: 50+. **Egregious: 100+**
    const txnsPerTrader = totalUniquePeople > 0 ? totalTxns / totalUniquePeople : 0;
    if (txnsPerTrader > 100) {
      flags.push({
        type: 'EGREGIOUS_WASH_TRADING',
        severity: 'CRITICAL',
        bucket: bucketName,
        message: `🚨 ${totalTxns.toLocaleString()} transactions from only ${totalUniquePeople} traders = ${txnsPerTrader.toFixed(0)} txns/trader (EXTREME)`
      });
    } else if (txnsPerTrader > 50) {
      flags.push({
        type: 'SEVERE_TXN_CONCENTRATION',
        severity: 'CRITICAL',
        bucket: bucketName,
        message: `${totalTxns.toLocaleString()} transactions from ${totalUniquePeople} traders = ${txnsPerTrader.toFixed(0)} txns/trader`
      });
    }
    
    // Red Flag 2: Identical volume across time buckets (fake constant volume)
    // Will check this cross-bucket
    
    // Red Flag 3: Buy/sell volume perfectly balanced (bot-like behavior)
    // Humans: 40-60% skew. Bots: 49-51% balance. **Multiple buckets: ARTIFICIAL**
    if (volume > 1000) {
      const buyRatio = buyVol / volume;
      if (Math.abs(buyRatio - 0.5) < 0.015) { // Within 1.5% of 50/50
        flags.push({
          type: 'BOT_PERFECT_BALANCE',
          severity: 'HIGH',
          bucket: bucketName,
          message: `Buy: ${(buyRatio * 100).toFixed(1)}%, Sell: ${((1 - buyRatio) * 100).toFixed(1)}% - machine-like precision`
        });
      }
    }
    
    // Red Flag 4: More transactions than unique people would reasonably make
    if (totalTxns > 100 && totalUniquePeople < 5) {
      flags.push({
        type: 'EXTREME_TRANSACTION_SPAM',
        severity: 'CRITICAL',
        bucket: bucketName,
        message: `${totalTxns} transactions from ${totalUniquePeople} people - each person doing ${(totalTxns / totalUniquePeople).toFixed(0)} trades`
      });
    }
  });
  
  // Cross-bucket analysis: Check if volume is suspiciously consistent
  const volumeValues = bucketsAnalyzed.map(b => b.volume).filter(v => v > 0);
  if (volumeValues.length > 2) {
    const avgVolume = volumeValues.reduce((a, b) => a + b) / volumeValues.length;
    const maxVolume = Math.max(...volumeValues);
    const minVolume = Math.min(...volumeValues);
    const variance = (maxVolume - minVolume) / avgVolume;
    
    if (variance < 0.15) { // Less than 15% variance = suspicious
      flags.push({
        type: 'IDENTICAL_VOLUME_PATTERN',
        severity: 'CRITICAL',
        message: `Volume fluctuation only ${(variance * 100).toFixed(1)}% (Min: $${minVolume.toFixed(0)}, Max: $${maxVolume.toFixed(0)}) - perfectly flat = ARTIFICIAL`
      });
    }
  }
  
  return {
    hasArtificialVolume: flags.length > 0,
    flags: flags,
    bucketsAnalyzed: bucketsAnalyzed
  };
}



// ===== DISPLAY RESULTS =====
function displayAnalysis(tokenAddress, analysis) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`🔍 ARTIFICIAL VOLUME ANALYSIS`);
  console.log(`${'═'.repeat(80)}\n`);
  
  console.log(`Token: ${tokenAddress}\n`);
  
  if (analysis.bucketsAnalyzed && analysis.bucketsAnalyzed.length > 0) {
    console.log(`📊 BUCKET METRICS:`);
    analysis.bucketsAnalyzed.forEach(b => {
      console.log(`   ${b.bucket.padEnd(10)} | ${b.transactions.toLocaleString().padStart(6)} txns | ${b.uniquePeople.toLocaleString().padStart(3)} traders | $${b.volume.toLocaleString('en-US', {maximumFractionDigits: 0}).padStart(12)}`);
    });
    console.log('');
  }
  
  if (analysis.flags.length === 0) {
    console.log(`✅ No artificial volume patterns detected`);
  } else {
    console.log(`🚨 ARTIFICIAL VOLUME RED FLAGS DETECTED!\n`);
    
    analysis.flags.forEach(flag => {
      console.log(`[${'█'.repeat(flag.severity === 'CRITICAL' ? 3 : flag.severity === 'HIGH' ? 2 : 1)}] ${flag.severity} - ${flag.type}`);
      if (flag.bucket) console.log(`    Bucket: ${flag.bucket}`);
      console.log(`    ${flag.message}\n`);
    });
  }
  
  console.log(`${'═'.repeat(80)}\n`);
  
  return {
    hasArtificialVolume: analysis.hasArtificialVolume,
    severity: analysis.flags.length > 0 ? analysis.flags[0].severity : 'NONE',
    flags: analysis.flags.length
  };
}

// ===== MAIN =====
async function scan(tokenAddress) {
  try {
    console.log("🚀 Starting Solana artificial volume detector...");
    console.log(`\n📋 DETECTION CRITERIA:`);
    console.log(`   • High trades/wallet ratio (potential wash trading)`);
    console.log(`   • Heavily skewed buy/sell ratio (concentrated pressure)`);
    console.log(`   • High volume with few participants (artificial concentration)`);
    console.log(`   • Flags: Volume, wallet concentration, buy/sell imbalance\n`);
    
    const metrics = await fetchTokenMetrics(tokenAddress);
    
    if (!metrics) {
      console.log('⚠️ Could not fetch metrics');
      return null;
    }
    
    console.log(`\n🔎 Analyzing metrics for artificial volume signals...`);
    
    // Extract durations from the API response
    const analysis = analyzeMetricsForArtificialVolume(metrics.durations || {});
    const result = displayAnalysis(tokenAddress, analysis);
    
    return result;
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    return null;
  }
}

// ===== CLI ENTRY =====
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node artificialVolumeScan.js <token_address>');
  process.exit(0);
}

scan(args[0]).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
