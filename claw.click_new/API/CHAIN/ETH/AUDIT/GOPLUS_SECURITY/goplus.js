import fetch from 'node-fetch';

/**
 * GoPlus Security API for token safety checks
 * Returns security analysis and risk assessment
 */
export class GoPlusSecurityAPI {
  constructor(apiKey = null) {
    this.baseUrl = 'https://api.gopluslabs.io/api/v1';
    this.apiKey = apiKey;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
    
    // Rate limiting
    this.requests = [];
    this.maxRequests = apiKey ? 2000 : 200; // Paid vs free
    this.windowMs = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Check token security
   * @param {string} address - Token contract address
   * @param {string} chainId - Chain ID (1=ethereum, 56=bsc, etc)
   * @returns {Object} Security analysis
   */
  async checkTokenSecurity(address, chainId = '1') {
    const cacheKey = `security_${chainId}_${address.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    // Check rate limit
    const rateLimitCheck = this.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      return { 
        error: 'Rate limit exceeded', 
        success: false,
        remaining: rateLimitCheck.remaining 
      };
    }

    try {
      const url = `${this.baseUrl}/token_security/${chainId}?contract_addresses=${address}`;
      const headers = { 'Content-Type': 'application/json' };
      
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.code !== 1) {
        throw new Error(data.message || 'API request failed');
      }

      const tokenData = data.result[address.toLowerCase()];
      const analysis = this.analyzeSecurityData(tokenData);
      
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
   * Analyze security data from GoPlus response
   * @param {Object} tokenData - Raw token data from API
   * @returns {Object} Analyzed security data
   */
  analyzeSecurityData(tokenData) {
    if (!tokenData) {
      return {
        success: false,
        error: 'No token data available',
        safe: false,
        score: 0
      };
    }

    const flags = this.extractSecurityFlags(tokenData);
    const risks = this.assessRisks(flags);
    const score = this.calculateSafetyScore(flags, risks);
    
    return {
      success: true,
      safe: !flags.critical_fails && risks.total_risk < 6,
      score,
      risk_level: this.getRiskLevel(flags.critical_fails, risks.total_risk),
      warnings: risks.warnings,
      flags,
      details: this.extractDetailedInfo(tokenData),
      timestamp: Date.now()
    };
  }

  /**
   * Extract security flags from token data
   * @param {Object} data - Token data
   * @returns {Object} Security flags
   */
  extractSecurityFlags(data) {
    return {
      // Critical flags (instant fail)
      is_honeypot: data.is_honeypot === "1",
      is_fake: data.fake_token === "1",
      cannot_buy: data.cannot_buy === "1",
      cannot_sell: data.cannot_sell_all === "1",
      is_blacklisted: data.is_blacklisted === "1",
      
      // Tax flags
      buy_tax: parseFloat(data.buy_tax || 0),
      sell_tax: parseFloat(data.sell_tax || 0),
      tax_modifiable: data.tax_modifiable === "1",
      
      // Ownership flags
      owner_percent: parseFloat(data.owner_percent || 0),
      can_take_back_ownership: data.can_take_back_ownership === "1",
      
      // Contract flags
      is_proxy: data.is_proxy === "1",
      is_mintable: data.is_mintable === "1",
      
      // Liquidity flags
      liquidity: parseFloat(data.liquidity || 0),
      holder_count: parseInt(data.holder_count || 0),
      
      // Trading controls
      trading_cooldown: data.trading_cooldown === "1",
      personal_slippage_modifiable: data.personal_slippage_modifiable === "1",
      
      // Critical check
      critical_fails: [
        data.is_honeypot === "1",
        data.fake_token === "1", 
        data.cannot_buy === "1",
        data.cannot_sell_all === "1",
        data.is_blacklisted === "1"
      ].some(fail => fail)
    };
  }

  /**
   * Assess risks based on flags
   * @param {Object} flags - Security flags
   * @returns {Object} Risk assessment
   */
  assessRisks(flags) {
    let totalRisk = 0;
    const warnings = [];

    // Tax risks
    if (flags.buy_tax > 0.10) {
      totalRisk += 3;
      warnings.push(`High buy tax: ${(flags.buy_tax * 100).toFixed(1)}%`);
    }
    
    if (flags.sell_tax > 0.15) {
      totalRisk += 4;
      warnings.push(`High sell tax: ${(flags.sell_tax * 100).toFixed(1)}%`);
    }

    if (flags.tax_modifiable) {
      totalRisk += 2;
      warnings.push('Taxes can be modified by owner');
    }

    // Ownership risks
    if (flags.owner_percent > 0.20) {
      totalRisk += 4;
      warnings.push(`High owner ownership: ${(flags.owner_percent * 100).toFixed(1)}%`);
    } else if (flags.owner_percent > 0.10) {
      totalRisk += 2;
      warnings.push(`Moderate owner ownership: ${(flags.owner_percent * 100).toFixed(1)}%`);
    }

    // Contract risks
    if (flags.is_mintable) {
      totalRisk += 3;
      warnings.push('Contract can mint new tokens');
    }

    if (flags.is_proxy && flags.can_take_back_ownership) {
      totalRisk += 3;
      warnings.push('Upgradeable contract with ownership risks');
    }

    // Liquidity risks
    if (flags.liquidity < 5000) {
      totalRisk += 2;
      warnings.push(`Low liquidity: $${flags.liquidity.toFixed(0)}`);
    }

    if (flags.holder_count < 25) {
      totalRisk += 1;
      warnings.push(`Few holders: ${flags.holder_count}`);
    }

    // Trading control risks
    if (flags.trading_cooldown) {
      totalRisk += 1;
      warnings.push('Trading cooldown enabled');
    }

    return {
      total_risk: totalRisk,
      warnings,
      categories: {
        tax_risk: Math.min(5, Math.floor(totalRisk * 0.4)),
        ownership_risk: Math.min(5, Math.floor(totalRisk * 0.3)),
        contract_risk: Math.min(5, Math.floor(totalRisk * 0.2)),
        liquidity_risk: Math.min(5, Math.floor(totalRisk * 0.1))
      }
    };
  }

  /**
   * Calculate safety score (0-10)
   * @param {Object} flags - Security flags
   * @param {Object} risks - Risk assessment
   * @returns {number} Safety score
   */
  calculateSafetyScore(flags, risks) {
    if (flags.critical_fails) return 0;
    return Math.max(0, 10 - risks.total_risk);
  }

  /**
   * Get risk level description
   * @param {boolean} criticalFails - Has critical failures
   * @param {number} totalRisk - Total risk score
   * @returns {string} Risk level
   */
  getRiskLevel(criticalFails, totalRisk) {
    if (criticalFails) return 'critical';
    if (totalRisk >= 6) return 'high';
    if (totalRisk >= 3) return 'medium';
    return 'low';
  }

  /**
   * Extract detailed information for reference
   * @param {Object} data - Raw token data
   * @returns {Object} Detailed information
   */
  extractDetailedInfo(data) {
    return {
      taxes: {
        buy: parseFloat(data.buy_tax || 0),
        sell: parseFloat(data.sell_tax || 0),
        modifiable: data.tax_modifiable === "1"
      },
      ownership: {
        owner_address: data.owner_address,
        owner_balance: data.owner_balance,
        owner_percent: parseFloat(data.owner_percent || 0)
      },
      contract: {
        is_proxy: data.is_proxy === "1",
        is_mintable: data.is_mintable === "1",
        can_take_back_ownership: data.can_take_back_ownership === "1"
      },
      liquidity: {
        total: parseFloat(data.liquidity || 0),
        holders: parseInt(data.holder_count || 0)
      }
    };
  }

  /**
   * Check rate limiting
   * @returns {Object} Rate limit status
   */
  checkRateLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      return { 
        allowed: false, 
        remaining: 0,
        resetTime: this.requests[0] + this.windowMs 
      };
    }

    this.requests.push(now);
    return { 
      allowed: true, 
      remaining: this.maxRequests - this.requests.length 
    };
  }

  /**
   * Get multiple token security data in one call
   * @param {Array} addresses - Array of token addresses
   * @param {string} chainId - Chain ID
   * @returns {Object} Multiple token analysis
   */
  async checkMultipleTokens(addresses, chainId = '1') {
    if (addresses.length === 0) return {};
    
    const rateLimitCheck = this.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      return { 
        error: 'Rate limit exceeded', 
        remaining: rateLimitCheck.remaining 
      };
    }

    try {
      const addressList = addresses.map(addr => addr.toLowerCase()).join(',');
      const url = `${this.baseUrl}/token_security/${chainId}?contract_addresses=${addressList}`;
      
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, { headers });
      const data = await response.json();
      
      if (data.code !== 1) {
        throw new Error(data.message);
      }

      const results = {};
      for (const [address, tokenData] of Object.entries(data.result)) {
        results[address] = this.analyzeSecurityData(tokenData);
      }

      return results;
    } catch (error) {
      return { error: error.message };
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getRemainingQuota() {
    const now = Date.now();
    const validRequests = this.requests.filter(time => now - time < this.windowMs);
    return this.maxRequests - validRequests.length;
  }
}

// Export default instance
export default new GoPlusSecurityAPI();