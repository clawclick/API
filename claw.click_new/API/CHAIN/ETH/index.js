/**
 * Ethereum API Index - Complete trading intelligence stack
 * Combines volume, security, DEX routing, gas tracking, and holder analysis
 */

// Import all API modules
import DexScreenerVolumeAPI from './ANALYSIS/VOLUME/dexscreener.js';
import GoPlusSecurityAPI from './AUDIT/GOPLUS_SECURITY/goplus.js';
import UniswapV2RouterAPI, { UNISWAP_V2_CONFIGS } from './DEX/UNISWAP_V2/router.js';
import EthereumGasTracker from './GAS_FEED/gas-tracker.js';
import EthereumRPCManager from './RPC/provider.js';
import EtherscanHolderAPI from './ANALYSIS/HOLDERS/etherscan.js';

/**
 * Complete Ethereum Trading API
 * One-stop interface for all token analysis and trading functions
 */
export class EthereumTradingAPI {
  constructor(config = {}) {
    // Initialize RPC provider first
    this.rpcManager = new EthereumRPCManager({
      alchemyApiKey: config.alchemyApiKey || process.env.ALCHEMY_API_KEY,
      infuraApiKey: config.infuraApiKey || process.env.INFURA_API_KEY,
      etherscanApiKey: config.etherscanApiKey || process.env.ETHERSCAN_API_KEY
    });

    // Initialize all API modules
    this.volume = new DexScreenerVolumeAPI();
    this.security = new GoPlusSecurityAPI(config.goPlusApiKey);
    this.holders = new EtherscanHolderAPI(config.etherscanApiKey);
    this.gas = new EthereumGasTracker(this.rpcManager.getDirectProvider());
    this.dex = new UniswapV2RouterAPI(
      this.rpcManager.getDirectProvider(), 
      UNISWAP_V2_CONFIGS.ethereum
    );

    // Configuration
    this.config = {
      defaultChain: 'ethereum',
      safetyRequired: true,
      minSafetyScore: 6,
      minVolumeQuality: 4,
      maxGasPercentage: 5,
      ...config
    };
  }

