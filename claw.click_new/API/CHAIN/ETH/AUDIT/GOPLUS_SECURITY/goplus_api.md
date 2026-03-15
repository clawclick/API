# GoPlus Security API - Ethereum
**Status: FREE** 🆓 (with rate limits)

## API Endpoint
**Base URL**: `https://api.gopluslabs.io/api/v1/token_security/1`
**Rate Limit**: 200 requests/day (free), 2000/day (paid $99/month)

## Token Security Check
```bash
GET https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses={TOKEN_ADDRESS}
```

### Response Analysis
```json
{
  "code": 1,
  "message": "OK", 
  "result": {
    "0x...": {
      // CRITICAL FLAGS
      "is_honeypot": "0",           // "1" = HONEYPOT (DO NOT TRADE)
      "honeypot_with_same_creator": "0",
      "fake_token": "0",           
      
      // TAX ANALYSIS  
      "buy_tax": "0.05",           // 5% buy tax
      "sell_tax": "0.10",          // 10% sell tax
      "tax_modifiable": "1",       // Can change taxes
      
      // OWNER RISKS
      "owner_address": "0x...",
      "owner_balance": "500000",   // Owner token balance
      "owner_percent": "0.15",     // 15% ownership
      "can_take_back_ownership": "0",
      
      // TRADING CONTROLS
      "cannot_buy": "0",           // "1" = CANNOT BUY
      "cannot_sell_all": "0",      // "1" = CANNOT SELL
      "trading_cooldown": "0",
      "personal_slippage_modifiable": "0",
      
      // CONTRACT RISKS
      "is_blacklisted": "0",       // "1" = BLACKLISTED
      "is_whitelisted": "0",
      "is_proxy": "1",             // Proxy contract
      "is_mintable": "0",          // Can mint new tokens
      
      // LIQUIDITY
      "liquidity": "125000",       // Total liquidity
      "holder_count": "1250"       // Number of holders
    }
  }
}
```

## Safety Logic
```javascript
function analyzeGoPlusSafety(result) {
  const checks = {
    isHoneypot: result.is_honeypot === "1",
    fakeToken: result.fake_token === "1", 
    cannotBuy: result.cannot_buy === "1",
    cannotSell: result.cannot_sell_all === "1",
    isBlacklisted: result.is_blacklisted === "1",
    
    // Tax checks
    buyTaxHigh: parseFloat(result.buy_tax) > 0.10,    // >10%
    sellTaxHigh: parseFloat(result.sell_tax) > 0.15,  // >15%
    taxModifiable: result.tax_modifiable === "1",
    
    // Ownership concerns  
    ownershipHigh: parseFloat(result.owner_percent) > 0.20, // >20%
    isMintable: result.is_mintable === "1",
    
    // Liquidity concerns
    lowLiquidity: parseFloat(result.liquidity) < 5000,     // <$5K
    lowHolders: parseFloat(result.holder_count) < 25       // <25 holders
  };
  
  // HARD FAILS (Do not trade)
  const hardFails = [
    checks.isHoneypot,
    checks.fakeToken, 
    checks.cannotBuy,
    checks.cannotSell,
    checks.isBlacklisted
  ].some(fail => fail);
  
  // SOFT FAILS (Reduce position)
  const softFails = [
    checks.buyTaxHigh,
    checks.sellTaxHigh,
    checks.ownershipHigh,
    checks.isMintable,
    checks.lowLiquidity
  ].filter(fail => fail).length;
  
  return {
    hardFail: hardFails,
    softFailCount: softFails,
    safetyScore: hardFails ? 0 : Math.max(0, 10 - softFails * 2),
    tradeable: !hardFails && softFails < 4
  };
}
```

## Integration Code
```javascript
class GoPlusSecurityChecker {
  constructor() {
    this.baseUrl = 'https://api.gopluslabs.io/api/v1';
    this.rateLimiter = new RateLimiter(200, 'day'); // 200/day free
  }
  
  async checkTokenSecurity(address, chain = '1') {
    await this.rateLimiter.wait();
    
    const response = await fetch(
      `${this.baseUrl}/token_security/${chain}?contract_addresses=${address}`
    );
    
    const data = await response.json();
    
    if (data.code !== 1) {
      throw new Error(`GoPlus API error: ${data.message}`);
    }
    
    return analyzeGoPlusSafety(data.result[address.toLowerCase()]);
  }
}
```

## Error Handling
- **Rate Limit**: Switch to backup security check or delay
- **API Down**: Use Quick Intel or honeypot.is backup  
- **Unknown Token**: Assume medium risk, proceed with caution

**CRITICAL: Never trade if GoPlus returns is_honeypot = "1"**