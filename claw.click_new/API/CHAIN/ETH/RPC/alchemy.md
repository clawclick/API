# Alchemy RPC - Ethereum
**Status: PAID** 💰 (Free tier: 300M compute units/month)

## Endpoints
- **Mainnet**: `https://eth-mainnet.g.alchemy.com/v2/{API_KEY}`
- **WebSocket**: `wss://eth-mainnet.g.alchemy.com/v2/{API_KEY}`

## Features We Need
- ✅ Standard JSON-RPC calls
- ✅ Transaction simulation (`eth_call`)
- ✅ Gas price estimation
- ✅ Block/transaction data
- ✅ Contract interactions
- ✅ WebSocket for real-time updates

## Rate Limits
- **Free**: 300M compute units/month (~100k requests)
- **Growth**: $49/month - 3B compute units
- **Scale**: $199/month - 15B compute units

## Configuration
```javascript
const provider = new JsonRpcProvider(
  `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
);

const wsProvider = new WebSocketProvider(
  `wss://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
);
```

## Backup RPCs (Free)
- **Ankr**: `https://rpc.ankr.com/eth` (Rate limited)
- **Public**: `https://ethereum.publicnode.com` (Rate limited)