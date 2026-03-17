/**
 * Smoke-test: call buildSwapTx / getQuote for every DEX provider
 * and verify each returns a properly-shaped unsigned transaction.
 *
 * Run: npx tsx test-swap.ts
 */

import { config } from "dotenv";
config();

// Override placeholder RPC URLs with free public endpoints for testing
process.env.ETH_RPC_URL = "https://eth.llamarpc.com";
process.env.BASE_RPC_URL = "https://mainnet.base.org";
process.env.BSC_RPC_URL = "https://bsc-dataseed1.binance.org";
process.env.SOL_RPC_URL = "https://api.mainnet-beta.solana.com";

/* ── Well-known addresses for test swaps ───────────────────── */

const TEST_WALLET_EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
const TEST_WALLET_SOL = "JDrYBZgemgu8FQGewojGhUXHjRhBeDEg6Mhm2DREsLUb";

// ETH mainnet tokens
const WETH  = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Base tokens
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDbC_BASE = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"; // bridged USDC (Aerodrome V2 pair)

// BSC tokens
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

// SOL tokens
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* ── Test runner ──────────────────────────────────────────── */

type TestResult = {
  provider: string;
  chain: string;
  status: "PASS" | "FAIL";
  details: string;
};

const results: TestResult[] = [];
const SMALL_ETH = "10000000000000"; // 0.00001 ETH in wei
const SMALL_SOL = "100000";         // 0.0001 SOL in lamports
const SLIPPAGE = 500;               // 5% to avoid slippage failures on tiny amounts

async function testProvider(
  name: string,
  chain: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await fn();
    const json = JSON.stringify(result, null, 2);

    // Validate shape
    const obj = result as Record<string, unknown>;
    if (chain === "solana") {
      if (!obj.serializedTx || obj.chainId !== "solana" || !obj.from) {
        results.push({ provider: name, chain, status: "FAIL", details: `Bad shape: ${json.slice(0, 200)}` });
        return;
      }
    } else {
      if (!obj.to || !obj.data || obj.chainId === undefined || !obj.from) {
        results.push({ provider: name, chain, status: "FAIL", details: `Bad shape: ${json.slice(0, 200)}` });
        return;
      }
      // Check chainId is a number
      if (typeof obj.chainId !== "number") {
        results.push({ provider: name, chain, status: "FAIL", details: `chainId not a number: ${obj.chainId}` });
        return;
      }
    }

    results.push({ provider: name, chain, status: "PASS", details: json.slice(0, 300) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ provider: name, chain, status: "FAIL", details: msg.slice(0, 300) });
  }
}

async function main() {
  console.log("=== DEX Swap Provider Smoke Tests ===\n");

  // ── ETH Uniswap V2 ──
  const ethV2 = await import("./DEX/Chain/ETH/UNISWAP_V2/provider.ts");
  await testProvider("ETH Uniswap V2", "eth (1)", () =>
    ethV2.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH,
      tokenOut: USDC_ETH,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── ETH Uniswap V3 ──
  const ethV3 = await import("./DEX/Chain/ETH/UNISWAP_V3/provider.ts");
  await testProvider("ETH Uniswap V3", "eth (1)", () =>
    ethV3.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH,
      tokenOut: USDC_ETH,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── ETH Uniswap V4 ──
  const ethV4 = await import("./DEX/Chain/ETH/UNISWAP_V4/provider.ts");
  await testProvider("ETH Uniswap V4", "eth (1)", () =>
    ethV4.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH,
      tokenOut: USDC_ETH,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BASE Uniswap V2 ──
  const baseV2 = await import("./DEX/Chain/BASE/UNISWAP_V2/provider.ts");
  await testProvider("BASE Uniswap V2", "base (8453)", () =>
    baseV2.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH_BASE,
      tokenOut: USDC_BASE,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BASE Uniswap V3 ──
  const baseV3 = await import("./DEX/Chain/BASE/UNISWAP_V3/provider.ts");
  await testProvider("BASE Uniswap V3", "base (8453)", () =>
    baseV3.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH_BASE,
      tokenOut: USDC_BASE,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BASE Uniswap V4 ──
  const baseV4 = await import("./DEX/Chain/BASE/UNISWAP_V4/provider.ts");
  await testProvider("BASE Uniswap V4", "base (8453)", () =>
    baseV4.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH_BASE,
      tokenOut: USDC_BASE,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BASE Aerodrome V2 ──
  const aero = await import("./DEX/Chain/BASE/AERODOME_V2/provider.ts");
  await testProvider("BASE Aerodrome V2", "base (8453)", () =>
    aero.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WETH_BASE,
      tokenOut: USDbC_BASE,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BSC PancakeSwap V2 ──
  const bscV2 = await import("./DEX/Chain/BSC/PANCAKESWAP_V2/provider.ts");
  await testProvider("BSC PancakeSwap V2", "bsc (56)", () =>
    bscV2.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WBNB,
      tokenOut: USDT_BSC,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── BSC PancakeSwap V3 ──
  const bscV3 = await import("./DEX/Chain/BSC/PANCAKESWAP_V3/provider.ts");
  await testProvider("BSC PancakeSwap V3", "bsc (56)", () =>
    bscV3.buildSwapTx({
      walletAddress: TEST_WALLET_EVM,
      tokenIn: WBNB,
      tokenOut: USDT_BSC,
      amountIn: SMALL_ETH,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── SOL Raydium ──
  const raydium = await import("./DEX/Chain/SOL/RADYUM/provider.ts");
  await testProvider("SOL Raydium", "solana", () =>
    raydium.buildSwapTx({
      walletAddress: TEST_WALLET_SOL,
      tokenIn: SOL_MINT,
      tokenOut: USDC_SOL,
      amountIn: SMALL_SOL,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── SOL Meteora ──
  const meteora = await import("./DEX/Chain/SOL/METEORA/provider.ts");
  await testProvider("SOL Meteora", "solana", () =>
    meteora.buildSwapTx({
      walletAddress: TEST_WALLET_SOL,
      tokenIn: SOL_MINT,
      tokenOut: USDC_SOL,
      amountIn: SMALL_SOL,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── SOL PumpDex ──
  const pumpDex = await import("./DEX/Chain/SOL/PUMPDEX/provider.ts");
  await testProvider("SOL PumpDex", "solana", () =>
    pumpDex.buildSwapTx({
      walletAddress: TEST_WALLET_SOL,
      tokenIn: SOL_MINT,
      tokenOut: USDC_SOL,
      amountIn: SMALL_SOL,
      slippageBps: SLIPPAGE,
    }),
  );

  // ── Print results ──
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS:");
  console.log("=".repeat(70));

  const passed = results.filter((r) => r.status === "PASS");
  const failed = results.filter((r) => r.status === "FAIL");

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`\n${icon} ${r.provider} [${r.chain}] — ${r.status}`);
    if (r.status === "PASS") {
      console.log(`   TX preview: ${r.details.slice(0, 150)}...`);
    } else {
      console.log(`   Error: ${r.details}`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);
  console.log("=".repeat(70));

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
