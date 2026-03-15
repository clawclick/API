# ETH Gas Tracking
**Status: FREE** 🆓 + PAID options

## Primary Gas APIs

### 1. ETH Gas Station API (Free)
**Endpoint**: `https://ethgasstation.info/api/ethgasAPI.json`
```json
{
  "safeLow": 100,    // Safe low gas price (gwei)
  "standard": 120,   // Standard gas price 
  "fast": 150,       // Fast gas price
  "fastest": 200     // Fastest gas price
}
```

### 2. Alchemy Gas API (Paid - included)
**Endpoint**: Via Alchemy RPC `eth_gasPrice` and `eth_feeHistory`
```javascript
const gasPrice = await provider.getGasPrice();
const feeData = await provider.getFeeData();
```

### 3. GasNow API (Free)
**Endpoint**: `https://www.gasnow.org/api/v3/gas/price`
```json
{
  "rapid": 150000000000,
  "fast": 120000000000, 
  "standard": 100000000000,
  "slow": 80000000000
}
```

## Gas Strategy
```javascript
const gasStrategy = {
  economy: 'safeLow',     // Patient fills
  standard: 'standard',   // Normal speed
  rush: 'fast',          // Quick execution
  emergency: 'fastest'    // Immediate execution
};

// Max gas we'll pay (% of trade value)
const maxGasPercent = {
  economy: 1.0,    // 1% max
  standard: 2.0,   // 2% max  
  rush: 3.0,       // 3% max
  emergency: 5.0   // 5% max
};
```

## Gas Monitoring
- Track average gas over 1h, 24h
- Alert if gas >100 gwei for >30min
- Skip trades if gas cost >2% of trade value
- Use BASE/BSC alternatives when ETH gas too high