# Holder Analysis - Ethereum
**Status: MIXED** (Free + Paid APIs)

## Data Sources

### 1. Etherscan API (Free)
**Endpoint**: `https://api.etherscan.io/api`
**Rate Limit**: 5 requests/sec (free), 100 requests/sec (paid $0.0002/req)

```bash
# Get top token holders
GET https://api.etherscan.io/api?module=token&action=tokenholderlist&contractaddress={TOKEN}&page=1&offset=100&apikey={API_KEY}
```

### 2. Moralis API (Paid) 
**Cost**: $49/month for 40M compute units
**Better for**: Real-time holder tracking, wallet analysis

### 3. DexScreener (Free)
**Source**: `makers` field shows unique trader count
**Limitation**: Only trading wallets, not all holders

## Holder Analysis Functions
```javascript
class HolderAnalyzer {
  constructor(etherscanApiKey, moralisApiKey) {
    this.etherscanApiKey = etherscanApiKey;
    this.moralisApiKey = moralisApiKey;
    this.cache = new Map();
  }

  // Get holder distribution via Etherscan
  async getHolderDistribution(tokenAddress) {
    const cacheKey = `holders_${tokenAddress}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 min cache
      return cached.data;
    }

    try {
      const response = await fetch(
        `https://api.etherscan.io/api?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=100&apikey=${this.etherscanApiKey}`
      );
      
      const data = await response.json();
      
      if (data.status !== '1') {
        throw new Error(`Etherscan error: ${data.message}`);
      }

      const analysis = this.analyzeHolderDistribution(data.result);
      
      this.cache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now()
      });
      
      return analysis;
    } catch (error) {
      console.error('Holder analysis failed:', error);
      return null;
    }
  }

  // Analyze holder concentration and distribution
  analyzeHolderDistribution(holders) {
    if (!holders || holders.length === 0) {
      return { error: 'No holder data available' };
    }

    const totalSupply = holders.reduce((sum, holder) => 
      sum + parseFloat(holder.TokenHolderQuantity), 0
    );

    // Calculate concentrations
    const top1Percent = parseFloat(holders[0]?.TokenHolderQuantity || 0) / totalSupply;
    const top5Percent = holders.slice(0, Math.min(5, holders.length))
      .reduce((sum, holder) => sum + parseFloat(holder.TokenHolderQuantity), 0) / totalSupply;
    const top10Percent = holders.slice(0, Math.min(10, holders.length))
      .reduce((sum, holder) => sum + parseFloat(holder.TokenHolderQuantity), 0) / totalSupply;

    // Identify key wallet types
    const analysis = {
      total_holders: holders.length,
      total_supply: totalSupply,
      
      concentration: {
        top_1_holder: top1Percent,
        top_5_holders: top5Percent, 
        top_10_holders: top10Percent
      },
      
      risk_assessment: this.assessConcentrationRisk(top1Percent, top5Percent, top10Percent),
      
      wallet_analysis: this.analyzeWalletTypes(holders.slice(0, 20)) // Top 20
    };

    return analysis;
  }

  // Assess concentration risk
  assessConcentrationRisk(top1, top5, top10) {
    let riskScore = 0;
    let riskLevel = 'low';
    let warnings = [];

    // Top holder risk
    if (top1 > 0.5) {
      riskScore += 5;
      warnings.push('Single holder owns >50% of supply');
    } else if (top1 > 0.2) {
      riskScore += 3;
      warnings.push('Top holder owns >20% of supply');
    } else if (top1 > 0.1) {
      riskScore += 1;
      warnings.push('Top holder owns >10% of supply');
    }

    // Top 5 holders risk
    if (top5 > 0.8) {
      riskScore += 3;
      warnings.push('Top 5 holders own >80% of supply');
    } else if (top5 > 0.6) {
      riskScore += 2;
      warnings.push('Top 5 holders own >60% of supply');
    }

    // Top 10 holders risk  
    if (top10 > 0.9) {
      riskScore += 2;
      warnings.push('Top 10 holders own >90% of supply');
    }

    // Determine risk level
    if (riskScore >= 6) riskLevel = 'high';
    else if (riskScore >= 3) riskLevel = 'medium';
    else riskLevel = 'low';

    return {
      risk_score: riskScore,
      risk_level: riskLevel,
      warnings,
      tradeable: riskScore < 6 // Don't trade if risk score >= 6
    };
  }

  // Analyze wallet types (basic heuristics)
  analyzeWalletTypes(topHolders) {
    const walletTypes = {
      likely_deployer: null,
      exchange_wallets: [],
      whale_wallets: [],
      potential_insiders: []
    };

    topHolders.forEach((holder, index) => {
      const address = holder.TokenHolderAddress;
      const percentage = parseFloat(holder.TokenHolderQuantity);
      
      // Deployer likely to be top holder with significant %
      if (index === 0 && percentage > 0.15) {
        walletTypes.likely_deployer = {
          address,
          percentage,
          position: index + 1
        };
      }
      
      // Whale wallets (>5% but not deployer)
      if (percentage > 0.05 && index > 0) {
        walletTypes.whale_wallets.push({
          address,
          percentage,
          position: index + 1
        });
      }
      
      // Check for known exchange addresses (would need database)
      if (this.isKnownExchange(address)) {
        walletTypes.exchange_wallets.push({
          address,
          percentage,
          position: index + 1
        });
      }
    });

    return walletTypes;
  }

  // Check if address is known exchange (placeholder)
  isKnownExchange(address) {
    const knownExchanges = [
      '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 2
      '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Binance 3
      // Add more known exchange addresses
    ];
    
    return knownExchanges.includes(address.toLowerCase());
  }

  // Get holder growth rate (needs historical data)
  async getHolderGrowthRate(tokenAddress) {
    // Would need to track holder count over time
    // For now, return static analysis
    return {
      growth_rate: 'unknown',
      fresh_wallet_ratio: 'unknown',
      note: 'Need historical tracking for growth analysis'
    };
  }

  // Complete holder analysis
  async analyzeToken(tokenAddress) {
    try {
      const holderData = await this.getHolderDistribution(tokenAddress);
      
      if (holderData.error) {
        return holderData;
      }

      return {
        timestamp: Date.now(),
        token: tokenAddress,
        holder_distribution: holderData,
        safety_assessment: {
          safe_to_trade: holderData.risk_assessment.tradeable,
          risk_level: holderData.risk_assessment.risk_level,
          main_concerns: holderData.risk_assessment.warnings
        }
      };
    } catch (error) {
      return {
        error: 'Holder analysis failed',
        details: error.message
      };
    }
  }
}
```

## Usage Example
```javascript
const holderAnalyzer = new HolderAnalyzer(ETHERSCAN_API_KEY, MORALIS_API_KEY);

const analysis = await holderAnalyzer.analyzeToken('0x...');

if (analysis.safety_assessment?.safe_to_trade) {
  console.log('✅ Holder distribution looks safe');
} else {
  console.log('❌ High holder concentration risk');
  console.log(analysis.safety_assessment.main_concerns);
}
```

## API Costs Summary
- **Etherscan Free**: 5 req/sec, sufficient for basic analysis
- **Etherscan Pro**: $0.0002/request for higher rate limits
- **Moralis**: $49/month for real-time tracking
- **Alternative**: Build own indexing system (higher complexity)

**Recommendation: Start with Etherscan free tier**