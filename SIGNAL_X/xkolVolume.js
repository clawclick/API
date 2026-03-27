// xkolVolume.js - KOL Post Volume Spike Detector
// Phase 1: Extract CA + timestamp from tweet
// Phase 2: Fetch price history and calculate metrics

const API_BASE = "https://api.claw.click";
const API_KEY = process.env.CLAW_API_KEY || "demo";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "AAAAAAAAAAAAAAAAAAAAAFH98QEAAAAA5O%2FVeBs9YNeDp4Lj%2FP6qcVeKIvw%3DY792IJw0gVOvmauYWIfpftHrBc8b7D0ehSoz22dic4LKgpZJDA";

const CONFIG = {
  timeWindowMinutes: 60,
};

// ===== EXTRACT TWEET ID FROM URL =====
function extractTweetId(tweetUrl) {
  const match = tweetUrl.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

// ===== EXTRACT CA FROM TWEET VIA TWITTER API V2 =====
async function extractFromTweet(tweetUrl) {
  console.log(`\n🔗 Fetching tweet: ${tweetUrl}`);
  
  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) {
    console.log("⚠️ Could not extract tweet ID from URL");
    return null;
  }
  
  try {
    // Query Twitter API v2 for tweet details
    const twitterUrl = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username`;
    
    const res = await fetch(twitterUrl, {
      headers: {
        "Authorization": `Bearer ${X_BEARER_TOKEN}`,
        "User-Agent": "xkolVolume/1.0"
      }
    });
    
    if (!res.ok) {
      console.log(`⚠️ Twitter API returned ${res.status}`);
      if (res.status === 401) {
        console.log("   ℹ️ Bearer token may be expired or invalid");
      }
      return null;
    }
    
    const data = await res.json();
    
    if (!data.data) {
      console.log("⚠️ Tweet not found");
      return null;
    }
    
    const tweet = data.data;
    const publishTime = new Date(tweet.created_at);
    const postTimestamp = Math.floor(publishTime.getTime() / 1000);
    const tweetText = tweet.text;
    
    console.log(`📅 Post time: ${publishTime.toLocaleString()} (Unix: ${postTimestamp})`);
    console.log(`📝 Text: ${tweetText.substring(0, 120)}${tweetText.length > 120 ? '...' : ''}`);
    
    // Extract contract addresses from tweet text (0x... pattern)
    const caMatches = tweetText.match(/0x[a-fA-F0-9]{40}/g);
    const uniqueCAs = [...new Set(caMatches || [])];
    
    if (uniqueCAs.length === 0) {
      console.log("⚠️ No contract address found in tweet");
      return null;
    }
    
    console.log(`\n📋 Found ${uniqueCAs.length} contract address(es):`);
    uniqueCAs.forEach((ca, i) => {
      console.log(`   ${i + 1}. ${ca}`);
    });
    
    return {
      postTimestamp: postTimestamp,
      postTime: publishTime,
      contractAddresses: uniqueCAs,
      primaryCA: uniqueCAs[0],
      tweetText: tweetText,
      tweetId: tweetId
    };
    
  } catch (error) {
    console.error("❌ Error fetching tweet:", error.message);
    return null;
  }
}

// ===== FETCH PRICE HISTORY =====
async function fetchPriceHistory(chain, tokenAddress, limit = "7d", interval = "1h") {
  const params = new URLSearchParams({
    chain: chain.toLowerCase(),
    tokenAddress: tokenAddress,
    interval: interval,
    limit: limit
  });
  
  const url = `${API_BASE}/tokenPriceHistory?${params.toString()}`;
  
  try {
    console.log(`\n📡 Fetching price history for ${chain.toUpperCase()} / ${tokenAddress.slice(0, 10)}...`);
    
    const res = await fetch(url, {
      headers: { "x-api-key": API_KEY }
    });
    
    if (!res.ok) {
      console.log(`⚠️ API returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    return data.points || [];
    
  } catch (error) {
    console.error("❌ Fetch error:", error.message);
    return null;
  }
}

// ===== GET TOKEN METADATA =====
async function getTokenMetadata(chain, tokenAddress) {
  const params = new URLSearchParams({
    chain: chain.toLowerCase(),
    tokenAddress: tokenAddress
  });
  
  const url = `${API_BASE}/tokenPoolInfo?${params.toString()}`;
  
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": API_KEY }
    });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    return {
      symbol: data.symbol || "?",
      name: data.name || "Unknown",
      currentPrice: data.priceUsd || 0,
      marketCap: data.marketCapUsd || 0,
      liquidity: data.liquidityUsd || 0,
      pairAddress: data.pairAddress,
      dex: data.dex
    };
    
  } catch (error) {
    return null;
  }
}

