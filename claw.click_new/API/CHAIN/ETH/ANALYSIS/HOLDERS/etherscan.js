import fetch from 'node-fetch';

/**
 * Ethereum Holder Analysis via Etherscan API
 * Analyzes token holder distribution and concentration risks
 */
export class EtherscanHolderAPI {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.ETHERSCAN_API_KEY;
    this.baseUrl = 'https://api.etherscan.io/api';
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
    
    // Rate limiting for free tier (5 req/sec)
    this.requests = [];
    this.maxRequests = 5;
    this.windowMs = 1000; // 1 second
  }

  /**
   * Get token holder distribution analysis
   * @param {string} tokenAddress - Token contract address
   * @param {number} limit - Number of top holders to analyze
   * @returns {Object} Holder analysis data
   */
  async getHolderAnalysis(tokenAddress, limit = 100) {
    const cacheKey = `holders_${tokenAddress.toLowerCase()}_${limit}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    if (!this.apiKey) {
      return {
        success: false,
        error: 'Etherscan API key required'
      };
    }

    try {
      await this.waitForRateLimit();
      
      const holders = await this.fetchTopHolders(tokenAddress, limit);
      if (!holders.success) {
        return holders;
      }

      const analysis = this.analyzeHolderDistribution(holders.data);
      
      this.cache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now()
      });
      
      return analysis;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch top holders from Etherscan
   * @param {string} tokenAddress - Token address
   * @param {number} limit - Number of holders to fetch
   * @returns {Object} Raw holder data
   */
  async fetchTopHolders(tokenAddress, limit) {
    try {
      const url = `${this.baseUrl}?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=${limit}&apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status !== '1') {
        throw new Error(data.message || 'Etherscan API error');
      }

      if (!data.result || data.result.length === 0) {
        return {
          success: false,
          error: 'No holder data available'
        };
      }

      return {
        success: true,
        data: data.result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Analyze holder distribution for risk assessment
   * @param {Array} holders - Array of holder objects from Etherscan
   * @returns {Object} Comprehensive holder analysis
   */
  analyzeHolderDistribution(holders) {
    if (!holders || holders.length === 0) {
      return {
        success: false,
        error: 'No holder data to analyze'
      };
    }

    // Calculate total supply
    const totalSupply = holders.reduce((sum, holder) => 
      sum + parseFloat(holder.TokenHolderQuantity), 0
    );

    // Calculate concentrations
    const concentrations = this.calculateConcentrations(holders, totalSupply);
    
    // Analyze wallet types
    const walletAnalysis = this.analyzeWalletTypes(holders, totalSupply);
    
    // Assess risks
    const riskAssessment = this.assessConcentrationRisk(concentrations);
    
    // Calculate distribution scores
    const distributionScore = this.calculateDistributionScore(concentrations, holders.length);

    return {
      success: true,
      token_address: holders[0]?.TokenHolderAddress ? 
        this.extractTokenAddress(holders) : 'unknown',
      total_holders: holders.length,
      total_supply: totalSupply,
      
      concentration: concentrations,
      wallet_analysis: walletAnalysis,
      risk_assessment: riskAssessment,
      distribution_score: distributionScore,
      
      recommendations: this.generateRecommendations(riskAssessment, distributionScore),
      timestamp: Date.now()
    };
  }

  /**
   * Calculate holder concentration metrics
   * @param {Array} holders - Holder data
   * @param {number} totalSupply - Total token supply
   * @returns {Object} Concentration metrics
   */
  calculateConcentrations(holders, totalSupply) {
    const top1 = parseFloat(holders[0]?.TokenHolderQuantity || 0) / totalSupply;
    
    const top5Supply = holders.slice(0, Math.min(5, holders.length))
      .reduce((sum, holder) => sum + parseFloat(holder.TokenHolderQuantity), 0);
    const top5 = top5Supply / totalSupply;
    
    const top10Supply = holders.slice(0, Math.min(10, holders.length))
      .reduce((sum, holder) => sum + parseFloat(holder.TokenHolderQuantity), 0);
    const top10 = top10Supply / totalSupply;
    
    const top20Supply = holders.slice(0, Math.min(20, holders.length))
      .reduce((sum, holder) => sum + parseFloat(holder.TokenHolderQuantity), 0);
    const top20 = top20Supply / totalSupply;

    return {
      top_1_holder: {
        percentage: top1,
        formatted: `${(top1 * 100).toFixed(2)}%`,
        address: holders[0]?.TokenHolderAddress
      },
      top_5_holders: {
        percentage: top5,
        formatted: `${(top5 * 100).toFixed(2)}%`
      },
      top_10_holders: {
        percentage: top10,
        formatted: `${(top10 * 100).toFixed(2)}%`
      },
      top_20_holders: {
        percentage: top20,
        formatted: `${(top20 * 100).toFixed(2)}%`
      }
    };
  }

  /**
   * Analyze types of wallets holding the token
   * @param {Array} holders - Holder data
   * @param {number} totalSupply - Total supply
   * @returns {Object} Wallet type analysis
   */
  analyzeWalletTypes(holders, totalSupply) {
    const analysis = {
      likely_deployer: null,
      large_holders: [], // >5%
      whale_holders: [], // >1%
      potential_exchanges: [],
      suspicious_patterns: []
    };

    holders.forEach((holder, index) => {
      const address = holder.TokenHolderAddress;
      const quantity = parseFloat(holder.TokenHolderQuantity);
      const percentage = quantity / totalSupply;

      // Likely deployer (largest holder)
      if (index === 0 && percentage > 0.15) {
        analysis.likely_deployer = {
          address,
          percentage,
          quantity,
          position: 1
        };
      }

      // Large holders (>5%)
      if (percentage > 0.05) {
        analysis.large_holders.push({
          address,
          percentage,
          quantity,
          position: index + 1
        });
      }

      // Whale holders (>1%)
      if (percentage > 0.01 && percentage <= 0.05) {
        analysis.whale_holders.push({
          address,
          percentage,
          quantity,
          position: index + 1
        });
      }

      // Check for known exchange patterns
      if (this.isLikelyExchange(address)) {
        analysis.potential_exchanges.push({
          address,
          percentage,
          exchange_type: 'suspected'
        });
      }

      // Suspicious patterns
      if (this.hasSuspiciousPattern(holder, index, holders)) {
        analysis.suspicious_patterns.push({
          address,
          pattern: 'sequential_addresses',
          note: 'Similar addresses may indicate same entity'
        });
      }
    });

    return analysis;
  }

  /**
   * Assess concentration risk based on distribution
   * @param {Object} concentrations - Concentration metrics
   * @returns {Object} Risk assessment
   */
  assessConcentrationRisk(concentrations) {
    let riskScore = 0;
    const warnings = [];
    const factors = [];

    // Top holder risk
    const top1 = concentrations.top_1_holder.percentage;
    if (top1 > 0.5) {
      riskScore += 5;
      warnings.push('Single holder owns majority of supply');
      factors.push('extreme_concentration');
    } else if (top1 > 0.25) {
      riskScore += 4;
      warnings.push('Single holder owns >25% of supply');
      factors.push('high_concentration');
    } else if (top1 > 0.15) {
      riskScore += 2;
      warnings.push('Single holder owns >15% of supply');
      factors.push('moderate_concentration');
    } else if (top1 > 0.10) {
      riskScore += 1;
      warnings.push('Single holder owns >10% of supply');
    }

    // Top 5 holders risk
    const top5 = concentrations.top_5_holders.percentage;
    if (top5 > 0.80) {
      riskScore += 3;
      warnings.push('Top 5 holders control >80% of supply');
      factors.push('oligopoly_control');
    } else if (top5 > 0.60) {
      riskScore += 2;
      warnings.push('Top 5 holders control >60% of supply');
    }

    // Top 10 holders risk
    const top10 = concentrations.top_10_holders.percentage;
    if (top10 > 0.90) {
      riskScore += 2;
      warnings.push('Top 10 holders control >90% of supply');
      factors.push('extreme_centralization');
    }

    // Risk level determination
    let riskLevel = 'low';
    if (riskScore >= 7) riskLevel = 'critical';
    else if (riskScore >= 5) riskLevel = 'high';
    else if (riskScore >= 3) riskLevel = 'medium';

    return {
      risk_score: riskScore,
      risk_level: riskLevel,
      safe_to_trade: riskScore < 5,
      warnings,
      risk_factors: factors,
      recommendation: this.getRiskRecommendation(riskLevel, riskScore)
    };
  }

  /**
   * Calculate distribution quality score
   * @param {Object} concentrations - Concentration data
   * @param {number} holderCount - Number of holders analyzed
   * @returns {Object} Distribution score
   */
  calculateDistributionScore(concentrations, holderCount) {
    let score = 0;
    
    // Bonus for good distribution
    if (concentrations.top_1_holder.percentage < 0.10) score += 3;
    else if (concentrations.top_1_holder.percentage < 0.20) score += 2;
    else if (concentrations.top_1_holder.percentage < 0.30) score += 1;
    
    if (concentrations.top_5_holders.percentage < 0.50) score += 2;
    else if (concentrations.top_5_holders.percentage < 0.70) score += 1;
    
    if (holderCount > 1000) score += 2;
    else if (holderCount > 500) score += 1;
    
    // Penalty for bad distribution
    if (concentrations.top_1_holder.percentage > 0.50) score -= 3;
    if (concentrations.top_5_holders.percentage > 0.80) score -= 2;

    const finalScore = Math.max(0, Math.min(10, score));
    
    return {
      score: finalScore,
      assessment: finalScore >= 7 ? 'excellent' :
                 finalScore >= 5 ? 'good' :
                 finalScore >= 3 ? 'fair' : 'poor',
      factors: {
        top_holder_distribution: concentrations.top_1_holder.percentage < 0.20 ? 'good' : 'concerning',
        overall_spread: concentrations.top_10_holders.percentage < 0.70 ? 'well_distributed' : 'concentrated',
        holder_count: holderCount > 500 ? 'healthy' : 'limited'
      }
    };
  }

  /**
   * Generate trading recommendations based on analysis
   * @param {Object} riskAssessment - Risk assessment data
   * @param {Object} distributionScore - Distribution score data
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(riskAssessment, distributionScore) {
    const recommendations = [];

    if (!riskAssessment.safe_to_trade) {
      recommendations.push('❌ HIGH RISK: Avoid trading due to extreme concentration');
    } else if (riskAssessment.risk_level === 'medium') {
      recommendations.push('⚠️ MEDIUM RISK: Trade with caution and smaller position sizes');
    } else {
      recommendations.push('✅ LOW RISK: Holder distribution appears healthy for trading');
    }

    if (distributionScore.score >= 7) {
      recommendations.push('📈 Excellent token distribution supports price stability');
    } else if (distributionScore.score < 4) {
      recommendations.push('📉 Poor distribution may lead to high volatility');
    }

    return recommendations;
  }

  /**
   * Get risk-based recommendation
   * @param {string} riskLevel - Risk level
   * @param {number} riskScore - Numeric risk score
   * @returns {string} Recommendation text
   */
  getRiskRecommendation(riskLevel, riskScore) {
    switch (riskLevel) {
      case 'critical':
        return 'Do not trade - extreme concentration risk';
      case 'high':
        return 'Avoid trading or use very small position sizes';
      case 'medium':
        return 'Trade with caution - monitor whale movements';
      case 'low':
        return 'Generally safe to trade with normal position sizes';
      default:
        return 'Insufficient data for recommendation';
    }
  }

  /**
   * Check if address looks like an exchange
   * @param {string} address - Wallet address
   * @returns {boolean} Likely exchange
   */
  isLikelyExchange(address) {
    const knownExchanges = [
      '0x28c6c06298d514db089934071355e5743bf21d60', // Binance Hot Wallet
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 2
      '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Binance 3
      '0xd551234ae421e3bcba99a0da6d736074f22192ff', // Binance 4
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', // Binance
      '0x564286362092d8e7936f0549571a803b203aaced', // Binance
      '0x0681d8db095565fe8a346fa0277bffde9c0edbbf', // Kraken
      '0xe93381fb4c4f14bda253907b18fad305d799241a', // Huobi
      '0xfa52274dd61e1643d2205169732f29114bc240b3'  // Crypto.com
    ];

    return knownExchanges.includes(address.toLowerCase());
  }

  /**
   * Check for suspicious address patterns
   * @param {Object} holder - Holder data
   * @param {number} index - Position in holders array
   * @param {Array} allHolders - All holders
   * @returns {boolean} Has suspicious pattern
   */
  hasSuspiciousPattern(holder, index, allHolders) {
    // Check for similar addresses (may indicate same entity)
    const address = holder.TokenHolderAddress.toLowerCase();
    
    for (let i = 0; i < Math.min(20, allHolders.length); i++) {
      if (i === index) continue;
      
      const otherAddress = allHolders[i].TokenHolderAddress.toLowerCase();
      
      // Check if addresses are very similar (different by only a few characters)
      if (this.addressesSimilar(address, otherAddress)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if two addresses are suspiciously similar
   * @param {string} addr1 - First address
   * @param {string} addr2 - Second address
   * @returns {boolean} Addresses are similar
   */
  addressesSimilar(addr1, addr2) {
    if (addr1 === addr2) return false;
    
    let differences = 0;
    for (let i = 0; i < Math.min(addr1.length, addr2.length); i++) {
      if (addr1[i] !== addr2[i]) differences++;
    }
    
    // Consider similar if less than 4 character differences
    return differences < 4;
  }

  /**
   * Extract token address from holder data
   * @param {Array} holders - Holder data
   * @returns {string} Token address
   */
  extractTokenAddress(holders) {
    // This would need to be determined from the API call context
    // For now, return placeholder
    return 'extracted_from_api_call';
  }

  /**
   * Wait for rate limit compliance
   */
  async waitForRateLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.requests[0]);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForRateLimit();
    }
    
    this.requests.push(now);
  }

  clearCache() {
    this.cache.clear();
  }

  getRemainingRequests() {
    const now = Date.now();
    const recentRequests = this.requests.filter(time => now - time < this.windowMs);
    return this.maxRequests - recentRequests.length;
  }
}

export default EtherscanHolderAPI;