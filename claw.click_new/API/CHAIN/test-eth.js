/**
 * Test script for Ethereum API modules
 * Demonstrates how to use each module individually or together
 */

import EthereumTradingAPI from '../ETH/index.js';
import DexScreenerVolumeAPI from '../ETH/ANALYSIS/VOLUME/dexscreener.js';
import GoPlusSecurityAPI from '../ETH/AUDIT/GOPLUS_SECURITY/goplus.js';

// Test tokens
const TEST_TOKENS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86a33E6441c8E81543100C9E01b49f71B08B2',
  PEPE: '0x6982508145454Ce325dDbE47a25d4ec3d2311933'
};

/**
 * Test individual API modules
 */
async function testIndividualModules() {
  console.log('\n🧪 Testing Individual API Modules\n');

  // Test DexScreener Volume API
  console.log('📊 Testing Volume Analysis...');
  const volumeAPI = new DexScreenerVolumeAPI();
  const volumeData = await volumeAPI.getVolumeData(TEST_TOKENS.PEPE);
  
  if (volumeData.success) {
    console.log('✅ Volume analysis successful');
    console.log(`   Quality Score: ${volumeData.quality?.score}/10`);
    console.log(`   Buy Pressure: ${(volumeData.trading?.buy_pressure * 100 || 0).toFixed(1)}%`);
    console.log(`   5m Acceleration: ${volumeData.volume?.acceleration?.m5?.toFixed(2) || 'N/A'}x`);
  } else {
    console.log('❌ Volume analysis failed:', volumeData.error);
  }

  // Test GoPlus Security API
  console.log('\n🛡️ Testing Security Analysis...');
  const securityAPI = new GoPlusSecurityAPI();
  const securityData = await securityAPI.checkTokenSecurity(TEST_TOKENS.PEPE);
  
  if (securityData.success) {
    console.log('✅ Security analysis successful');
    console.log(`   Safe: ${securityData.safe ? 'YES' : 'NO'}`);
    console.log(`   Risk Level: ${securityData.risk_level}`);
    console.log(`   Safety Score: ${securityData.score}/10`);
    if (securityData.warnings.length > 0) {
      console.log(`   Warnings: ${securityData.warnings.slice(0, 2).join(', ')}`);
    }
  } else {
    console.log('❌ Security analysis failed:', securityData.error);
  }
}

/**
 * Test the complete Ethereum Trading API
 */
async function testCompleteAPI() {
  console.log('\n🦞 Testing Complete Ethereum Trading API\n');

  // Initialize the complete API
  const ethAPI = new EthereumTradingAPI({
    // API keys would be loaded from environment
    // alchemyApiKey: process.env.ALCHEMY_API_KEY,
    // goPlusApiKey: process.env.GOPLUS_API_KEY,
    // etherscanApiKey: process.env.ETHERSCAN_API_KEY
  });

  // Test network status
  console.log('🌐 Testing Network Status...');
  const networkStatus = await ethAPI.getNetworkStatus();
  
  if (networkStatus.success) {
    console.log('✅ Network status retrieved');
    if (networkStatus.gas?.success) {
      console.log(`   Gas (standard): ${networkStatus.gas.prices?.standard?.toFixed(1) || 'N/A'} gwei`);
    }
    console.log(`   Trading conditions: ${networkStatus.trading_conditions?.condition || 'unknown'}`);
  } else {
    console.log('❌ Network status failed:', networkStatus.error);
  }

  // Test token analysis
  console.log('\n📈 Testing Complete Token Analysis...');
  const analysis = await ethAPI.analyzeToken(TEST_TOKENS.PEPE);
  
  if (analysis.success) {
    console.log('✅ Complete analysis successful');
    console.log(`   Overall Score: ${analysis.assessment.overall_score}/10`);
    console.log(`   Risk Level: ${analysis.assessment.risk_level}`);
    console.log(`   Tradeable: ${analysis.assessment.tradeable ? 'YES' : 'NO'}`);
    console.log(`   Confidence: ${analysis.assessment.confidence}%`);
    
    if (analysis.assessment.factors.positive.length > 0) {
      console.log(`   ✅ Positive: ${analysis.assessment.factors.positive.join(', ')}`);
    }
    if (analysis.assessment.factors.negative.length > 0) {
      console.log(`   ❌ Negative: ${analysis.assessment.factors.negative.join(', ')}`);
    }
  } else {
    console.log('❌ Complete analysis failed:', analysis.error);
  }

  // Test trading signal
  console.log('\n🎯 Testing Trading Signal Generation...');
  const signal = await ethAPI.getTradingSignal(TEST_TOKENS.PEPE);
  
  if (signal.signal !== 'error') {
    console.log('✅ Trading signal generated');
    console.log(`   Signal: ${signal.signal.toUpperCase()}`);
    console.log(`   Confidence: ${signal.confidence}%`);
    console.log(`   Recommendation: ${signal.recommendation}`);
    
    if (signal.reasons.length > 0) {
      console.log(`   Reasons: ${signal.reasons.slice(0, 2).join(', ')}`);
    }
  } else {
    console.log('❌ Trading signal failed:', signal.reason);
  }

  // Test DEX quote
  console.log('\n💱 Testing DEX Quote...');
  const quote = await ethAPI.getTradingQuote(
    TEST_TOKENS.WETH, 
    TEST_TOKENS.USDC, 
    '1' // 1 WETH
  );
  
  if (quote.success) {
    console.log('✅ DEX quote successful');
    console.log(`   Amount out: ${parseFloat(quote.amountOutFormatted).toFixed(2)} USDC`);
    console.log(`   Price impact: ${(quote.priceImpact * 100).toFixed(2)}%`);
    console.log(`   Gas estimate: ${quote.gasEstimate.toLocaleString()}`);
    console.log(`   Execution ready: ${quote.execution_ready ? 'YES' : 'NO'}`);
  } else {
    console.log('❌ DEX quote failed:', quote.error);
  }
}

