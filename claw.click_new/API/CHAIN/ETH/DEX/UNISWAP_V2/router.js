import { ethers } from 'ethers';

// Contract ABIs
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)'
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)'
];

/**
 * Uniswap V2 Router API for ETH
 * Handles quote generation and swap execution
 */
export class UniswapV2RouterAPI {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config || {
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    };
    
    this.router = new ethers.Contract(this.config.router, ROUTER_ABI, provider);
    this.factory = new ethers.Contract(this.config.factory, FACTORY_ABI, provider);
    
    // Caches
    this.pairCache = new Map();
    this.tokenCache = new Map();
  }

  /**
   * Get quote for token swap
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {string} amountIn - Input amount (in token units)
   * @returns {Object} Quote data
   */
  async getQuote(tokenIn, tokenOut, amountIn) {
    try {
      const path = await this.findOptimalPath(tokenIn, tokenOut);
      if (!path.success) {
        return { success: false, error: path.error };
      }

      const amountInBN = ethers.parseUnits(amountIn.toString(), 18);
      const amounts = await this.router.getAmountsOut(amountInBN, path.path);
      const amountOut = amounts[amounts.length - 1];
      
      // Calculate additional metrics
      const priceImpact = await this.calculatePriceImpact(path.path, amountInBN);
      const gasEstimate = this.estimateGas(path.path, amountInBN);
      
      return {
        success: true,
        path: path.path,
        amountIn: amountInBN.toString(),
        amountOut: amountOut.toString(),
        amountOutFormatted: ethers.formatUnits(amountOut, 18),
        priceImpact,
        gasEstimate,
        executionData: {
          tokenIn,
          tokenOut,
          path: path.path,
          router: this.config.router
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Quote failed: ${error.message}`
      };
    }
  }

  /**
   * Find optimal swap path between tokens
   * @param {string} tokenIn - Input token
   * @param {string} tokenOut - Output token  
   * @returns {Object} Path information
   */
  async findOptimalPath(tokenIn, tokenOut) {
    try {
      // Direct path first
      const directPairExists = await this.pairExists(tokenIn, tokenOut);
      if (directPairExists) {
        return {
          success: true,
          path: [tokenIn, tokenOut],
          hops: 1
        };
      }

      // Multi-hop via WETH
      const wethPath = [tokenIn, this.config.weth, tokenOut];
      const wethPath1Exists = await this.pairExists(tokenIn, this.config.weth);
      const wethPath2Exists = await this.pairExists(this.config.weth, tokenOut);
      
      if (wethPath1Exists && wethPath2Exists) {
        return {
          success: true,
          path: wethPath,
          hops: 2
        };
      }

      return {
        success: false,
        error: 'No valid path found'
      };
    } catch (error) {
      return {
        success: false,
        error: `Path finding failed: ${error.message}`
      };
    }
  }

  /**
   * Check if pair exists between two tokens
   * @param {string} tokenA - First token
   * @param {string} tokenB - Second token
   * @returns {boolean} Pair exists
   */
  async pairExists(tokenA, tokenB) {
    const cacheKey = [tokenA, tokenB].sort().join('-');
    
    if (this.pairCache.has(cacheKey)) {
      return this.pairCache.get(cacheKey) !== ethers.ZeroAddress;
    }

    try {
      const pairAddress = await this.factory.getPair(tokenA, tokenB);
      this.pairCache.set(cacheKey, pairAddress);
      return pairAddress !== ethers.ZeroAddress;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get pair reserves for liquidity analysis
   * @param {string} tokenA - First token
   * @param {string} tokenB - Second token
   * @returns {Object} Reserve data
   */
  async getPairReserves(tokenA, tokenB) {
    try {
      const pairAddress = await this.factory.getPair(tokenA, tokenB);
      if (pairAddress === ethers.ZeroAddress) {
        return { success: false, error: 'Pair does not exist' };
      }

      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserves, token0] = await Promise.all([
        pair.getReserves(),
        pair.token0()
      ]);

      const isToken0 = token0.toLowerCase() === tokenA.toLowerCase();
      
      return {
        success: true,
        pairAddress,
        reserveA: isToken0 ? reserves[0] : reserves[1],
        reserveB: isToken0 ? reserves[1] : reserves[0],
        blockTimestamp: reserves[2]
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate price impact for a swap
   * @param {Array} path - Swap path
   * @param {BigNumber} amountIn - Input amount
   * @returns {number} Price impact percentage
   */
  async calculatePriceImpact(path, amountIn) {
    if (path.length !== 2) return 0; // Skip for multi-hop

    try {
      const reserves = await this.getPairReserves(path[0], path[1]);
      if (!reserves.success) return 0;

      const { reserveA, reserveB } = reserves;
      
      // Uniswap V2 formula with 0.3% fee
      const amountInWithFee = amountIn * BigInt(997);
      const numerator = amountInWithFee * reserveB;
      const denominator = reserveA * BigInt(1000) + amountInWithFee;
      const amountOut = numerator / denominator;

      // Calculate price impact
      const spotPrice = Number(reserveB) / Number(reserveA);
      const effectivePrice = Number(amountOut) / Number(amountIn);
      
      return Math.abs((spotPrice - effectivePrice) / spotPrice);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Estimate gas for swap execution
   * @param {Array} path - Swap path
   * @param {BigNumber} amountIn - Input amount
   * @returns {number} Gas estimate
   */
  estimateGas(path, amountIn) {
    // Base estimates by swap type
    const baseGas = {
      ethToToken: 150000,   // ETH -> Token
      tokenToEth: 120000,   // Token -> ETH
      tokenToToken: 150000  // Token -> Token
    };

    // Add extra for multi-hop
    const hopPenalty = (path.length - 2) * 50000;
    
    if (path[0].toLowerCase() === this.config.weth.toLowerCase()) {
      return baseGas.ethToToken + hopPenalty;
    } else if (path[path.length - 1].toLowerCase() === this.config.weth.toLowerCase()) {
      return baseGas.tokenToEth + hopPenalty;
    } else {
      return baseGas.tokenToToken + hopPenalty;
    }
  }

  /**
   * Get token information
   * @param {string} address - Token address
   * @returns {Object} Token info
   */
  async getTokenInfo(address) {
    const cacheKey = address.toLowerCase();
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey);
    }

    try {
      const token = new ethers.Contract(address, ERC20_ABI, this.provider);
      const [decimals, symbol, name] = await Promise.all([
        token.decimals(),
        token.symbol(), 
        token.name()
      ]);

      const info = {
        success: true,
        address,
        decimals,
        symbol,
        name
      };

      this.tokenCache.set(cacheKey, info);
      return info;
    } catch (error) {
      return {
        success: false,
        error: `Failed to get token info: ${error.message}`
      };
    }
  }

  /**
   * Check token allowance for router
   * @param {string} tokenAddress - Token contract address
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Allowance data
   */
  async checkAllowance(tokenAddress, walletAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const allowance = await token.allowance(walletAddress, this.config.router);
      
      return {
        success: true,
        allowance: allowance.toString(),
        allowanceFormatted: ethers.formatUnits(allowance, 18),
        needsApproval: allowance === BigInt(0)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate approval transaction data
   * @param {string} tokenAddress - Token to approve
   * @param {string} amount - Amount to approve (or 'max')
   * @returns {Object} Approval transaction data
   */
  generateApprovalTx(tokenAddress, amount = 'max') {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI);
    const approvalAmount = amount === 'max' ? 
      ethers.MaxUint256 : 
      ethers.parseUnits(amount.toString(), 18);

    return {
      to: tokenAddress,
      data: token.interface.encodeFunctionData('approve', [
        this.config.router,
        approvalAmount
      ]),
      value: '0'
    };
  }

  /**
   * Generate swap transaction data
   * @param {Object} quoteData - Quote from getQuote()
   * @param {string} walletAddress - Recipient address
   * @param {number} slippageTolerance - Slippage % (e.g., 5 for 5%)
   * @param {number} deadlineMinutes - Deadline in minutes
   * @returns {Object} Swap transaction data
   */
  generateSwapTx(quoteData, walletAddress, slippageTolerance = 5, deadlineMinutes = 5) {
    if (!quoteData.success) {
      return { success: false, error: 'Invalid quote data' };
    }

    const { path, amountIn, amountOut } = quoteData;
    const slippageMultiplier = (100 - slippageTolerance) / 100;
    const minAmountOut = BigInt(Math.floor(Number(amountOut) * slippageMultiplier));
    const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);

    let functionName, args, value = '0';

    if (path[0].toLowerCase() === this.config.weth.toLowerCase()) {
      // ETH -> Token
      functionName = 'swapExactETHForTokens';
      args = [minAmountOut, path, walletAddress, deadline];
      value = amountIn;
    } else if (path[path.length - 1].toLowerCase() === this.config.weth.toLowerCase()) {
      // Token -> ETH  
      functionName = 'swapExactTokensForETH';
      args = [amountIn, minAmountOut, path, walletAddress, deadline];
    } else {
      // Token -> Token
      functionName = 'swapExactTokensForTokens';
      args = [amountIn, minAmountOut, path, walletAddress, deadline];
    }

    return {
      success: true,
      to: this.config.router,
      data: this.router.interface.encodeFunctionData(functionName, args),
      value,
      gasLimit: quoteData.gasEstimate.toString(),
      swapDetails: {
        path,
        amountIn,
        minAmountOut: minAmountOut.toString(),
        slippageTolerance,
        deadline
      }
    };
  }

  /**
   * Get liquidity data for a pair
   * @param {string} tokenA - First token
   * @param {string} tokenB - Second token  
   * @returns {Object} Liquidity information
   */
  async getLiquidityData(tokenA, tokenB) {
    try {
      const reserves = await this.getPairReserves(tokenA, tokenB);
      if (!reserves.success) {
        return reserves;
      }

      const tokenAInfo = await this.getTokenInfo(tokenA);
      const tokenBInfo = await this.getTokenInfo(tokenB);

      return {
        success: true,
        pair: reserves.pairAddress,
        reserves: {
          tokenA: {
            address: tokenA,
            symbol: tokenAInfo.symbol || 'Unknown',
            reserve: reserves.reserveA.toString(),
            reserveFormatted: ethers.formatUnits(reserves.reserveA, tokenAInfo.decimals || 18)
          },
          tokenB: {
            address: tokenB,
            symbol: tokenBInfo.symbol || 'Unknown',
            reserve: reserves.reserveB.toString(), 
            reserveFormatted: ethers.formatUnits(reserves.reserveB, tokenBInfo.decimals || 18)
          }
        },
        lastUpdate: reserves.blockTimestamp
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  clearCache() {
    this.pairCache.clear();
    this.tokenCache.clear();
  }
}

// Chain configurations
export const UNISWAP_V2_CONFIGS = {
  ethereum: {
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  },
  base: {
    router: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    factory: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6', 
    weth: '0x4200000000000000000000000000000000000006'
  }
};

// Factory function for easy instantiation
export function createUniswapV2Router(provider, chainName = 'ethereum') {
  const config = UNISWAP_V2_CONFIGS[chainName];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainName}`);
  }
  return new UniswapV2RouterAPI(provider, config);
}

export default UniswapV2RouterAPI;