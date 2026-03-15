import fetch from 'node-fetch';

/**
 * Multi-source gas price tracker for Ethereum
 * Aggregates data from multiple APIs for reliable gas estimates
 */
export class EthereumGasTracker {
  constructor(provider) {
    this.provider = provider;
    this.cache = new Map();
    this.cacheTTL = 15000; // 15 seconds
  }

  /**
   * Get current gas prices from multiple sources
   * @returns {Object} Gas price data
   */
  async getCurrentGasPrices() {
    const cacheKey = 'gas_prices';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      // Try multiple sources in parallel
      const results = await Promise.allSettled([
        this.getGasFromProvider(),
        this.getGasFromEthGasStation(),
        this.getGasFromGasNow(),
        this.getGasFromEtherscan()
      ]);

      // Find the first successful result
      const successful = results.find(result => 
        result.status === 'fulfilled' && result.value.success
      );

      if (!successful) {
        throw new Error('All gas price sources failed');
      }

      const gasData = successful.value;
      
      this.cache.set(cacheKey, {
        data: gasData,
        timestamp: Date.now()
      });

      return gasData;
    } catch (error) {
      // Return fallback prices if all sources fail
      return {
        success: true,
        source: 'fallback',
        prices: {
          slow: 20,
          standard: 25, 
          fast: 30,
          instant: 35
        },
        error: error.message
      };
    }
  }

  /**
   * Get gas prices from connected provider
   * @returns {Object} Provider gas data
   */
  async getGasFromProvider() {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = Number(feeData.gasPrice) / 1e9; // Convert to gwei
      
      return {
        success: true,
        source: 'provider',
        prices: {
          slow: Math.max(1, gasPrice * 0.8),
          standard: gasPrice,
          fast: gasPrice * 1.2,
          instant: gasPrice * 1.5
        },
        maxFeePerGas: feeData.maxFeePerGas ? Number(feeData.maxFeePerGas) / 1e9 : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? Number(feeData.maxPriorityFeePerGas) / 1e9 : null
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get gas prices from EthGasStation
   * @returns {Object} EthGasStation data
   */
  async getGasFromEthGasStation() {
    try {
      const response = await fetch('https://ethgasstation.info/api/ethgasAPI.json', {
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        success: true,
        source: 'ethgasstation',
        prices: {
          slow: data.safeLow / 10,      // API returns in 0.1 gwei
          standard: data.standard / 10,
          fast: data.fast / 10,
          instant: data.fastest / 10
        },
        waitTimes: {
          slow: data.safeLowWait || null,
          standard: data.avgWait || null,
          fast: data.fastWait || null,
          instant: data.fastestWait || null
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get gas prices from GasNow
   * @returns {Object} GasNow data
   */
  async getGasFromGasNow() {
    try {
      const response = await fetch('https://www.gasnow.org/api/v3/gas/price', {
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        success: true,
        source: 'gasnow',
        prices: {
          slow: Number(data.slow) / 1e9,
          standard: Number(data.standard) / 1e9,
          fast: Number(data.fast) / 1e9,
          instant: Number(data.rapid) / 1e9
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get gas prices from Etherscan
   * @returns {Object} Etherscan data
   */
  async getGasFromEtherscan() {
    try {
      const apiKey = process.env.ETHERSCAN_API_KEY;
      if (!apiKey) {
        throw new Error('No Etherscan API key');
      }

      const response = await fetch(
        `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`,
        { timeout: 5000 }
      );
      
      const data = await response.json();
      
      if (data.status !== '1') {
        throw new Error(data.message);
      }

      const result = data.result;
      
      return {
        success: true,
        source: 'etherscan',
        prices: {
          slow: parseInt(result.SafeGasPrice),
          standard: parseInt(result.StandardGasPrice),
          fast: parseInt(result.FastGasPrice),
          instant: parseInt(result.FastGasPrice) * 1.2
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate gas cost for a transaction
   * @param {number} gasLimit - Gas limit for transaction
   * @param {string} speed - Gas speed (slow/standard/fast/instant)
   * @param {number} ethPrice - Current ETH price in USD (optional)
   * @returns {Object} Gas cost calculation
   */
  async calculateGasCost(gasLimit, speed = 'standard', ethPrice = null) {
    try {
      const gasData = await this.getCurrentGasPrices();
      const gasPrice = gasData.prices[speed];
      
      if (!gasPrice) {
        throw new Error(`Invalid gas speed: ${speed}`);
      }

      const gasCostWei = gasLimit * gasPrice * 1e9; // Convert gwei to wei
      const gasCostEth = gasCostWei / 1e18;
      
      return {
        success: true,
        gasLimit,
        gasPrice: gasPrice,
        gasPriceUnit: 'gwei',
        cost: {
          wei: gasCostWei.toString(),
          eth: gasCostEth,
          ethFormatted: gasCostEth.toFixed(8),
          usd: ethPrice ? gasCostEth * ethPrice : null
        },
        source: gasData.source
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if gas cost is acceptable for a trade
   * @param {number} gasLimit - Gas limit
   * @param {number} tradeValueEth - Trade value in ETH
   * @param {number} maxGasPercentage - Max gas as % of trade value
   * @param {string} speed - Gas speed
   * @returns {Object} Gas acceptability assessment
   */
  async isGasCostAcceptable(gasLimit, tradeValueEth, maxGasPercentage = 5, speed = 'standard') {
    try {
      const gasCost = await this.calculateGasCost(gasLimit, speed);
      
      if (!gasCost.success) {
        return gasCost;
      }

      const gasPercentage = (gasCost.cost.eth / tradeValueEth) * 100;
      
      return {
        success: true,
        acceptable: gasPercentage <= maxGasPercentage,
        gasPercentage,
        gasCostEth: gasCost.cost.eth,
        tradeValueEth,
        maxGasPercentage,
        recommendation: gasPercentage > maxGasPercentage ? 
          'wait_for_lower_gas' : 'proceed',
        gasCostDetails: gasCost
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get recommended gas strategy based on network conditions
   * @param {number} urgency - Urgency level 1-10
   * @returns {Object} Gas strategy recommendation
   */
  async getGasStrategy(urgency = 5) {
    try {
      const gasData = await this.getCurrentGasPrices();
      
      // Map urgency to gas speeds
      let recommendedSpeed;
      if (urgency <= 2) recommendedSpeed = 'slow';
      else if (urgency <= 5) recommendedSpeed = 'standard';
      else if (urgency <= 8) recommendedSpeed = 'fast';
      else recommendedSpeed = 'instant';
      
      const currentPrice = gasData.prices[recommendedSpeed];
      
      // Assess network congestion
      const standardPrice = gasData.prices.standard;
      let congestion = 'normal';
      
      if (standardPrice > 100) congestion = 'high';
      else if (standardPrice > 50) congestion = 'medium';
      else if (standardPrice < 15) congestion = 'low';
      
      return {
        success: true,
        urgency,
        recommendedSpeed,
        gasPrice: currentPrice,
        networkCongestion: congestion,
        allPrices: gasData.prices,
        advice: this.getGasAdvice(congestion, urgency),
        source: gasData.source
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get gas advice based on conditions
   * @param {string} congestion - Network congestion level
   * @param {number} urgency - User urgency level
   * @returns {string} Gas advice
   */
  getGasAdvice(congestion, urgency) {
    if (congestion === 'high' && urgency < 7) {
      return 'Network congestion is high. Consider waiting or using a different chain.';
    }
    
    if (congestion === 'low') {
      return 'Good time to transact - network congestion is low.';
    }
    
    if (urgency >= 8) {
      return 'High urgency detected - using fast gas despite potential high costs.';
    }
    
    return 'Normal gas conditions - proceed with recommended speed.';
  }

  /**
   * Monitor gas prices for optimal trading conditions
   * @param {number} targetGasPrice - Target gas price in gwei
   * @param {Function} callback - Callback when target is reached
   * @returns {Function} Cleanup function to stop monitoring
   */
  startGasMonitoring(targetGasPrice, callback) {
    let isActive = true;
    
    const checkGas = async () => {
      if (!isActive) return;
      
      try {
        const gasData = await this.getCurrentGasPrices();
        
        if (gasData.success && gasData.prices.standard <= targetGasPrice) {
          callback({
            targetReached: true,
            currentPrice: gasData.prices.standard,
            targetPrice: targetGasPrice,
            gasData
          });
        }
      } catch (error) {
        console.error('Gas monitoring error:', error);
      }
      
      // Schedule next check
      if (isActive) {
        setTimeout(checkGas, 30000); // 30 seconds
      }
    };
    
    // Start monitoring
    checkGas();
    
    // Return cleanup function
    return () => {
      isActive = false;
    };
  }

  /**
   * Get historical gas price trends (basic)
   * @returns {Object} Basic trend analysis
   */
  async getGasTrends() {
    // This would require storing historical data
    // For now, return current analysis
    const gasData = await this.getCurrentGasPrices();
    
    if (!gasData.success) {
      return gasData;
    }

    const standardPrice = gasData.prices.standard;
    
    return {
      success: true,
      current: gasData,
      trend: {
        level: standardPrice < 20 ? 'low' : 
               standardPrice < 50 ? 'moderate' : 'high',
        recommendation: standardPrice < 30 ? 
          'good_time_to_trade' : 'consider_waiting'
      }
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

export default EthereumGasTracker;