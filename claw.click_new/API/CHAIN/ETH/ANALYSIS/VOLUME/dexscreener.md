# DexScreener API - Volume Analysis
**Status: FREE** 🆓 (with rate limits)

## API Documentation
**Base URL**: `https://api.dexscreener.com/latest`
**Rate Limit**: No official limit, but be respectful (~1 req/sec)
**Docs**: https://docs.dexscreener.com/api/reference

## Token Pairs Endpoint
```bash
GET https://api.dexscreener.com/latest/dex/tokens/{token_address}
```

### Example Response
```json
{
  "pairs": [
    {
      "chainId": "ethereum",
      "dexId": "uniswap",
      "url": "https://dexscreener.com/ethereum/0x...",
      "pairAddress": "0x...",
      "baseToken": {
        "address": "0x...",
        "name": "Based Token",
        "symbol": "BASED"
      },
      "quoteToken": {
        "address": "0xA0b86a33E6441c8E81543100C9E01b49f71B08B2",
        "name": "WETH",
        "symbol": "WETH"
      },
      "priceNative": "0.00001234",
      "priceUsd": "0.0456",
      "liquidity": {
        "usd": 125430.50,
        "base": 5500000,
        "quote": 45.67
      },
      "volume": {
        "m5": 1250.30,
        "h1": 15640.80, 
        "h6": 89560.20,
        "h24": 456780.90
      },
      "priceChange": {
        "m5": 15.45,
        "h1": 34.67,
        "h6": 125.89,
        "h24": 267.45
      },
      "txns": {
        "m5": {
          "buys": 12,
          "sells": 8
        },
        "h1": {
          "buys": 145,
          "sells": 97
        },
        "h6": {
          "buys": 567,
          "sells": 412  
        },
        "h24": {
          "buys": 2340,
          "sells": 1890
        }
      },
      "makers": 156,
      "pairCreatedAt": 1678901234000
    }
  ]
}
```

