# Bubblemaps API - Wallet Clustering Analysis
**Status: NEED TO RESEARCH** 🔍 (Likely Paid)

## About Bubblemaps
**Website**: https://bubblemaps.io/
**Focus**: Visualize token holder connections, detect wallet clustering, identify coordinated wallets

## What We Need From Bubblemaps
- **Wallet Clustering**: Detect if multiple wallets are controlled by same entity
- **Sybil Detection**: Identify coordinated buying/selling
- **Insider Network Analysis**: Map connections between early holders
- **Visual Representation**: Bubble chart of holder relationships

## Expected API Structure (TBD)
```javascript
// Placeholder - need actual API documentation
class BubblemapsAnalyzer {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.bubblemaps.io'; // TBD
  }

  async getTokenClusters(tokenAddress) {
    // Expected response structure:
    return {
      clusters: [
        {
          cluster_id: 'cluster_1',
          wallets: ['0x...', '0x...'],
          total_tokens: 1500000,
          percentage_of_supply: 0.15,
          cluster_type: 'coordinated_wallets',
          risk_level: 'medium'
        }
      ],
      sybil_risk_score: 6.5,
      concentration_score: 8.2,
      network_analysis: {
        connected_components: 5,
        largest_cluster_size: 8,
        isolation_score: 3.4
      }
    };
  }

  async getWalletConnections(walletAddress) {
    // Analyze specific wallet's connections
    return {
      connected_wallets: ['0x...'],
      connection_strength: 0.85,
      transaction_patterns: 'coordinated',
      risk_assessment: 'high'
    };
  }

  async getClusterAnalysis(tokenAddress) {
    // Full cluster analysis for safety scoring
    const clusters = await this.getTokenClusters(tokenAddress);
    
    return {
      has_large_clusters: clusters.some(c => c.percentage_of_supply > 0.1),
      sybil_attack_likely: clusters.sybil_risk_score > 7,
      coordinated_wallets_detected: clusters.some(c => c.cluster_type === 'coordinated_wallets'),
      safety_score: this.calculateSafetyScore(clusters),
      recommendations: this.generateRecommendations(clusters)
    };
  }

  calculateSafetyScore(clustersData) {
    // Logic to convert cluster analysis to safety score
    let score = 10;
    
    if (clustersData.sybil_risk_score > 8) score -= 4;
    else if (clustersData.sybil_risk_score > 6) score -= 2;
    
    clustersData.clusters.forEach(cluster => {
      if (cluster.percentage_of_supply > 0.2) score -= 3;
      else if (cluster.percentage_of_supply > 0.1) score -= 2;
      
      if (cluster.cluster_type === 'coordinated_wallets') score -= 1;
    });
    
    return Math.max(0, score);
  }

  generateRecommendations(clustersData) {
    const recommendations = [];
    
    if (clustersData.sybil_risk_score > 7) {
      recommendations.push('High sybil attack risk - avoid trading');
    }
    
    const largeClusters = clustersData.clusters.filter(c => c.percentage_of_supply > 0.15);
    if (largeClusters.length > 0) {
      recommendations.push(`Large wallet clusters detected - concentrated ownership risk`);
    }
    
    return recommendations;
  }
}
```

## Integration with Safety Checks
```javascript
// How Bubblemaps would fit into our safety system
async function enhancedSafetyCheck(tokenAddress) {
  const goPlusResult = await goPlusChecker.check(tokenAddress);
  const holderResult = await holderAnalyzer.analyze(tokenAddress);
  const bubblemapsResult = await bubblemapsAnalyzer.getClusterAnalysis(tokenAddress);
  
  const combinedSafetyScore = (
    goPlusResult.safetyScore * 0.4 +
    holderResult.safetyScore * 0.3 + 
    bubblemapsResult.safety_score * 0.3
  );
  
  const warnings = [
    ...goPlusResult.warnings,
    ...holderResult.warnings,
    ...bubblemapsResult.recommendations
  ];
  
  return {
    overall_safety_score: combinedSafetyScore,
    safe_to_trade: combinedSafetyScore >= 6,
    all_warnings: warnings,
    cluster_risks: bubblemapsResult
  };
}
```

## Research TODO
- [ ] Contact Bubblemaps for API access and pricing
- [ ] Test API endpoints and response structure
- [ ] Determine if they offer programmatic access
- [ ] Check rate limits and costs
- [ ] Validate clustering detection accuracy

## Alternative Clustering Solutions
If Bubblemaps doesn't have API access:

1. **Build Custom**: Analyze transaction patterns to detect clustering
2. **Dune Analytics**: Query for wallet clustering patterns
3. **Nansen API**: Professional wallet intelligence (expensive)
4. **On-chain Analysis**: Direct blockchain analysis for connections

## Expected Value
Bubblemaps clustering analysis would be valuable for:
- Detecting coordinated pump schemes
- Identifying sybil attacks
- Uncovering insider trading rings  
- Improving overall rug pull prevention

**Status: Need to research actual API availability and pricing**