// ===== CALCULATE KOL IMPACT =====
async function analyzeKolPostImpact(tweetUrl, chain = "base") {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`KOL POST VOLUME SPIKE ANALYZER`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  
  // Phase 1: Extract CA + timestamp
  const tweetData = await extractFromTweet(tweetUrl);
  if (!tweetData) {
    console.log("❌ Could not extract data from tweet\n");
    return null;
  }
  
  const { postTimestamp, postTime, primaryCA } = tweetData;
  
  // Get token metadata
  console.log(`\n📊 Fetching token metadata...`);
  const metadata = await getTokenMetadata(chain, primaryCA);
  
  if (metadata && metadata.currentPrice > 0) {
    console.log(`✅ Token: ${metadata.name} (${metadata.symbol})`);
    console.log(`   Price: $${metadata.currentPrice.toFixed(8)}`);
    console.log(`   Market Cap: $${(metadata.marketCap / 1000000).toFixed(2)}M`);
    console.log(`   Liquidity: $${(metadata.liquidity / 1000000).toFixed(2)}M`);
    if (metadata.dex) console.log(`   DEX: ${metadata.dex}`);
  } else {
    console.log(`⚠️ No metadata available (token may not be indexed yet)`);
  }
  
  // Phase 2: Fetch price history
  const candles = await fetchPriceHistory(chain, primaryCA);
  
  if (!candles || candles.length === 0) {
    console.log(`\n⚠️ No price history available\n`);
    return {
      tweetUrl,
      postTimestamp,
      postTime: postTime.toLocaleString(),
      contractAddress: primaryCA,
      chain,
      error: "No price history"
    };
  }
  
  console.log(`✅ Loaded ${candles.length} candles\n`);
  
  // Calculate time windows (convert post timestamp to ms for comparison)
  const postTimeMs = postTimestamp * 1000;
  const windowMs = CONFIG.timeWindowMinutes * 60 * 1000;
  const beforeStart = postTimeMs - windowMs;
  const afterEnd = postTimeMs + windowMs;
  
  console.log(`📊 TIME WINDOWS:`);
  console.log(`   Post time: ${postTime.toLocaleString()}`);
  console.log(`   Before window: ${new Date(beforeStart).toLocaleString()} to ${postTime.toLocaleString()}`);
  console.log(`   After window: ${postTime.toLocaleString()} to ${new Date(afterEnd).toLocaleString()}\n`);
  
  // Split candles by window
  const beforeCandles = candles.filter(c => c.timestamp >= beforeStart && c.timestamp < postTimeMs);
  const afterCandles = candles.filter(c => c.timestamp >= postTimeMs && c.timestamp <= afterEnd);
  
  console.log(`📈 DATA POINTS:`);
  console.log(`   Before candles: ${beforeCandles.length}`);
  console.log(`   After candles: ${afterCandles.length}`);
  
  if (beforeCandles.length === 0 || afterCandles.length === 0) {
    console.log(`\n⚠️ Insufficient data around post timestamp\n`);
    return {
      tweetUrl,
      postTimestamp,
      postTime: postTime.toLocaleString(),
      contractAddress: primaryCA,
      chain,
      error: "Insufficient data",
      beforeCount: beforeCandles.length,
      afterCount: afterCandles.length
    };
  }
  
  // Calculate metrics
  const beforeVolume = beforeCandles.reduce((s, c) => s + (c.volume || 0), 0);
  const afterVolume = afterCandles.reduce((s, c) => s + (c.volume || 0), 0);
  const volumeDiff = afterVolume - beforeVolume;
  const volumeDiffPct = beforeVolume > 0 ? (volumeDiff / beforeVolume * 100) : 0;
  
  // Price metrics
  const priceBeforePost = beforeCandles[beforeCandles.length - 1]?.close || 0;
  const priceAtPost = afterCandles[0]?.open || priceBeforePost;
  const priceAfterPost = afterCandles[afterCandles.length - 1]?.close || priceAtPost;
  const athAfterPost = Math.max(...afterCandles.map(c => c.high || 0));
  
  const priceChangeFromPost = ((priceAfterPost - priceAtPost) / priceAtPost * 100);
  const athChangeFromPost = ((athAfterPost - priceAtPost) / priceAtPost * 100);
  
  console.log(`\n💰 VOLUME METRICS:`);
  console.log(`   Before: $${beforeVolume.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
  console.log(`   After:  $${afterVolume.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
  console.log(`   Change: $${volumeDiff.toLocaleString('en-US', {maximumFractionDigits: 0})} (${volumeDiffPct.toFixed(1)}%)\n`);
  
  console.log(`💹 PRICE METRICS:`);
  console.log(`   Price before post: $${priceBeforePost.toFixed(8)}`);
  console.log(`   Price at post: $${priceAtPost.toFixed(8)}`);
  console.log(`   Price after post: $${priceAfterPost.toFixed(8)}`);
  console.log(`   ATH in period: $${athAfterPost.toFixed(8)}`);
  console.log(`   Price change: ${priceChangeFromPost.toFixed(2)}%`);
  console.log(`   ATH from post: ${athChangeFromPost.toFixed(2)}%\n`);
  
  console.log(`═══════════════════════════════════════════════════════════════\n`);
  
  return {
    success: true,
    tweetUrl,
    postTimestamp,
    postTime: postTime.toLocaleString(),
    contractAddress: primaryCA,
    chain,
    tokenName: metadata?.name || "Unknown",
    tokenSymbol: metadata?.symbol || "?",
    volumeBefore: beforeVolume,
    volumeAfter: afterVolume,
    volumeDiff: volumeDiff,
    volumeDiffPct: volumeDiffPct.toFixed(1),
    priceBeforePost: priceBeforePost.toFixed(8),
    priceAtPost: priceAtPost.toFixed(8),
    priceAfterPost: priceAfterPost.toFixed(8),
    athAfterPost: athAfterPost.toFixed(8),
    priceChange: priceChangeFromPost.toFixed(2),
    athChange: athChangeFromPost.toFixed(2)
  };
}

// ===== MAIN =====
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`\n🚀 KOL Post Volume Impact Detector`);
    console.log(`\nUsage: node xkolVolume.js <tweet_url> [chain]`);
    console.log(`\nExample:`);
    console.log(`  node xkolVolume.js "https://x.com/GemsofRa/status/2033569275579937003" base`);
    console.log(`\nChains: eth, base, bsc, sol (default: base)`);
    console.log(`Env: CLAW_API_KEY=your_key\n`);
    process.exit(0);
  }
  
  const tweetUrl = args[0];
  const chain = args[1] || "base";
  
  const result = await analyzeKolPostImpact(tweetUrl, chain);
}

if (process.argv[1].endsWith('xkolVolume.js')) {
  main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeKolPostImpact, extractFromTweet, fetchPriceHistory };
}
