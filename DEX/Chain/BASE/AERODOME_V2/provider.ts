// DOCS: https://aerodrome.finance/docs (Aerodrome V2 – via TheGraph subgraph)

import { getRequiredEnv } from "#config/env";
import { requestJson } from "#lib/http";
import {
  type UnsignedSwapTx,
  type SwapParams,
  EVM_CHAIN_IDS,
  WRAPPED_NATIVE,
  isNativeIn,
  padAddress,
  encodeUint256,
  buildCalldata,
  selector,
  applySlippage,
  defaultDeadline,
} from "#lib/evm";

const CHAIN_ID = EVM_CHAIN_IDS.base;

/**
 * Aerodrome Router on Base.
 * swapExactTokensForTokens / swapExactETHForTokens follow the
 * same Solidly-fork interface as Velodrome.
 */
const ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";

type AerodromePool = {
  id?: string;
  volumeUSD?: string;
  totalValueLockedUSD?: string;
};

type AerodromeSubgraphResponse = {
  data?: {
    pools?: AerodromePool[];
  };
  errors?: Array<{ message?: string }>;
};

const AERODROME_SUBGRAPH = "https://api.studio.thegraph.com/query/86556/aerodrome-slipstream/version/latest";

/** POST subgraph – get pools containing a given token on Aerodrome V2 (Base). No auth required. */
export async function getPoolsByToken(tokenAddress: string, first = 5): Promise<AerodromeSubgraphResponse> {
  const query = `query AerodromePools($token: String!, $first: Int!) {
  pools(first: $first, where: { token0_: { id: $token } }) {
    id
    volumeUSD
    totalValueLockedUSD
  }
}`;

  return requestJson<AerodromeSubgraphResponse>(AERODROME_SUBGRAPH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { token: tokenAddress.toLowerCase(), first } }),
  });
}

/* ── Swap TX builders ─────────────────────────────────────── */

async function getAmountsOut(amountIn: bigint, routes: Array<{ from: string; to: string; stable: boolean }>): Promise<bigint> {
  const rpcUrl = getRequiredEnv("BASE_RPC_URL");

  // getAmountsOut(uint256,(address,address,bool)[])  selector: 0xd06ca61f (overloaded)
  // Aerodrome uses struct routes instead of address[] path.
  // We call a simpler single-route pattern via eth_call.
  // For Aerodrome V2 router: getAmountsOut(uint256, Route[])
  // Route = (address from, address to, bool stable, address factory)
  // selector: 0x99209ee1
  const factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"; // Aerodrome pool factory
  const amountWord = encodeUint256(amountIn);
  const offsetWord = encodeUint256(64n);
  const lengthWord = encodeUint256(BigInt(routes.length));
  const routeWords = routes
    .map((r) =>
      padAddress(r.from) +
      padAddress(r.to) +
      encodeUint256(r.stable ? 1n : 0n) +
      padAddress(factory)
    )
    .join("");

  const data = buildCalldata(
    selector("99209ee1"),
    amountWord,
    offsetWord,
    lengthWord,
    routeWords,
  );

  const result = await requestJson<{ result?: string }>(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: ROUTER, data }, "latest"],
    }),
  });

  if (!result.result || result.result === "0x") {
    throw new Error("Aerodrome getAmountsOut returned empty – pair may not exist");
  }

  const hex = result.result.replace(/^0x/, "");
  const lastWord = hex.slice(-64);
  return BigInt("0x" + lastWord);
}

/**
 * Build unsigned swap TX for Aerodrome V2.
 *
 * swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin,
 *   Route[] routes, address to, uint256 deadline)
 * selector: 0x8af416f6
 *
 * swapExactETHForTokens(uint256 amountOutMin, Route[] routes,
 *   address to, uint256 deadline)
 * selector: 0xb6f9de95 (payable)
 */
export async function buildSwapTx(params: SwapParams, stable = false): Promise<UnsignedSwapTx> {
  const { walletAddress, tokenIn, tokenOut, amountIn, slippageBps, deadline } = params;
  const dl = defaultDeadline(deadline);
  const amtIn = BigInt(amountIn);
  const nativeIn = isNativeIn(tokenIn);
  const weth = WRAPPED_NATIVE.base;
  const actualIn = nativeIn ? weth : tokenIn;

  const routes = [{ from: actualIn, to: tokenOut, stable }];
  const amountOut = await getAmountsOut(amtIn, routes);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  const factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
  const routeWords =
    padAddress(actualIn) +
    padAddress(tokenOut) +
    encodeUint256(stable ? 1n : 0n) +
    padAddress(factory);

  if (nativeIn) {
    const calldata = buildCalldata(
      selector("b6f9de95"),
      encodeUint256(amountOutMin),
      encodeUint256(160n),               // offset to routes
      padAddress(walletAddress),
      encodeUint256(BigInt(dl)),
      encodeUint256(1n),                 // routes length
      routeWords,
    );
    return {
      to: ROUTER,
      data: calldata,
      value: "0x" + amtIn.toString(16),
      chainId: CHAIN_ID,
      from: walletAddress,
    };
  }

  const calldata = buildCalldata(
    selector("8af416f6"),
    encodeUint256(amtIn),
    encodeUint256(amountOutMin),
    encodeUint256(192n),               // offset to routes
    padAddress(walletAddress),
    encodeUint256(BigInt(dl)),
    encodeUint256(1n),
    routeWords,
  );

  return {
    to: ROUTER,
    data: calldata,
    value: "0x0",
    chainId: CHAIN_ID,
    from: walletAddress,
  };
}

/** Quote for Aerodrome V2 swap. */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippageBps: number,
  stable = false,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const weth = WRAPPED_NATIVE.base;
  const actualIn = isNativeIn(tokenIn) ? weth : tokenIn;
  const routes = [{ from: actualIn, to: tokenOut, stable }];
  const out = await getAmountsOut(BigInt(amountIn), routes);
  return {
    amountOut: out.toString(),
    amountOutMin: applySlippage(out, slippageBps).toString(),
  };
}