  /**
   * Complete token analysis - all data sources
   * @param {string} address - Token contract address
   * @param {Object} options - Analysis options
   * @returns {Object} Complete analysis
   */
  async analyzeToken(address, options = {}) {
    try {
      console.log(`🔍 Analyzing token: ${address}`);
      
      // Run all analysis in parallel for speed
      const [volumeResult, securityResult, holdersResult] = await Promise.allSettled([
        this.volume.getVolumeData(address, options.chainId || 'ethereum'),
        this.security.checkTokenSecurity(address, '1'),
        this.holders.getHolderAnalysis(address, options.holderLimit || 100)
      ]);

      // Extract results (successful or failed)
      const volume = volumeResult.status === 'fulfilled' ? volumeResult.value : 
        { success: false, error: volumeResult.reason?.message || 'Volume analysis failed' };
        
      const security = securityResult.status === 'fulfilled' ? securityResult.value :
        { success: false, error: securityResult.reason?.message || 'Security check failed' };
        
      const holders = holdersResult.status === 'fulfilled' ? holdersResult.value :
        { success: false, error: holdersResult.reason?.message || 'Holder analysis failed' };

      // Generate overall assessment
      const assessment = this.generateOverallAssessment(volume, security, holders);

      return {
        success: true,
        address,
        timestamp: Date.now(),
        analysis: {
          volume,
          security,
          holders
        },
        assessment,
        metadata: {
          analysisDuration: Date.now() - assessment.startTime,
          sourcesUsed: [
            volume.success ? 'dexscreener' : null,
            security.success ? 'goplus' : null,
            holders.success ? 'etherscan' : null
          ].filter(Boolean)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Analysis failed: ${error.message}`,
        address
      };
    }
  }

  /**
   * Generate trading signal with confidence scoring
   * @param {string} address - Token address
   * @param {Object} options - Signal options
   * @returns {Object} Trading signal
   */
  async getTradingSignal(address, options = {}) {
    try {
      const analysis = await this.analyzeToken(address, options);
      
      if (!analysis.success) {
        return {
          signal: 'error',
          confidence: 0,
          reason: analysis.error,
          address
        };
      }

      const { volume, security, holders } = analysis.analysis;
      
      // Safety check (mandatory)
      if (this.config.safetyRequired && security.success && !security.safe) {
        return {
          signal: 'avoid',
          confidence: 95,
          reason: 'Failed safety checks',
          warnings: security.warnings,
          address
        };
      }

      // Calculate signal based on all factors
      const signal = this.calculateTradingSignal(volume, security, holders);

      return {
        ...signal,
        address,
        timestamp: Date.now(),
        analysis_summary: {
          volume_quality: volume.success ? volume.quality?.score : 'unavailable',
          safety_score: security.success ? security.score : 'unavailable', 
          holder_risk: holders.success ? holders.risk_assessment?.risk_level : 'unavailable'
        }
      };
    } catch (error) {
      return {
        signal: 'error',
        confidence: 0,
        reason: error.message,
        address
      };
    }
  }

  /**
   * Get trading quote with safety verification
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address  
   * @param {string} amountIn - Amount to swap
   * @param {Object} options - Quote options
   * @returns {Object} Quote with safety data
   */
  async getTradingQuote(tokenIn, tokenOut, amountIn, options = {}) {
    try {
      // Get basic quote
      const quote = await this.dex.getQuote(tokenIn, tokenOut, amountIn);
      
      if (!quote.success) {
        return quote;
      }

      // Add gas cost analysis
      const gasData = await this.gas.getCurrentGasPrices();
      const gasCostAcceptable = await this.gas.isGasCostAcceptable(
        quote.gasEstimate,
        parseFloat(amountIn), // Trade value in ETH
        options.maxGasPercentage || this.config.maxGasPercentage
      );

      // Safety check for output token (optional)
      let outputSafety = null;
      if (options.checkSafety && tokenOut !== UNISWAP_V2_CONFIGS.ethereum.weth) {
        outputSafety = await this.security.checkTokenSecurity(tokenOut, '1');
      }

      return {
        ...quote,
        gas_analysis: {
          current_prices: gasData.success ? gasData.prices : null,
          cost_acceptable: gasCostAcceptable.success ? gasCostAcceptable.acceptable : null,
          gas_percentage: gasCostAcceptable.success ? gasCostAcceptable.gasPercentage : null
        },
        safety_check: outputSafety,
        execution_ready: quote.success && 
          (gasCostAcceptable.success ? gasCostAcceptable.acceptable : true) &&
          (outputSafety ? outputSafety.safe : true)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Monitor token for trading opportunities
   * @param {string} address - Token to monitor
   * @param {Object} criteria - Monitoring criteria
   * @param {Function} callback - Callback when criteria met
   * @returns {Function} Stop monitoring function
   */
  startTokenMonitoring(address, criteria, callback) {
    let isActive = true;
    
    const check = async () => {
      if (!isActive) return;
      
      try {
        const signal = await this.getTradingSignal(address);
        
        const meetsCriteria = this.checkMonitoringCriteria(signal, criteria);
        
        if (meetsCriteria.meets) {
          callback({
            address,
            signal,
            criteria_met: meetsCriteria.reasons,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('Monitoring error:', error);
      }
      
      // Schedule next check
      if (isActive) {
        setTimeout(check, criteria.interval || 30000); // 30 seconds default
      }
    };
    
    // Start monitoring
    check();
    
    // Return stop function
    return () => {
      isActive = false;
    };
  }

  /**
   * Get network status and health
   * @returns {Object} Network status
   */
  async getNetworkStatus() {
    try {
      const [networkInfo, gasData, providerHealth] = await Promise.allSettled([
        this.rpcManager.getNetworkInfo(),
        this.gas.getCurrentGasPrices(),
        this.rpcManager.getProvidersHealth()
      ]);

      return {
        success: true,
        network: networkInfo.status === 'fulfilled' ? networkInfo.value : null,
        gas: gasData.status === 'fulfilled' ? gasData.value : null,
        providers: providerHealth.status === 'fulfilled' ? providerHealth.value : null,
        trading_conditions: this.assessTradingConditions(gasData.value)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate overall assessment from all analysis
   * @param {Object} volume - Volume analysis
   * @param {Object} security - Security analysis  
   * @param {Object} holders - Holder analysis
   * @returns {Object} Overall assessment
   */
  generateOverallAssessment(volume, security, holders) {
    const assessment = {
      startTime: Date.now(),
      overall_score: 0,
      risk_level: 'unknown',
      tradeable: false,
      confidence: 0,
      factors: {
        positive: [],
        negative: [],
        neutral: []
      }
    };

    let totalWeight = 0;
    let weightedScore = 0;

    // Security assessment (40% weight)
    if (security.success) {
      const securityWeight = 40;
      totalWeight += securityWeight;
      weightedScore += security.score * securityWeight;
      
      if (security.safe) {
        assessment.factors.positive.push('Security checks passed');
      } else {
        assessment.factors.negative.push('Failed security checks');
      }
    }

    // Volume quality (35% weight) 
    if (volume.success && volume.quality) {
      const volumeWeight = 35;
      totalWeight += volumeWeight;
      weightedScore += volume.quality.score * volumeWeight;
      
      if (volume.quality.score >= 7) {
        assessment.factors.positive.push('High volume quality');
      } else if (volume.quality.score < 4) {
        assessment.factors.negative.push('Poor volume quality');
      }
    }

    // Holder distribution (25% weight)
    if (holders.success && holders.risk_assessment) {
      const holderWeight = 25;
      totalWeight += holderWeight;
      const holderScore = holders.risk_assessment.safe_to_trade ? 8 : 
        holders.risk_assessment.risk_level === 'medium' ? 5 : 2;
      weightedScore += holderScore * holderWeight;
      
      if (holders.risk_assessment.safe_to_trade) {
        assessment.factors.positive.push('Healthy holder distribution');
      } else {
        assessment.factors.negative.push('Risky holder concentration');
      }
    }

    // Calculate final scores
    if (totalWeight > 0) {
      assessment.overall_score = Math.round(weightedScore / totalWeight);
      assessment.confidence = Math.min(100, (totalWeight / 100) * 100);
    }

    // Determine risk level and tradeability
    if (assessment.overall_score >= 7) {
      assessment.risk_level = 'low';
      assessment.tradeable = true;
    } else if (assessment.overall_score >= 5) {
      assessment.risk_level = 'medium';
      assessment.tradeable = !security.success || security.safe;
    } else {
      assessment.risk_level = 'high';
      assessment.tradeable = false;
    }

    return assessment;
  }

  /**
   * Calculate trading signal from analysis data
   * @param {Object} volume - Volume data
   * @param {Object} security - Security data
   * @param {Object} holders - Holder data
   * @returns {Object} Trading signal
   */
  calculateTradingSignal(volume, security, holders) {
    // Base signal calculation
    let signalStrength = 0;
    let confidence = 0;
    const reasons = [];

    // Volume momentum (strongest signal)
    if (volume.success) {
      const vol = volume;
      
      if (vol.volume?.acceleration?.m5 > 3 && vol.trading?.buy_pressure > 0.7 && vol.quality?.score >= 6) {
        signalStrength += 5;
        confidence += 25;
        reasons.push('Strong volume momentum with high buy pressure');
      } else if (vol.volume?.acceleration?.h1 > 2 && vol.trading?.buy_pressure > 0.6) {
        signalStrength += 3;
        confidence += 15;
        reasons.push('Moderate volume acceleration');
      } else if (vol.trading?.buy_pressure < 0.4) {
        signalStrength -= 3;
        confidence += 15;
        reasons.push('Weak buy pressure detected');
      }
    }

    // Safety bonus/penalty
    if (security.success) {
      if (security.score >= 8) {
        signalStrength += 2;
        confidence += 20;
        reasons.push('High safety score');
      } else if (security.score < 4) {
        signalStrength -= 4;
        confidence += 25;
        reasons.push('Low safety score');
      }
    }

    // Holder distribution factor
    if (holders.success && holders.risk_assessment) {
      if (holders.risk_assessment.safe_to_trade) {
        signalStrength += 1;
        confidence += 10;
      } else {
        signalStrength -= 2;
        confidence += 15;
        reasons.push('Concerning holder concentration');
      }
    }

    // Determine final signal
    let signal = 'hold';
    if (signalStrength >= 4) signal = 'strong_buy';
    else if (signalStrength >= 2) signal = 'buy';
    else if (signalStrength >= 0) signal = 'weak_buy';
    else if (signalStrength >= -2) signal = 'weak_sell';
    else if (signalStrength >= -4) signal = 'sell';
    else signal = 'strong_sell';

    return {
      signal,
      strength: signalStrength,
      confidence: Math.min(100, confidence),
      reasons,
      recommendation: this.getSignalRecommendation(signal, confidence)
    };
  }

  /**
   * Get recommendation text for signal
   * @param {string} signal - Signal type
   * @param {number} confidence - Confidence level
   * @returns {string} Recommendation
   */
  getSignalRecommendation(signal, confidence) {
    const confidenceText = confidence > 70 ? 'high confidence' : 
                          confidence > 50 ? 'medium confidence' : 'low confidence';
    
    switch (signal) {
      case 'strong_buy':
        return `Strong buy signal with ${confidenceText} - consider larger position`;
      case 'buy':
        return `Buy signal with ${confidenceText} - normal position size`;
      case 'weak_buy':
        return `Weak buy signal with ${confidenceText} - small position or wait`;
      case 'weak_sell':
        return `Weak sell signal with ${confidenceText} - consider taking profits`;
      case 'sell':
        return `Sell signal with ${confidenceText} - exit position`;
      case 'strong_sell':
        return `Strong sell signal with ${confidenceText} - exit immediately`;
      default:
        return `Hold position - no clear signal`;
    }
  }

  /**
   * Check if monitoring criteria are met
   * @param {Object} signal - Current signal data
   * @param {Object} criteria - Monitoring criteria
   * @returns {Object} Criteria check result
   */
  checkMonitoringCriteria(signal, criteria) {
    const reasons = [];
    let meets = false;

    if (criteria.signal && signal.signal === criteria.signal) {
      meets = true;
      reasons.push(`Signal matched: ${criteria.signal}`);
    }

    if (criteria.minConfidence && signal.confidence >= criteria.minConfidence) {
      meets = true;
      reasons.push(`Confidence above ${criteria.minConfidence}%`);
    }

    if (criteria.volume && signal.analysis_summary?.volume_quality >= criteria.volume) {
      meets = true;
      reasons.push(`Volume quality above ${criteria.volume}`);
    }

    return { meets, reasons };
  }

  /**
   * Assess current trading conditions
   * @param {Object} gasData - Gas price data
   * @returns {Object} Trading conditions assessment
   */
  assessTradingConditions(gasData) {
    if (!gasData || !gasData.success) {
      return { condition: 'unknown', reason: 'Gas data unavailable' };
    }

    const standardGas = gasData.prices?.standard || 50;
    
    if (standardGas > 100) {
      return { condition: 'poor', reason: 'Very high gas prices' };
    } else if (standardGas > 50) {
      return { condition: 'moderate', reason: 'High gas prices' };
    } else if (standardGas < 20) {
      return { condition: 'excellent', reason: 'Low gas prices' };
    } else {
      return { condition: 'good', reason: 'Normal gas prices' };
    }
  }

  /**
   * Test all API connections
   * @returns {Object} Connection test results
   */
  async testConnections() {
    console.log('🧪 Testing all API connections...');
    
    const tests = await Promise.allSettled([
      this.rpcManager.testConnectivity(),
      this.gas.getCurrentGasPrices(),
      this.volume.getVolumeData('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'), // WETH
      this.security.checkTokenSecurity('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '1'),
      this.dex.getQuote(
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 
        '0xA0b86a33E6441c8E81543100C9E01b49f71B08B2', 
        '1'
      )
    ]);

    return {
      rpc: tests[0].status === 'fulfilled' ? tests[0].value : { success: false, error: tests[0].reason?.message },
      gas: tests[1].status === 'fulfilled' ? { success: true } : { success: false, error: tests[1].reason?.message },
      volume: tests[2].status === 'fulfilled' ? { success: tests[2].value?.success } : { success: false },
      security: tests[3].status === 'fulfilled' ? { success: tests[3].value?.success } : { success: false },
      dex: tests[4].status === 'fulfilled' ? { success: tests[4].value?.success } : { success: false },
      overall: tests.filter(t => t.status === 'fulfilled').length >= 3
    };
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.volume.clearCache();
    this.security.clearCache();
    this.holders.clearCache();
    this.gas.clearCache();
    this.dex.clearCache();
  }
}

// Export everything for flexible usage
export {
  DexScreenerVolumeAPI,
  GoPlusSecurityAPI, 
  UniswapV2RouterAPI,
  EthereumGasTracker,
  EthereumRPCManager,
  EtherscanHolderAPI,
  UNISWAP_V2_CONFIGS
};

// Default export is the complete API
export default EthereumTradingAPI;