## Volume Analysis Functions
```javascript
class DexScreenerAnalyzer {
  constructor() {
    this.baseUrl = 'https://api.dexscreener.com/latest';
    this.cache = new Map();
    this.cacheTTL = 30000; // 30 seconds
  }

  async getTokenData(address) {
    // Check cache first
    const cached = this.cache.get(address);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const response = await fetch(`${this.baseUrl}/dex/tokens/${address}`);
    const data = await response.json();
    
    // Cache result
    this.cache.set(address, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  }

  // Find best pair (highest liquidity)
  findBestPair(tokenData, preferredQuotes = ['WETH', 'USDC', 'USDT']) {
    if (!tokenData.pairs || tokenData.pairs.length === 0) return null;
    
    // Filter by preferred quote tokens
    let candidates = tokenData.pairs.filter(pair => 
      preferredQuotes.includes(pair.quoteToken.symbol)
    );
    
    if (candidates.length === 0) {
      candidates = tokenData.pairs;
    }
    
    // Sort by liquidity
    return candidates.sort((a, b) => 
      parseFloat(b.liquidity.usd) - parseFloat(a.liquidity.usd)
    )[0];
  }

  // Volume acceleration analysis
  analyzeVolumeAcceleration(pair) {
    const vol = pair.volume;
    
    return {
      acceleration_5m: vol.m5 > 0 ? vol.h1 / (vol.m5 * 12) : 0, // 5m * 12 = 1h
      acceleration_1h: vol.h1 > 0 ? vol.h6 / vol.h1 : 0,
      acceleration_6h: vol.h6 > 0 ? vol.h24 / (vol.h6 * 4) : 0,
      
      trend_strength: this.calculateTrendStrength(vol),
      volume_quality: this.assessVolumeQuality(pair)
    };
  }

  // Buy pressure analysis
  analyzeBuyPressure(pair) {
    const txns = pair.txns;
    
    const buyPressure_5m = txns.m5.buys / (txns.m5.buys + txns.m5.sells);
    const buyPressure_1h = txns.h1.buys / (txns.h1.buys + txns.h1.sells);
    const buyPressure_6h = txns.h6.buys / (txns.h6.buys + txns.h6.sells);
    const buyPressure_24h = txns.h24.buys / (txns.h24.buys + txns.h24.sells);
    
    return {
      buy_pressure_5m: buyPressure_5m,
      buy_pressure_1h: buyPressure_1h,
      buy_pressure_6h: buyPressure_6h,
      buy_pressure_24h: buyPressure_24h,
      
      pressure_trend: buyPressure_1h > buyPressure_6h ? 'increasing' : 'decreasing',
      pressure_strength: buyPressure_1h > 0.7 ? 'strong' : 
                        buyPressure_1h > 0.6 ? 'moderate' : 'weak'
    };
  }

  // Volume quality assessment
  assessVolumeQuality(pair) {
    const vol = pair.volume;
    const txns = pair.txns;
    const liquidity = parseFloat(pair.liquidity.usd);
    
    // Average trade size
    const avgTradeSize_1h = vol.h1 / (txns.h1.buys + txns.h1.sells);
    
    // Volume to liquidity ratio
    const volumeToLiquidityRatio = vol.h24 / liquidity;
    
    // Transaction velocity
    const txnVelocity = (txns.h1.buys + txns.h1.sells) / 60; // per minute
    
    let qualityScore = 0;
    
    // Good indicators
    if (avgTradeSize_1h > 50 && avgTradeSize_1h < 10000) qualityScore += 2;
    if (volumeToLiquidityRatio > 0.5 && volumeToLiquidityRatio < 50) qualityScore += 2;
    if (txnVelocity > 0.5 && txnVelocity < 10) qualityScore += 2;
    if (liquidity > 10000) qualityScore += 2;
    if (pair.makers > 50) qualityScore += 2;
    
    // Bad indicators  
    if (avgTradeSize_1h < 10) qualityScore -= 1; // Dust trades
    if (volumeToLiquidityRatio > 100) qualityScore -= 2; // Possible wash trading
    if (txnVelocity > 20) qualityScore -= 1; // Too fast, bot activity
    
    return Math.max(0, Math.min(10, qualityScore));
  }

  // Calculate trend strength
  calculateTrendStrength(volume) {
    const shortTerm = volume.h1;
    const mediumTerm = volume.h6 / 6;
    const longTerm = volume.h24 / 24;
    
    if (shortTerm > mediumTerm * 2 && mediumTerm > longTerm * 1.5) {
      return 'explosive';
    } else if (shortTerm > mediumTerm * 1.5) {
      return 'strong';
    } else if (shortTerm > mediumTerm) {
      return 'moderate';
    } else {
      return 'weak';
    }
  }

  // Complete token analysis
  async analyzeToken(address) {
    const data = await this.getTokenData(address);
    const bestPair = this.findBestPair(data);
    
    if (!bestPair) {
      return { error: 'No suitable pair found' };
    }
    
    return {
      pair: bestPair,
      volume_analysis: this.analyzeVolumeAcceleration(bestPair),
      buy_pressure: this.analyzeBuyPressure(bestPair),
      liquidity_usd: parseFloat(bestPair.liquidity.usd),
      age_hours: (Date.now() - bestPair.pairCreatedAt) / (1000 * 60 * 60),
      makers_count: bestPair.makers,
      dex: bestPair.dexId,
      price_change_1h: parseFloat(bestPair.priceChange.h1)
    };
  }
}
```

## Usage Example
```javascript
const analyzer = new DexScreenerAnalyzer();

const tokenAnalysis = await analyzer.analyzeToken('0x...');

if (tokenAnalysis.volume_analysis.acceleration_5m > 3 && 
    tokenAnalysis.buy_pressure.buy_pressure_1h > 0.7 &&
    tokenAnalysis.volume_analysis.volume_quality > 5) {
  // Good entry signal!
  console.log('Strong volume breakout detected');
}
```

**Free API with comprehensive volume data - perfect for our needs!**