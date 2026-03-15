# Uniswap V2 Router - Ethereum
**Status: FREE** 🆓 (on-chain calls only, gas costs apply)

## Contract Addresses
- **Router**: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
- **Factory**: `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`
- **WETH**: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`

## Router Interface
```solidity
interface IUniswapV2Router02 {
    // SWAP FUNCTIONS
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    // QUOTE FUNCTIONS
    function getAmountsOut(uint amountIn, address[] calldata path)
        external view returns (uint[] memory amounts);
        
    function getAmountsIn(uint amountOut, address[] calldata path)
        external view returns (uint[] memory amounts);

    // UTILITY
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
}
```

## Factory & Pair Interface  
```solidity
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) 
        external view returns (address pair);
}

interface IUniswapV2Pair {
    function getReserves() external view 
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function totalSupply() external view returns (uint256);
}
```

## Integration Code
```javascript
class UniswapV2Router {
  constructor(provider, routerAddress) {
    this.router = new Contract(routerAddress, RouterABI, provider);
    this.factory = new Contract(FACTORY_ADDRESS, FactoryABI, provider);
    this.WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  }

  // Get best quote for swap
  async getQuote(tokenIn, tokenOut, amountIn) {
    const path = this.buildPath(tokenIn, tokenOut);
    
    try {
      const amounts = await this.router.getAmountsOut(amountIn, path);
      return {
        path,
        amountIn,
        amountOut: amounts[amounts.length - 1],
        priceImpact: await this.calculatePriceImpact(path, amountIn),
        valid: true
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // Build optimal swap path  
  buildPath(tokenIn, tokenOut) {
    // Direct path first
    if (await this.pairExists(tokenIn, tokenOut)) {
      return [tokenIn, tokenOut];
    }
    
    // Via WETH
    if (tokenIn !== this.WETH && tokenOut !== this.WETH) {
      return [tokenIn, this.WETH, tokenOut];
    }
    
    throw new Error('No valid path found');
  }

  // Check if pair exists
  async pairExists(tokenA, tokenB) {
    const pairAddress = await this.factory.getPair(tokenA, tokenB);
    return pairAddress !== '0x0000000000000000000000000000000000000000';
  }

  // Execute swap
  async executeSwap(tokenIn, tokenOut, amountIn, minAmountOut, wallet) {
    const path = this.buildPath(tokenIn, tokenOut);
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

    let tx;
    
    if (tokenIn === this.WETH) {
      // ETH -> Token
      tx = await this.router.connect(wallet).swapExactETHForTokens(
        minAmountOut,
        path,
        wallet.address,
        deadline,
        { value: amountIn }
      );
    } else if (tokenOut === this.WETH) {
      // Token -> ETH
      tx = await this.router.connect(wallet).swapExactTokensForETH(
        amountIn,
        minAmountOut,
        path,
        wallet.address,
        deadline
      );
    } else {
      // Token -> Token
      tx = await this.router.connect(wallet).swapExactTokensForTokens(
        amountIn,
        minAmountOut,
        path,
        wallet.address,
        deadline
      );
    }

    return tx;
  }

  // Calculate price impact
  async calculatePriceImpact(path, amountIn) {
    if (path.length !== 2) return 0; // Skip for multi-hop
    
    const pairAddress = await this.factory.getPair(path[0], path[1]);
    const pair = new Contract(pairAddress, PairABI, this.router.provider);
    
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();
    
    const [reserveIn, reserveOut] = token0 === path[0] 
      ? [reserve0, reserve1] 
      : [reserve1, reserve0];
      
    // Calculate price impact using constant product formula
    const amountInWithFee = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    const amountOut = numerator.div(denominator);
    
    const spotPrice = reserveOut.div(reserveIn);
    const effectivePrice = amountOut.div(amountIn);
    const priceImpact = spotPrice.sub(effectivePrice).div(spotPrice);
    
    return priceImpact.toNumber();
  }
}
```

## Gas Estimates
```javascript
const gasEstimates = {
  'swapExactETHForTokens': 150000,        // ETH -> Token
  'swapExactTokensForETH': 120000,        // Token -> ETH  
  'swapExactTokensForTokens': 150000,     // Token -> Token
  'approval': 45000                       // Token approval
};
```

## Usage Example
```javascript
const router = new UniswapV2Router(provider, ROUTER_ADDRESS);

// Get quote
const quote = await router.getQuote(USDC, TOKEN, parseEther('1000'));

// Execute if good
if (quote.valid && quote.priceImpact < 0.05) { // <5% impact
  const minOut = quote.amountOut.mul(95).div(100); // 5% slippage
  await router.executeSwap(USDC, TOKEN, parseEther('1000'), minOut, wallet);
}
```

**Next: Create Uniswap V3 and V4 configs**