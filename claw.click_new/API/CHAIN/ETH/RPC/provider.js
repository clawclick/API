import { ethers } from 'ethers';

/**
 * Ethereum RPC Provider Manager
 * Handles multiple RPC providers with fallback and load balancing
 */
export class EthereumRPCManager {
  constructor(config = {}) {
    this.config = {
      alchemyApiKey: config.alchemyApiKey || process.env.ALCHEMY_API_KEY,
      infuraApiKey: config.infuraApiKey || process.env.INFURA_API_KEY,
      etherscanApiKey: config.etherscanApiKey || process.env.ETHERSCAN_API_KEY,
      ...config
    };
    
    this.providers = [];
    this.currentProviderIndex = 0;
    this.failedProviders = new Set();
    this.initializeProviders();
  }

  /**
   * Initialize all available providers
   */
  initializeProviders() {
    const providers = [];

    // Primary: Alchemy (most reliable)
    if (this.config.alchemyApiKey) {
      providers.push({
        name: 'alchemy',
        provider: new ethers.JsonRpcProvider(
          `https://eth-mainnet.g.alchemy.com/v2/${this.config.alchemyApiKey}`
        ),
        priority: 1,
        rateLimit: 3000 // requests per second
      });
    }

    // Secondary: Infura
    if (this.config.infuraApiKey) {
      providers.push({
        name: 'infura',
        provider: new ethers.JsonRpcProvider(
          `https://mainnet.infura.io/v3/${this.config.infuraApiKey}`
        ),
        priority: 2,
        rateLimit: 100
      });
    }

    // Fallback: Public RPCs (rate limited but free)
    providers.push({
      name: 'ankr',
      provider: new ethers.JsonRpcProvider('https://rpc.ankr.com/eth'),
      priority: 3,
      rateLimit: 10
    });

    providers.push({
      name: 'publicnode',
      provider: new ethers.JsonRpcProvider('https://ethereum.publicnode.com'),
      priority: 4,
      rateLimit: 5
    });

    // Sort by priority
    this.providers = providers.sort((a, b) => a.priority - b.priority);
    
    if (this.providers.length === 0) {
      throw new Error('No RPC providers configured');
    }
  }

  /**
   * Get the current active provider
   * @returns {Object} Provider object
   */
  getCurrentProvider() {
    // Skip failed providers
    while (this.failedProviders.has(this.currentProviderIndex) && 
           this.currentProviderIndex < this.providers.length - 1) {
      this.currentProviderIndex++;
    }

    if (this.currentProviderIndex >= this.providers.length) {
      // All providers failed, reset and try again
      this.failedProviders.clear();
      this.currentProviderIndex = 0;
    }

    return this.providers[this.currentProviderIndex];
  }