/**
 * Test API connections
 */
async function testConnections() {
  console.log('\n🔌 Testing API Connections...');
  
  const ethAPI = new EthereumTradingAPI();
  const connectionTests = await ethAPI.testConnections();
  
  console.log(`RPC: ${connectionTests.rpc.success ? '✅' : '❌'}`);
  console.log(`Gas: ${connectionTests.gas.success ? '✅' : '❌'}`);
  console.log(`Volume: ${connectionTests.volume.success ? '✅' : '❌'}`);
  console.log(`Security: ${connectionTests.security.success ? '✅' : '❌'}`);
  console.log(`DEX: ${connectionTests.dex.success ? '✅' : '❌'}`);
  console.log(`Overall: ${connectionTests.overall ? '✅ READY' : '❌ ISSUES DETECTED'}`);
  
  if (connectionTests.rpc.success && connectionTests.rpc.recommendation) {
    console.log(`💡 ${connectionTests.rpc.recommendation}`);
  }
}

/**
 * Demonstrate monitoring functionality
 */
async function demonstrateMonitoring() {
  console.log('\n👁️ Demonstrating Token Monitoring...');
  
  const ethAPI = new EthereumTradingAPI();
  
  console.log(`Monitoring ${TEST_TOKENS.PEPE} for 30 seconds...`);
  
  const stopMonitoring = ethAPI.startTokenMonitoring(
    TEST_TOKENS.PEPE,
    {
      signal: 'buy',
      minConfidence: 60,
      interval: 10000 // 10 seconds
    },
    (result) => {
      console.log(`🚨 ALERT: ${result.signal.signal} signal detected!`);
      console.log(`   Confidence: ${result.signal.confidence}%`);
      console.log(`   Criteria met: ${result.criteria_met.join(', ')}`);
    }
  );
  
  // Stop monitoring after 30 seconds
  setTimeout(() => {
    stopMonitoring();
    console.log('📴 Monitoring stopped');
  }, 30000);
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🦞 Claw.Click API Module Tests Starting...');
  console.log('=' .repeat(50));

  try {
    // Test individual modules first
    await testIndividualModules();
    
    // Test complete API
    await testCompleteAPI();
    
    // Test connections
    await testConnections();
    
    // Demonstrate monitoring (commented out for quick tests)
    // await demonstrateMonitoring();
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 All tests completed!');
    console.log('\nTo use these modules in your project:');
    console.log('```javascript');
    console.log('import EthereumTradingAPI from "./API/ETH/index.js";');
    console.log('const ethAPI = new EthereumTradingAPI({ alchemyApiKey: "your_key" });');
    console.log('const analysis = await ethAPI.analyzeToken("0x6982...");');
    console.log('```');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Tests interrupted');
  process.exit(0);
});

// Run tests
runTests().catch(console.error);