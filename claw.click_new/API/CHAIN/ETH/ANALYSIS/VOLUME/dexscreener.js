import fetch from 'node-fetch';

/**
 * DexScreener Volume Analysis API
 * Returns volume data and analysis for tokens
 */
export class DexScreenerVolumeAPI {
  constructor() {
    this.baseUrl = 'https://api.dexscreener.com/latest';
    this.cache = new Map();
    this.cacheTTL = 30000; // 30 seconds
  }

  /**
   * Get volume data for a token
   * @param {string} address - Token contract address
   * @param {string} chainId - Chain identifier (ethereum, bsc, etc)
   * @returns {Object} Volume analysis data
   */
  async getVolumeData(address, chainId = 'ethereum') {
    const cacheKey = `volume_${chainId}_${address.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      const response = await fetch(`${this.baseUrl}/dex/tokens/${address}`);
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      
      const data = await response.json();
      const analysis = this.analyzeVolumeData(data, chainId);
      
      this.cache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now()
      });
      
      return analysis;
    } catch (error) {
      return { error: error.message, success: false };
    }
  }

  /**
   * Analyze volume data from DexScreener response
   * @param {Object} data - Raw DexScreener response
   * @param {string} chainId - Target chain
   * @returns {Object} Analyzed volume data
   */
  analyzeVolumeData(data, chainId) {
    if (!data.pairs || data.pairs.length === 0) {
      return { error: 'No pairs found', success: false };
    }

    // Filter pairs for target chain and find best one
    const chainPairs = data.pairs.filter(pair => pair.chainId === chainId);
    if (chainPairs.length === 0) {
      return { error: `No pairs found for chain ${chainId}`, success: false };
    }

    const bestPair = chainPairs.reduce((best, current) => {
      const bestLiq = parseFloat(best.liquidity?.usd || 0);
      const currentLiq = parseFloat(current.liquidity?.usd || 0);
      return currentLiq > bestLiq ? current : best;
    });

    return {
      success: true,
      address: data.pairs[0].baseToken.address,
      chainId,
      pair: bestPair.pairAddress,
      dex: bestPair.dexId,
      volume: this.extractVolumeMetrics(bestPair),
      trading: this.extractTradingMetrics(bestPair),
      quality: this.calculateQualityScore(bestPair),
      timestamp: Date.now()
    };
  }

  /**
   * Extract volume metrics from pair data
   * @param {Object} pair - Pair data from DexScreener
   * @returns {Object} Volume metrics
   */
  extractVolumeMetrics(pair) {
    const vol = pair.volume || {};
    
    return {
      m5: parseFloat(vol.m5 || 0),
      h1: parseFloat(vol.h1 || 0),
      h6: parseFloat(vol.h6 || 0),
      h24: parseFloat(vol.h24 || 0),
      acceleration: {
        m5: this.calculateAcceleration(vol.m5, vol.h1, 12), // 5min * 12 = 1h
        h1: this.calculateAcceleration(vol.h1, vol.h6, 6),  // 6h / 6 = 1h
        h6: this.calculateAcceleration(vol.h6, vol.h24, 4)  // 24h / 4 = 6h
      }
    };
  }

  /**
   * Extract trading metrics from pair data
   * @param {Object} pair - Pair data from DexScreener
   * @returns {Object} Trading metrics
   */
  extractTradingMetrics(pair) {
    const txns = pair.txns || {};
    const txns1h = txns.h1 || {};
    
    const buys = parseInt(txns1h.buys || 0);
    const sells = parseInt(txns1h.sells || 0);
    const total = buys + sells;
    
    return {
      buys_1h: buys,
      sells_1h: sells,
      total_1h: total,
      buy_pressure: total > 0 ? buys / total : 0,
      avg_trade_size: total > 0 && pair.volume?.h1 > 0 ? 
        parseFloat(pair.volume.h1) / total : 0,
      makers: parseInt(pair.makers || 0)
    };
  }

  /**
   * Calculate volume quality score
   * @param {Object} pair - Pair data
   * @returns {Object} Quality assessment
   */
  calculateQualityScore(pair) {
    let score = 0;
    const vol = pair.volume || {};
    const txns = pair.txns?.h1 || {};
    const liquidity = parseFloat(pair.liquidity?.usd || 0);
    const makers = parseInt(pair.makers || 0);
    
    const total_txns = (parseInt(txns.buys || 0) + parseInt(txns.sells || 0));
    const avg_trade_size = total_txns > 0 && vol.h1 > 0 ? vol.h1 / total_txns : 0;
    const volume_to_liquidity = liquidity > 0 ? vol.h24 / liquidity : 0;
    
    // Positive indicators
    if (avg_trade_size > 50 && avg_trade_size < 10000) score += 2;
    if (volume_to_liquidity > 0.5 && volume_to_liquidity < 50) score += 2;
    if (liquidity > 10000) score += 2;
    if (makers > 50) score += 2;
    if (total_txns > 20) score += 1;
    
    // Negative indicators
    if (avg_trade_size < 10) score -= 1; // Dust trading
    if (volume_to_liquidity > 100) score -= 2; // Wash trading
    if (total_txns > 500) score -= 1; // Bot activity
    
    const finalScore = Math.max(0, Math.min(10, score));
    
    return {
      score: finalScore,
      assessment: finalScore >= 7 ? 'high' : 
                 finalScore >= 4 ? 'medium' : 'low',
      metrics: {
        avg_trade_size,
        volume_to_liquidity_ratio: volume_to_liquidity,
        makers,
        liquidity_usd: liquidity
      }
    };
  }

  /**
   * Calculate acceleration between time periods
   * @param {number} current - Current period volume
   * @param {number} reference - Reference period volume  
   * @param {number} multiplier - Time multiplier
   * @returns {number} Acceleration ratio
   */
  calculateAcceleration(current, reference, multiplier) {
    if (!current || !reference) return 0;
    const normalizedReference = reference / multiplier;
    return normalizedReference > 0 ? current / normalizedReference : 0;
  }

  /**
   * Check if volume shows strong momentum
   * @param {Object} volumeData - Volume data from getVolumeData
   * @returns {Object} Momentum assessment
   */
  assessMomentum(volumeData) {
    if (!volumeData.success) {
      return { momentum: 'unknown', reason: volumeData.error };
    }

    const { volume, trading, quality } = volumeData;
    
    // Strong momentum criteria
    if (volume.acceleration.m5 > 3 && 
        trading.buy_pressure > 0.7 && 
        quality.score >= 6) {
      return { momentum: 'strong', confidence: 85 };
    }
    
    // Moderate momentum
    if (volume.acceleration.h1 > 2 && 
        trading.buy_pressure > 0.6 && 
        quality.score >= 4) {
      return { momentum: 'moderate', confidence: 65 };
    }
    
    // Weak/negative
    if (trading.buy_pressure < 0.4 || quality.score < 3) {
      return { momentum: 'weak', confidence: 70 };
    }
    
    return { momentum: 'neutral', confidence: 50 };
  }

  clearCache() {
    this.cache.clear();
  }
}

// Export default instance
export default new DexScreenerVolumeAPI();