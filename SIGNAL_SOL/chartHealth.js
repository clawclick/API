// chartHealth.js - Real-time Token Health Tracker for Position Management
//
// Continuously monitors price, liquidity, volume, and buy pressure every 3 minutes.
// Tracks momentum changes and alerts on exit signals (price/liquidity/volume decline).
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
// 🎯 FOR POSITION MANAGEMENT:
//  • HIGH buy ratio (70%+) = token still accumulating = HOLD
//  • DECLINING buy ratio trend = selling pressure increasing = WATCH CLOSELY
//  • LOW buy ratio (<30%) = exit signal forming = PREPARE TO EXIT
//  • Combined with price/liquidity decline = strong exit signal
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configureSignalSolLogging } from './logging.js';
import {
  fetchDexScreenerPair,
  getPairMarketCapUsd,
  getPairPriceChange,
  getPairPriceUsd,
  getPairTxns,
  getPairVolume,
  toDexNumber,
} from '../Market_data/LowCaps/DEX_Screener/dexScreener.js';
import { emitSignalEvent } from './signalEmitter.js';
import { API_HEADERS, BASE_URL } from './runtimeConfig.js';

configureSignalSolLogging();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== TRACKING CONFIG =====
const TRACKING_CONFIG = {
  logInterval: 3 * 60 * 1000, // 3 minutes in milliseconds
  dataRetention: 24 * 60, // Keep 24 hours of 3-min data points
  
  // Alert thresholds for exit signals
  alerts: {
    priceDecline: -0.50,         // 50% price decline
    liquidityDecline: -0.25,     // 25% liquidity decline  
    volumeDecline: -0.75,         // 75% volume decline
    buyRatioDecline: 0.35,       // Buy ratio below 35%
    
    // Consecutive declining periods to trigger alert
    consecutiveDeclines: 3
  },
  
  // Health scoring weights  
  weights: {
    price: 0.3,         // 30% - price movement
    liquidity: 0.25,    // 25% - pool stability
    volume: 0.25,       // 25% - activity level
    buyPressure: 0.2    // 20% - buy vs sell ratio
  }
};

// ===== DATA STORAGE =====
class TokenTracker {
  constructor(tokenAddress, name = '') {
    this.tokenAddress = tokenAddress;
    this.name = name;
    this.dataFile = path.join(__dirname, 'tracking', `${tokenAddress}.json`);
    this.isTracking = false;
    this.trackingInterval = null;
    this.data = this.loadData();
    
    // Ensure tracking directory exists
    const trackingDir = path.dirname(this.dataFile);
    if (!fs.existsSync(trackingDir)) {
      fs.mkdirSync(trackingDir, { recursive: true });
    }
  }
  
  loadData() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const rawData = fs.readFileSync(this.dataFile, 'utf8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      console.error('Error loading tracking data:', error.message);
    }
    
    return {
      tokenAddress: this.tokenAddress,
      name: this.name,
      startTime: Date.now(),
      dataPoints: [],
      alerts: []
    };
  }
  
  saveData() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving tracking data:', error.message);
    }
  }
  
  // Clean old data points to prevent file bloat
  cleanOldData() {
    const cutoff = Date.now() - (TRACKING_CONFIG.dataRetention * 60 * 1000);
    this.data.dataPoints = this.data.dataPoints.filter(point => point.timestamp > cutoff);
    this.data.alerts = this.data.alerts.filter(alert => alert.timestamp > cutoff);
  }
}