  /**
   * Execute RPC call with automatic fallback
   * @param {Function} operation - Async operation to execute
   * @param {Object} options - Options for the call
   * @returns {*} Result of the operation
   */
  async executeWithFallback(operation, options = {}) {
    const maxRetries = options.maxRetries || this.providers.length;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      const providerObj = this.getCurrentProvider();
      
      try {
        const result = await operation(providerObj.provider);
        
        // Success - clear any failure flags for this provider
        this.failedProviders.delete(this.currentProviderIndex);
        
        return {
          success: true,
          result,
          provider: providerObj.name
        };
      } catch (error) {
        lastError = error;
        console.warn(`Provider ${providerObj.name} failed:`, error.message);
        
        // Mark provider as failed temporarily
        this.failedProviders.add(this.currentProviderIndex);
        
        // Try next provider
        this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
        
        // Wait briefly before retry
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        }
      }
    }

    return {
      success: false,
      error: lastError.message,
      providersAttempted: maxRetries
    };
  }

  /**
   * Get network information
   * @returns {Object} Network details
   */
  async getNetworkInfo() {
    return this.executeWithFallback(async (provider) => {
      const [network, blockNumber, gasPrice] = await Promise.all([
        provider.getNetwork(),
        provider.getBlockNumber(),
        provider.getFeeData()
      ]);

      return {
        chainId: Number(network.chainId),
        name: network.name,
        blockNumber,
        gasPrice: Number(gasPrice.gasPrice) / 1e9, // Convert to gwei
        maxFeePerGas: gasPrice.maxFeePerGas ? Number(gasPrice.maxFeePerGas) / 1e9 : null,
        maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas ? Number(gasPrice.maxPriorityFeePerGas) / 1e9 : null
      };
    });
  }

  /**
   * Get account balance
   * @param {string} address - Wallet address
   * @returns {Object} Balance information
   */
  async getBalance(address) {
    return this.executeWithFallback(async (provider) => {
      const balance = await provider.getBalance(address);
      return {
        wei: balance.toString(),
        eth: ethers.formatEther(balance),
        address
      };
    });
  }

  /**
   * Get transaction details
   * @param {string} txHash - Transaction hash
   * @returns {Object} Transaction details
   */
  async getTransaction(txHash) {
    return this.executeWithFallback(async (provider) => {
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(txHash),
        provider.getTransactionReceipt(txHash).catch(() => null)
      ]);

      return {
        transaction: tx,
        receipt,
        confirmed: receipt !== null,
        success: receipt ? receipt.status === 1 : null
      };
    });
  }

  /**
   * Get current block information
   * @returns {Object} Block details
   */
  async getCurrentBlock() {
    return this.executeWithFallback(async (provider) => {
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber);
      
      return {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
        gasLimit: block.gasLimit.toString(),
        gasUsed: block.gasUsed.toString(),
        baseFeePerGas: block.baseFeePerGas ? Number(block.baseFeePerGas) / 1e9 : null
      };
    });
  }

  /**
   * Estimate gas for a transaction
   * @param {Object} transaction - Transaction object
   * @returns {Object} Gas estimate
   */
  async estimateGas(transaction) {
    return this.executeWithFallback(async (provider) => {
      const estimate = await provider.estimateGas(transaction);
      return {
        gasLimit: estimate.toString(),
        gasLimitNumber: Number(estimate)
      };
    });
  }

  /**
   * Send raw transaction
   * @param {string} signedTx - Signed transaction hex
   * @returns {Object} Transaction result
   */
  async sendTransaction(signedTx) {
    return this.executeWithFallback(async (provider) => {
      const tx = await provider.broadcastTransaction(signedTx);
      return {
        hash: tx.hash,
        transaction: tx
      };
    });
  }

  /**
   * Call contract function (read-only)
   * @param {Object} params - Call parameters
   * @returns {Object} Call result
   */
  async call(params) {
    return this.executeWithFallback(async (provider) => {
      return await provider.call(params);
    });
  }

  /**
   * Get contract logs
   * @param {Object} filter - Event filter
   * @returns {Object} Logs result
   */
  async getLogs(filter) {
    return this.executeWithFallback(async (provider) => {
      return await provider.getLogs(filter);
    });
  }

  /**
   * Wait for transaction confirmation
   * @param {string} txHash - Transaction hash
   * @param {number} confirmations - Number of confirmations to wait for
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Object} Receipt when confirmed
   */
  async waitForTransaction(txHash, confirmations = 1, timeout = 60000) {
    return this.executeWithFallback(async (provider) => {
      return await provider.waitForTransaction(txHash, confirmations, timeout);
    });
  }

  /**
   * Get provider health status
   * @returns {Object} Health status of all providers
   */
  async getProvidersHealth() {
    const healthChecks = this.providers.map(async (providerObj, index) => {
      try {
        const start = Date.now();
        await providerObj.provider.getBlockNumber();
        const latency = Date.now() - start;
        
        return {
          name: providerObj.name,
          index,
          healthy: true,
          latency,
          priority: providerObj.priority,
          failed: this.failedProviders.has(index)
        };
      } catch (error) {
        return {
          name: providerObj.name,
          index,
          healthy: false,
          error: error.message,
          priority: providerObj.priority,
          failed: true
        };
      }
    });

    const results = await Promise.all(healthChecks);
    
    return {
      providers: results,
      currentProvider: this.getCurrentProvider().name,
      totalProviders: this.providers.length,
      healthyProviders: results.filter(p => p.healthy).length
    };
  }

  /**
   * Reset all provider failures (force retry)
   */
  resetFailures() {
    this.failedProviders.clear();
    this.currentProviderIndex = 0;
  }

  /**
   * Get direct access to current provider (for advanced usage)
   * @returns {ethers.Provider} The underlying ethers provider
   */
  getDirectProvider() {
    return this.getCurrentProvider().provider;
  }

  /**
   * Test connectivity to all providers
   * @returns {Object} Connectivity test results
   */
  async testConnectivity() {
    console.log('Testing RPC provider connectivity...');
    const health = await this.getProvidersHealth();
    
    const working = health.providers.filter(p => p.healthy);
    const failed = health.providers.filter(p => !p.healthy);
    
    return {
      success: working.length > 0,
      summary: `${working.length}/${health.totalProviders} providers working`,
      working: working.map(p => ({ name: p.name, latency: p.latency })),
      failed: failed.map(p => ({ name: p.name, error: p.error })),
      recommendation: working.length === 0 ? 
        'No providers available - check API keys' :
        working.length === 1 ?
        'Only one provider working - consider adding backups' :
        'Multiple providers available - good redundancy'
    };
  }
}

// Factory functions for easy setup
export function createEthereumProvider(config = {}) {
  return new EthereumRPCManager(config);
}

export function createAlchemyProvider(apiKey) {
  return new ethers.JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`
  );
}

export function createInfuraProvider(apiKey) {
  return new ethers.JsonRpcProvider(
    `https://mainnet.infura.io/v3/${apiKey}`
  );
}

export default EthereumRPCManager;