// ===== FETCH REAL-TIME TOKEN DATA =====
async function fetchCurrentSnapshot(tokenAddress) {
  let poolData = null;
  let dexData = null;
  let retries = 0;
  const maxRetries = 2;
  
  try {
    console.log(`🔍 Fetching real-time snapshot for ${tokenAddress}...`);

    // Fetch pool info from claw.click (with retry for rate limits)
    let poolResponse;
    while (retries < maxRetries) {
      poolResponse = await fetch(`${BASE_URL}/tokenPoolInfo?chain=sol&tokenAddress=${tokenAddress}`, {
        headers: API_HEADERS
      });
      
      if (poolResponse.ok) {
        poolData = await poolResponse.json();
        break;
      }
      
      if (poolResponse.status === 429) {
        retries++;
        console.log(`⚠️ Rate limited, retrying in 1 second (attempt ${retries}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw new Error(`Pool API HTTP ${poolResponse.status}`);
      }
    }
    
    if (!poolData) {
      console.log('⚠️ Pool API failed, using DexScreener fallback for all values');
    }

    const dexSnapshot = await fetchDexScreenerPair(tokenAddress, {
      preferredPairAddress: poolData?.pairAddress ?? null
    });
    dexData = dexSnapshot.data;

    const mainPair = dexSnapshot.pair;
    if (!mainPair) {
      throw new Error('No trading pair found on DexScreener');
    }

    const txns5m = getPairTxns(mainPair, 'm5');
    const txns1h = getPairTxns(mainPair, 'h1');
    
    // Extract current real-time values - PREFER DexScreener for fresh data
    const snapshot = {
      timestamp: Date.now(),
      
      // Core values that change in real-time
      // Use DexScreener price as primary (more real-time), fall back to pool data
      currentPrice: getPairPriceUsd(mainPair) || parseFloat(poolData?.priceUsd) || 0,
      currentLiquidity: toDexNumber(mainPair.liquidity?.usd) || parseFloat(poolData?.liquidityUsd) || 0,
      currentMarketCap: getPairMarketCapUsd(mainPair) || parseFloat(poolData?.marketCapUsd) || 0,
      
      // Transaction activity (this changes frequently)  
      txns5m: {
        total: txns5m.total,
        buys: txns5m.buys,
        sells: txns5m.sells,
        buyRatio: txns5m.buyRatio
      },
      
      txns1h: {
        total: txns1h.total,
        buys: txns1h.buys,
        sells: txns1h.sells,
        buyRatio: txns1h.buyRatio
      },
      
      // Volume in different time windows (for context)
      volume5m: getPairVolume(mainPair, 'm5'),
      volume1h: getPairVolume(mainPair, 'h1'),
      volume24h: getPairVolume(mainPair, 'h24'),
      
      // Price changes from DexScreener (for context)
      priceChange5m: getPairPriceChange(mainPair, 'm5'),
      priceChange1h: getPairPriceChange(mainPair, 'h1'),
      
      // Meta
      dex: mainPair.dexId || poolData?.dex || 'Unknown',
      pairAddress: mainPair.pairAddress || poolData?.pairAddress
    };
    
    // Validate we have essential data
    if (!snapshot.currentPrice || !snapshot.currentLiquidity) {
      console.warn('⚠️ Missing critical data - using best effort values');
    }
    
    console.log('✅ Snapshot captured:', {
      price: `$${snapshot.currentPrice?.toFixed(8)}`,
      liquidity: `$${Math.round(snapshot.currentLiquidity)}`,
      marketCap: `$${Math.round(snapshot.currentMarketCap)}`,
      priceChange5m: `${(snapshot.priceChange5m || 0).toFixed(2)}%`,
      priceChange1h: `${(snapshot.priceChange1h || 0).toFixed(2)}%`,
      txns5m: snapshot.txns5m.total,
      buyRatio5m: `${(snapshot.txns5m.buyRatio * 100).toFixed(1)}%`,
      volume5m: `$${Math.round(snapshot.volume5m)}`
    });
    
    return snapshot;
    
  } catch (error) {
    console.error(`❌ Error fetching snapshot:`, error.message);
    return null;
  }
}

// ===== CALCULATE REAL-TIME TRENDS =====
function calculateRealTimeTrends(dataPoints, periods = [1, 2, 4, 8]) {
  if (dataPoints.length < 2) return {};
  
  const latest = dataPoints[dataPoints.length - 1];
  const trends = {};
  
  periods.forEach(period => {
    const lookbackIndex = Math.max(0, dataPoints.length - 1 - period);
    const previous = dataPoints[lookbackIndex];
    
    if (previous && latest) {
      const timeframe = `${period * 3}min`;
      
      trends[timeframe] = {
        // REAL-TIME CHANGES (not 24h aggregates)
        price: {
          change: previous.currentPrice > 0 ? 
            (latest.currentPrice - previous.currentPrice) / previous.currentPrice : 0,
          trend: latest.currentPrice > previous.currentPrice ? 'rising' : 'falling',
          current: latest.currentPrice,
          previous: previous.currentPrice,
          absolute: latest.currentPrice - previous.currentPrice
        },
        
        liquidity: {
          change: previous.currentLiquidity > 0 ? 
            (latest.currentLiquidity - previous.currentLiquidity) / previous.currentLiquidity : 0,
          trend: latest.currentLiquidity > previous.currentLiquidity ? 'growing' : 'declining',
          current: latest.currentLiquidity,
          previous: previous.currentLiquidity,
          absolute: latest.currentLiquidity - previous.currentLiquidity
        },
        
        marketCap: {
          change: previous.currentMarketCap > 0 ? 
            (latest.currentMarketCap - previous.currentMarketCap) / previous.currentMarketCap : 0,
          trend: latest.currentMarketCap > previous.currentMarketCap ? 'growing' : 'declining',
          current: latest.currentMarketCap,
          previous: previous.currentMarketCap,
          absolute: latest.currentMarketCap - previous.currentMarketCap
        },
        
        volume5m: {
          change: previous.volume5m > 0 ? 
            (latest.volume5m - previous.volume5m) / previous.volume5m : 0,
          trend: latest.volume5m > previous.volume5m ? 'rising' : 'falling',
          current: latest.volume5m,
          previous: previous.volume5m
        },
        
        buyPressure: {
          change: previous.txns5m?.buyRatio > 0 ? 
            (latest.txns5m?.buyRatio - previous.txns5m?.buyRatio) / previous.txns5m?.buyRatio : 0,
          trend: (latest.txns5m?.buyRatio || 0) > (previous.txns5m?.buyRatio || 0) ? 'improving' : 'declining',
          current: latest.txns5m?.buyRatio || 0,
          previous: previous.txns5m?.buyRatio || 0
        }
      };
    }
  });
  
  return trends;
}

// ===== CALCULATE HEALTH SCORES =====
function calculateHealthScores(trends, latest) {
  const scores = {
    price: 50,
    liquidity: 50,
    volume: 50,
    buyPressure: 50,
    overall: 50
  };
  
  const timeframes = Object.keys(trends);
  if (timeframes.length === 0 || !latest) return scores;
  
  let priceAvg = 0, liquidityAvg = 0, volumeAvg = 0, buyPressureAvg = 0;
  
  timeframes.forEach(tf => {
    priceAvg += trends[tf]?.price?.change || 0;
    liquidityAvg += trends[tf]?.liquidity?.change || 0;
    volumeAvg += trends[tf]?.volume5m?.change || 0;
    buyPressureAvg += trends[tf]?.buyPressure?.change || 0;
  });
  
  priceAvg /= timeframes.length;
  liquidityAvg /= timeframes.length;
  volumeAvg /= timeframes.length;
  buyPressureAvg /= timeframes.length;
  
  // Score based on average changes
  scores.price = Math.max(0, Math.min(100, 50 + (priceAvg * 500))); // ±20% = ±100 points
  scores.liquidity = Math.max(0, Math.min(100, 50 + (liquidityAvg * 200))); // ±50% = ±100 points  
  scores.volume = Math.max(0, Math.min(100, 50 + (volumeAvg * 100))); // ±100% = ±100 points
  scores.buyPressure = Math.max(0, Math.min(100, 50 + (buyPressureAvg * 300))); // ±33% = ±100 points
  
  // Add bonus for good absolute values (with safe access)
  const buyRatio = latest?.txns5m?.buyRatio || 0;
  const currentLiquidity = latest?.currentLiquidity || 0;
  
  if (buyRatio > 0.6) scores.buyPressure += 10; // Bonus for >60% buy ratio
  if (currentLiquidity > 50000) scores.liquidity += 5; // Bonus for >$50K liquidity
  
  // Weighted overall score
  scores.overall = 
    (scores.price * TRACKING_CONFIG.weights.price) +
    (scores.liquidity * TRACKING_CONFIG.weights.liquidity) +
    (scores.volume * TRACKING_CONFIG.weights.volume) +
    (scores.buyPressure * TRACKING_CONFIG.weights.buyPressure);
  
  return {
    price: Math.round(Math.max(0, Math.min(100, scores.price))),
    liquidity: Math.round(Math.max(0, Math.min(100, scores.liquidity))),
    volume: Math.round(Math.max(0, Math.min(100, scores.volume))),
    buyPressure: Math.round(Math.max(0, Math.min(100, scores.buyPressure))),
    overall: Math.round(Math.max(0, Math.min(100, scores.overall)))
  };
}

// ===== DETECT ALERTS =====
function detectAlerts(trends, latest) {
  const alerts = [];
  
  if (!latest) return alerts;
  
  // Check for consecutive declines
  let priceDeclines = 0, liquidityDeclines = 0, volumeDeclines = 0;
  
  Object.values(trends).forEach(trend => {
    if (trend?.price?.change < TRACKING_CONFIG.alerts.priceDecline) priceDeclines++;
    if (trend?.liquidity?.change < TRACKING_CONFIG.alerts.liquidityDecline) liquidityDeclines++;
    if (trend?.volume5m?.change < TRACKING_CONFIG.alerts.volumeDecline) volumeDeclines++;
  });
  
  // Price decline alerts
  if (priceDeclines >= TRACKING_CONFIG.alerts.consecutiveDeclines) {
    alerts.push({
      type: 'PRICE_DECLINE',
      severity: 'HIGH',
      message: `Price declining across ${priceDeclines} periods - Consider exit`,
      timestamp: Date.now()
    });
  }
  
  // Liquidity drain
  if (liquidityDeclines >= TRACKING_CONFIG.alerts.consecutiveDeclines) {
    alerts.push({
      type: 'LIQUIDITY_DRAIN',
      severity: 'HIGH',
      message: `Liquidity draining across ${liquidityDeclines} periods - Major risk!`,
      timestamp: Date.now()
    });
  }
  
  // Critical sell pressure - safe access
  const buyRatio = latest?.txns5m?.buyRatio || 0;
  if (buyRatio > 0 && buyRatio < 0.3) {
    alerts.push({
      type: 'SELL_PRESSURE',
      severity: 'CRITICAL',
      message: `🔴 Heavy sell pressure: ${Math.round(buyRatio * 100)}% buy ratio`,
      timestamp: Date.now()
    });
  }
  
  // Bull signals - safe access
  if (buyRatio > 0.7) {
    const priceRising = Object.values(trends).some(t => t?.price?.change > 0.05);
    if (priceRising) {
      alerts.push({
        type: 'BULL_MOMENTUM',
        severity: 'LOW',
        message: `🚀 Strong momentum: ${Math.round(buyRatio * 100)}% buy ratio + price rising`,
        timestamp: Date.now()
      });
    }
  }
  
  return alerts;
}

// ===== DISPLAY REAL-TIME STATUS =====
function displayStatus(tracker, trends, scores, alerts) {
  const latest = tracker.data.dataPoints[tracker.data.dataPoints.length - 1];
  if (!latest) return;
  
  console.clear();
  console.log('📊 === REAL-TIME TOKEN HEALTH TRACKER ===');
  console.log(`Token: ${tracker.name || 'Unknown'} (${tracker.tokenAddress.slice(0, 8)}...)`);
  console.log(`Tracking since: ${new Date(tracker.data.startTime).toLocaleString()}`);
  console.log(`Data points: ${tracker.data.dataPoints.length}`);
  console.log(`Last update: ${new Date(latest.timestamp).toLocaleTimeString()}\n`);
  
  // Current snapshot values
  console.log('💰 CURRENT SNAPSHOT:');
  console.log(`Price: $${latest.currentPrice?.toFixed(8) || 'N/A'}`);
  console.log(`Price Change (5m): ${latest.priceChange5m ? (latest.priceChange5m >= 0 ? '📈 +' : '📉 ') + latest.priceChange5m.toFixed(2) + '%' : 'N/A'}`);
  console.log(`Price Change (1h): ${latest.priceChange1h ? (latest.priceChange1h >= 0 ? '📈 +' : '📉 ') + latest.priceChange1h.toFixed(2) + '%' : 'N/A'}`);
  console.log(`Liquidity: $${latest.currentLiquidity?.toLocaleString() || 'N/A'}`);
  console.log(`Market Cap: $${latest.currentMarketCap?.toLocaleString() || 'N/A'}`);
  console.log(`DEX: ${latest.dex || 'Unknown'}\n`);
  
  // Activity levels
  console.log('⚡ RECENT ACTIVITY:');
  console.log(`5min Volume: $${latest.volume5m?.toLocaleString() || 'N/A'}`);
  console.log(`5min Transactions: ${latest.txns5m?.total || 0} (${latest.txns5m?.buys || 0} buys, ${latest.txns5m?.sells || 0} sells)`);
  console.log(`5min Buy Ratio: ${latest.txns5m?.buyRatio ? (latest.txns5m.buyRatio * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`1h Transactions: ${latest.txns1h?.total || 0} (Buy ratio: ${latest.txns1h?.buyRatio ? (latest.txns1h.buyRatio * 100).toFixed(1) + '%' : 'N/A'})\n`);
  
  // Health scores
  const healthEmoji = scores.overall >= 70 ? '🟢' : scores.overall >= 40 ? '🟡' : '🔴';
  console.log(`🏥 HEALTH SCORES: ${healthEmoji}`);
  console.log(`Overall: ${scores.overall}/100`);
  console.log(`Price Momentum: ${scores.price}/100`);
  console.log(`Liquidity: ${scores.liquidity}/100`);
  console.log(`Volume: ${scores.volume}/100`);
  console.log(`Buy Pressure: ${scores.buyPressure}/100\n`);
  
  // Real-time trends
  if (Object.keys(trends).length > 0) {
    console.log('📈 REAL-TIME TRENDS (snapshot vs snapshot):');
    Object.entries(trends).forEach(([period, trend]) => {
      const priceEmoji = trend.price?.change > 0 ? '📈' : '📉';
      const liqEmoji = trend.liquidity?.change > 0 ? '💧⬆️' : '💧⬇️';
      const volEmoji = trend.volume5m?.change > 0 ? '🔊' : '🔉';
      const buyEmoji = trend.buyPressure?.change > 0 ? '🟢' : '🔴';
      
      console.log(`${period} ago: ${priceEmoji} Price ${(trend.price?.change * 100)?.toFixed(2) || 'N/A'}% | ${liqEmoji} Liq ${(trend.liquidity?.change * 100)?.toFixed(1) || 'N/A'}% | ${volEmoji} Vol5m ${(trend.volume5m?.change * 100)?.toFixed(1) || 'N/A'}% | ${buyEmoji} BuyP ${(trend.buyPressure?.change * 100)?.toFixed(1) || 'N/A'}%`);
    });
  }
  
  // Active alerts
  if (alerts.length > 0) {
    console.log('\n🚨 ACTIVE ALERTS:');
    alerts.slice(-5).forEach(alert => {
      const emoji = alert.severity === 'CRITICAL' ? '🚨' : alert.severity === 'HIGH' ? '⚠️' : 'ℹ️';
      console.log(`${emoji} ${alert.message}`);
    });
  }
  
  console.log('\n⏰ Next snapshot in ~3 minutes...');
}

// ===== MAIN TRACKING FUNCTION =====
export async function trackToken(tokenAddress, tokenName = '') {
  const tracker = new TokenTracker(tokenAddress, tokenName);
  
  console.log(`🎯 Starting REAL-TIME tracking for ${tokenName || tokenAddress}`);
  emitSignalEvent('chartHealth', 'status', {
    status: 'running',
    running: true
  }, {
    scope: 'token',
    tokenAddress
  });
  console.log('📊 Capturing live snapshots every 3 minutes to track momentum changes');
  console.log('💾 Data will be saved to:', tracker.dataFile);
  
  tracker.isTracking = true;
  
  const trackingLoop = async () => {
    if (!tracker.isTracking) return;
    
    try {
      console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Capturing real-time snapshot...`);
      
      const currentSnapshot = await fetchCurrentSnapshot(tokenAddress);
      if (!currentSnapshot) {
        console.log('❌ Failed to capture snapshot, retrying in 3 minutes...');
        setTimeout(trackingLoop, TRACKING_CONFIG.logInterval);
        return;
      }
      
      // Store snapshot
      tracker.data.dataPoints.push(currentSnapshot);
      tracker.cleanOldData();
      
      // Calculate trends (need at least 2 points)
      if (tracker.data.dataPoints.length >= 2) {
        try {
          const trends = calculateRealTimeTrends(tracker.data.dataPoints);
          const scores = calculateHealthScores(trends, currentSnapshot);
          const newAlerts = detectAlerts(trends, currentSnapshot);

          emitSignalEvent('chartHealth', 'snapshot', {
            tokenAddress,
            tokenName: tracker.name || tokenName || null,
            snapshot: currentSnapshot,
            scores,
            trends
          }, {
            scope: 'token',
            tokenAddress
          });
          
          // Add new alerts
          if (newAlerts && newAlerts.length > 0) {
            tracker.data.alerts.push(...newAlerts);
            newAlerts.forEach((alert) => {
              emitSignalEvent('chartHealth', 'alert', {
                tokenAddress,
                tokenName: tracker.name || tokenName || null,
                ...alert
              }, {
                scope: 'token',
                tokenAddress
              });
            });
          }
          
          // Display live status
          displayStatus(tracker, trends, scores, newAlerts);
          
          // Log critical alerts
          if (newAlerts) {
            newAlerts.forEach(alert => {
              if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
                console.log(`\n${alert.severity === 'CRITICAL' ? '🚨🚨🚨' : '⚠️⚠️⚠️'} ${alert.message} ${alert.severity === 'CRITICAL' ? '🚨🚨🚨' : '⚠️⚠️⚠️'}`);
              }
            });
          }
        } catch (analysisError) {
          console.error('❌ Analysis error:', analysisError.message);
          console.log('📊 Snapshot captured but analysis failed - continuing...');
        }
      } else {
        console.log(`📊 Building trend history... ${tracker.data.dataPoints.length}/2 snapshots for comparison`);
        emitSignalEvent('chartHealth', 'snapshot', {
          tokenAddress,
          tokenName: tracker.name || tokenName || null,
          snapshot: currentSnapshot,
          scores: null,
          trends: {}
        }, {
          scope: 'token',
          tokenAddress
        });
      }
      
      // Save data
      tracker.saveData();
      console.log('💾 Snapshot saved');
      
    } catch (error) {
      console.error('❌ Tracking error:', error.message);
      emitSignalEvent('chartHealth', 'error', {
        message: error instanceof Error ? error.message : String(error)
      }, {
        scope: 'token',
        tokenAddress
      });
    }
    
    // Schedule next snapshot
    console.log(`⏰ Next snapshot in 3 minutes (${new Date(Date.now() + TRACKING_CONFIG.logInterval).toLocaleTimeString()})`);
    setTimeout(trackingLoop, TRACKING_CONFIG.logInterval);
  };
  
  // Start first snapshot immediately
  trackingLoop();
  
  return tracker;
}

// ===== STOP TRACKING =====
export function stopTracking(tracker) {
  if (tracker) {
    tracker.isTracking = false;
    emitSignalEvent('chartHealth', 'status', {
      status: 'stopped',
      running: false
    }, {
      scope: 'token',
      tokenAddress: tracker.tokenAddress
    });
    console.log(`\n⏹️ Stopped real-time tracking ${tracker.tokenAddress}`);
    console.log(`💾 Data saved to: ${tracker.dataFile}`);
  }
}

// ===== EXPORT =====
export { TokenTracker, TRACKING_CONFIG };

// ===== CLI USAGE =====
async function main() {
  const args = process.argv.slice(2);
  
  console.log('🚀 Real-Time Token Health Tracker Starting...');
  
  if (args.length === 0) {
    console.log('\nUsage: node chartHealth.js <token_address> [token_name]');
    console.log('Example: node chartHealth.js z6eiti618XERFhoB9j5FpbJ7sGf5yTjpw4zp7twpump "tinfoil hat cult"');
    console.log('\nTracks REAL-TIME changes in price, liquidity, market cap, volume every 3 minutes');
    console.log('Press Ctrl+C to stop tracking.');
    process.exit(1);
  }
  
  const tokenAddress = args[0];
  const tokenName = args[1] || '';
  
  console.log(`📍 Token Address: ${tokenAddress}`);
  console.log(`🏷️ Token Name: ${tokenName || 'Unknown'}`);
  
  let currentTracker = null;
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n⏹️ Stopping tracker...');
    if (currentTracker) {
      stopTracking(currentTracker);
    }
    process.exit(0);
  });
  
  try {
    currentTracker = await trackToken(tokenAddress, tokenName);
  } catch (error) {
    console.error('❌ Failed to start tracking:', error.message);
    process.exit(1);
  }
}

// Check if running as main module
const currentFile = fileURLToPath(import.meta.url);
const runningFile = process.argv[1];
const isMainModule = currentFile === runningFile;

if (isMainModule) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}
