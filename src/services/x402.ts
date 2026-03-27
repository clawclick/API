import type { FastifyReply, FastifyRequest } from "fastify";
import { HTTPFacilitatorClient as X402HTTPFacilitatorClient, type HTTPAdapter as X402HTTPAdapter, x402HTTPResourceServer as X402HTTPResourceServer, type HTTPRequestContext as X402HTTPRequestContext, type HTTPResponseInstructions as X402HTTPResponseInstructions, type RoutesConfig as X402RoutesConfig, x402ResourceServer as X402ResourceServer } from "@x402/core/server";
import type { Network as X402Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { getOptionalEnv, isConfigured } from "#config/env";

export type X402Mode = "testnet" | "mainnet";
export type X402Method = "GET" | "POST";
export type X402RouteTier = "starter" | "standard" | "premium";
export type X402SchemeKey = "exact-evm" | "exact-svm";
export type X402AccessPolicy = "payment_required" | "payment_fallback";
export type X402RouteFamily = "pilot" | "cheap" | "codex" | "nansen" | "x" | "core";

export type X402ImportTarget = {
  importPath: string;
  exportName: string;
};

export type X402SchemeDescriptor = {
  key: X402SchemeKey;
  scheme: "exact";
  family: "evm" | "svm";
  importTarget: X402ImportTarget;
  registerNetwork: string;
};

export type X402SdkDescriptor = {
  facilitatorClient: X402ImportTarget;
  resourceServer: X402ImportTarget;
  supportedSchemes: readonly X402SchemeDescriptor[];
};

export type X402PaymentOption = {
  scheme: "exact";
  price: string;
  network: string;
  payTo: string;
};

export type X402BazaarExtension = {
  discoverable: true;
  category: string;
  tags: string[];
};

export type X402RouteExtensions = {
  bazaar: X402BazaarExtension;
};

export type X402RouteConfig = {
  accepts: X402PaymentOption[];
  description: string;
  mimeType: string;
  extensions?: X402RouteExtensions;
};

export type X402PaidRouteSpec = {
  routeId: `${X402Method} ${string}`;
  method: X402Method;
  path: string;
  endpointName: string;
  family: X402RouteFamily;
  accessPolicy: X402AccessPolicy;
  priceUsd: string;
  description: string;
  mimeType: string;
  tier: X402RouteTier;
  rolloutPhase: 1 | 2 | 3;
  rationale: string;
};

export type X402ResolvedConfig = {
  enabled: boolean;
  ready: boolean;
  mode: X402Mode;
  rolloutPhase: 1 | 2 | 3;
  facilitatorUrl: string;
  sdk: X402SdkDescriptor;
  networks: {
    evm: {
      network: X402Network;
      payTo: string;
      configured: boolean;
      scheme: "exact";
    };
    svm: {
      network: X402Network;
      payTo: string;
      configured: boolean;
      scheme: "exact";
    };
  };
  routeSpecs: X402PaidRouteSpec[];
  requiredRouteSpecs: X402PaidRouteSpec[];
  fallbackRouteSpecs: X402PaidRouteSpec[];
  routeConfigMap: Record<string, X402RouteConfig>;
};

export type X402VerifiedRequest = {
  routeId: string;
  routePattern: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  declaredExtensions?: Record<string, unknown>;
};

type X402Runtime = {
  signature: string;
  config: X402ResolvedConfig;
  facilitatorClient: X402HTTPFacilitatorClient;
  resourceServer: X402ResourceServer;
  httpServer: X402HTTPResourceServer;
};

type X402RequestHandlingResult = {
  handled: boolean;
  verifiedRequest?: X402VerifiedRequest;
};

const X402_TESTNET = {
  facilitatorUrl: "https://x402.org/facilitator",
  evmNetwork: "eip155:84532",
  svmNetwork: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

const X402_MAINNET = {
  facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
  evmNetwork: "eip155:8453",
  svmNetwork: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;

let x402RuntimePromise: Promise<X402Runtime> | null = null;
let x402RuntimeSignature: string | null = null;
const X402_LEARN_MORE_URL = "claw.click/api";

export const x402SdkDescriptor: X402SdkDescriptor = {
  facilitatorClient: {
    importPath: "@x402/core/server",
    exportName: "HTTPFacilitatorClient",
  },
  resourceServer: {
    importPath: "@x402/core/server",
    exportName: "x402ResourceServer",
  },
  supportedSchemes: [
    {
      key: "exact-evm",
      scheme: "exact",
      family: "evm",
      importTarget: {
        importPath: "@x402/evm/exact/server",
        exportName: "ExactEvmScheme",
      },
      registerNetwork: "configured-base-network",
    },
    {
      key: "exact-svm",
      scheme: "exact",
      family: "svm",
      importTarget: {
        importPath: "@x402/svm/exact/server",
        exportName: "ExactSvmScheme",
      },
      registerNetwork: "configured-solana-network",
    },
  ],
};

// Best-effort upstream cost model as of 2026-03-24.
// Published self-serve request/CU pricing is marked up by 30%.
// Public/free-provider and local-only routes use a $0.0001 billing floor.
export const x402PaidRouteCatalog: readonly X402PaidRouteSpec[] = [
  {
    routeId: "GET /holderAnalysis",
    method: "GET",
    path: "/holderAnalysis",
    endpointName: "holderAnalysis",
    family: "pilot",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0037",
    description: "Holder concentration and whale distribution analysis",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Pilot the x402 flow on one valuable read route before broad rollout.",
  },
  {
    routeId: "GET /tokenPriceHistory",
    method: "GET",
    path: "/tokenPriceHistory",
    endpointName: "tokenPriceHistory",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Historical OHLCV price data for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Core research route available by API key or x402 overflow.",
  },
  {
    routeId: "GET /tokenPoolInfo",
    method: "GET",
    path: "/tokenPoolInfo",
    endpointName: "tokenPoolInfo",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Token price, liquidity, volume, market cap, and primary pool details",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Cheap route that can stay free for API-key holders until they exceed limits.",
  },
  {
    routeId: "GET /marketOverview",
    method: "GET",
    path: "/marketOverview",
    endpointName: "marketOverview",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0070",
    description: "Combined market, sentiment, and risk overview for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Useful entry-tier route that can flip to x402 when API-key access is unavailable.",
  },
  {
    routeId: "GET /isScam",
    method: "GET",
    path: "/isScam",
    endpointName: "isScam",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Fast risk screen for a token or contract",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Good low-cost fallback route when a caller has no key or is over free usage.",
  },
  {
    routeId: "GET /tokenSearch",
    method: "GET",
    path: "/tokenSearch",
    endpointName: "tokenSearch",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Search tokens by name, symbol, or address",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Natural fallback route for no-key and over-limit traffic.",
  },
  {
    routeId: "GET /detailedTokenStats",
    method: "GET",
    path: "/detailedTokenStats",
    endpointName: "detailedTokenStats",
    family: "codex",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0005",
    description: "Token statistics across recent time windows",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Core Codex-backed route that should be part of the paid analytics bundle.",
  },
  {
    routeId: "GET /priceHistoryIndicators",
    method: "GET",
    path: "/priceHistoryIndicators",
    endpointName: "priceHistoryIndicators",
    family: "codex",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Historical price data with technical indicators and aggregate signal",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Computed Codex-style signal endpoint that fits direct payment gating.",
  },
  {
    routeId: "GET /rateMyEntry",
    method: "GET",
    path: "/rateMyEntry",
    endpointName: "rateMyEntry",
    family: "codex",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0018",
    description: "Swing-trade entry score with levels, momentum, and risk checks",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "High-signal derived endpoint that works well as a paid research action.",
  },
  {
    routeId: "GET /filterTokens",
    method: "GET",
    path: "/filterTokens",
    endpointName: "filterTokens",
    family: "codex",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0005",
    description: "Filter tokens by market and performance metrics",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Primary Codex screening route and a natural paid query surface.",
  },
  {
    routeId: "GET /volatilityScanner",
    method: "GET",
    path: "/volatilityScanner",
    endpointName: "volatilityScanner",
    family: "codex",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0096",
    description: "Volatility scan for swing-trade opportunities",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Distinct Codex-style scan endpoint that belongs in the paid analytics set.",
  },
  {
    routeId: "GET /fullAudit",
    method: "GET",
    path: "/fullAudit",
    endpointName: "fullAudit",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Deep token audit including taxes, ownership, and trading flags",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Higher-cost risk route available as x402 overflow.",
  },
  {
    routeId: "GET /holders",
    method: "GET",
    path: "/holders",
    endpointName: "holders",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0032",
    description: "Top holder rows for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Useful on-demand holder lookup with pay-per-request fallback.",
  },
  {
    routeId: "GET /fudSearch",
    method: "GET",
    path: "/fudSearch",
    endpointName: "fudSearch",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0065",
    description: "Search social mentions for FUD signals",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Social sentiment endpoint available to continue after API-key limits.",
  },
  {
    routeId: "GET /walletReview",
    method: "GET",
    path: "/walletReview",
    endpointName: "walletReview",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0132",
    description: "Comprehensive wallet review covering holdings, activity, and approvals",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 1,
    rationale: "High-value wallet route that should remain accessible via x402 overflow.",
  },
  {
    routeId: "GET /pnl",
    method: "GET",
    path: "/pnl",
    endpointName: "pnl",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0007",
    description: "Wallet profit and loss summary by chain",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Common wallet analytics route for free-or-pay access.",
  },
 
  {
    routeId: "GET /xSearch",
    method: "GET",
    path: "/xSearch",
    endpointName: "xSearch",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0033",
    description: "Search recent X posts for token or topic intelligence",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Core X intelligence endpoint and an obvious paid agent action.",
  },
  {
    routeId: "GET /xCountRecent",
    method: "GET",
    path: "/xCountRecent",
    endpointName: "xCountRecent",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0019",
    description: "Count recent X posts for a query",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Complements X search and belongs in the same paid social intelligence surface.",
  },
  {
    routeId: "GET /xUserByUsername",
    method: "GET",
    path: "/xUserByUsername",
    endpointName: "xUserByUsername",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Look up an X user profile by username",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Useful profile primitive for agents working across social endpoints.",
  },
  {
    routeId: "GET /xUserLikes",
    method: "GET",
    path: "/xUserLikes",
    endpointName: "xUserLikes",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0039",
    description: "Get liked X posts for a user",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Deeper social graph query that should sit behind x402 from launch.",
  },
  {
    routeId: "GET /xUserFollowers",
    method: "GET",
    path: "/xUserFollowers",
    endpointName: "xUserFollowers",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0039",
    description: "Get followers for an X user",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "High-value social graph lookup that fits the paid X bundle.",
  },
  {
    routeId: "GET /xKolVolume",
    method: "GET",
    path: "/xKolVolume",
    endpointName: "xKolVolume",
    family: "x",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0049",
    description: "Analyze token volume and price movement around an X post",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Combines X lookup and token market history, so it belongs in the paid social intelligence bundle.",
  },
  {
    routeId: "POST /tokenScreener",
    method: "POST",
    path: "/tokenScreener",
    endpointName: "tokenScreener",
    family: "nansen",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Token screening by smart-money flow, liquidity, volume, and age",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 1,
    rationale: "Primary Nansen analytics route and a strong paid workflow candidate.",
  },
  {
    routeId: "POST /addressRelatedWallets",
    method: "POST",
    path: "/addressRelatedWallets",
    endpointName: "addressRelatedWallets",
    family: "nansen",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Related wallets for an address with linked activity details",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 1,
    rationale: "High-value Nansen investigation route that should be paid from launch.",
  },
  {
    routeId: "POST /jupiterDcas",
    method: "POST",
    path: "/jupiterDcas",
    endpointName: "jupiterDcas",
    family: "nansen",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0013",
    description: "Active dollar-cost-averaging orders for a token",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 1,
    rationale: "Premium Nansen route with clear external cost and value.",
  },
  {
    routeId: "POST /smartMoneyNetflow",
    method: "POST",
    path: "/smartMoneyNetflow",
    endpointName: "smartMoneyNetflow",
    family: "nansen",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0065",
    description: "Smart-money inflow and outflow analytics across chains",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 1,
    rationale: "High-signal Nansen route that belongs in the paid launch set.",
  },
  {
    routeId: "GET /trendingTokens",
    method: "GET",
    path: "/trendingTokens",
    endpointName: "trendingTokens",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Trending tokens with momentum and discovery signals",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Discovery route that stays reachable when API-key access is unavailable.",
  },
  {
    routeId: "GET /getTopEthTokens",
    method: "GET",
    path: "/getTopEthTokens",
    endpointName: "getTopEthTokens",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Top Ethereum tokens ranked by market activity",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Simple market listing route available behind free-or-pay access.",
  },
  {
    routeId: "GET /getNewEthTradableTokens",
    method: "GET",
    path: "/getNewEthTradableTokens",
    endpointName: "getNewEthTradableTokens",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Newly tradable Ethereum tokens",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Discovery listing route available via x402 overflow.",
  },
  {
    routeId: "GET /newPairs",
    method: "GET",
    path: "/newPairs",
    endpointName: "newPairs",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Recently created token pairs and pools",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Fresh-discovery route that should stay accessible after API-key limits.",
  },
  {
    routeId: "GET /topTraders",
    method: "GET",
    path: "/topTraders",
    endpointName: "topTraders",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0004",
    description: "Top trader wallets and activity for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Research-heavy route that can continue via pay-per-request.",
  },
  {
    routeId: "GET /gasFeed",
    method: "GET",
    path: "/gasFeed",
    endpointName: "gasFeed",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Current gas prices and fee estimates for supported EVM chains",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Utility endpoint available via x402 fallback.",
  },
  {
    routeId: "GET /tokenHolders",
    method: "GET",
    path: "/tokenHolders",
    endpointName: "tokenHolders",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0006",
    description: "Raw token-holder ledger for EVM and Solana tokens",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Detailed ledger route available for continued paid access.",
  },
  {
    routeId: "GET /strats/:id",
    method: "GET",
    path: "/strats/:id",
    endpointName: "strats/:id",
    family: "core",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.0001",
    description: "Fetch a specific strategy guide",
    mimeType: "text/markdown",
    tier: "starter",
    rolloutPhase: 1,
    rationale: "Content route available when clients want to continue beyond API-key access.",
  },
] as const;

function normalizeMode(value: string): X402Mode {
  return value.toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

function normalizeRolloutPhase(value: string): 1 | 2 | 3 {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 2 || parsed === 3) {
    return parsed;
  }
  return 1;
}

function getModeDefaults(mode: X402Mode) {
  return mode === "mainnet" ? X402_MAINNET : X402_TESTNET;
}

function getConfiguredBaseNetwork(defaultNetwork: X402Network): X402Network {
  return getOptionalEnv("X402_BASE_NETWORK", getOptionalEnv("X402_EVM_NETWORK", defaultNetwork)) as X402Network;
}

function getConfiguredSolanaNetwork(defaultNetwork: X402Network): X402Network {
  return getOptionalEnv("X402_SOLANA_NETWORK", getOptionalEnv("X402_SVM_NETWORK", defaultNetwork)) as X402Network;
}

function getConfiguredBasePayTo(): string {
  return getOptionalEnv("X402_BASE_PAY_TO", getOptionalEnv("X402_EVM_PAY_TO", getOptionalEnv("ETH_WALLET_ADDRESS")));
}

function getConfiguredSolanaPayTo(): string {
  return getOptionalEnv("X402_SOLANA_PAY_TO", getOptionalEnv("X402_SVM_PAY_TO"));
}

function pathMatchesPattern(pattern: string, path: string): boolean {
  if (pattern === path) {
    return true;
  }

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return false;
  }

  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

function getRequestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

function getHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
}

function normalizeQueryValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeQueryValue(item))
      .flatMap((item) => typeof item === "string" ? [item] : Array.isArray(item) ? item : []);
    return normalized.length > 0 ? normalized : undefined;
  }
  return undefined;
}

class FastifyX402Adapter implements X402HTTPAdapter {
  constructor(private readonly request: FastifyRequest) {}

  getHeader(name: string): string | undefined {
    return getHeaderValue(this.request.headers[name.toLowerCase()]);
  }

  getMethod(): string {
    return this.request.method.toUpperCase();
  }

  getPath(): string {
    return getRequestPathname(this.request.raw.url ?? this.request.url);
  }

  getUrl(): string {
    return this.request.raw.url ?? this.request.url;
  }

  getAcceptHeader(): string {
    return this.getHeader("accept") ?? "*/*";
  }

  getUserAgent(): string {
    return this.getHeader("user-agent") ?? "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const query = this.request.query;
    if (!query || typeof query !== "object") {
      return {};
    }

    return Object.entries(query).reduce<Record<string, string | string[]>>((acc, [key, value]) => {
      const normalized = normalizeQueryValue(value);
      if (normalized !== undefined) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.getQueryParams()[name];
  }

  getBody(): unknown {
    return this.request.body;
  }
}

function buildRequestContext(request: FastifyRequest, routePattern?: string): X402HTTPRequestContext {
  return {
    adapter: new FastifyX402Adapter(request),
    path: getRequestPathname(request.raw.url ?? request.url),
    method: request.method.toUpperCase(),
    routePattern,
  };
}

function createX402UnavailableError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 503;
  return error;
}

function getRuntimeSignature(config: X402ResolvedConfig): string {
  return JSON.stringify({
    facilitatorUrl: config.facilitatorUrl,
    evmNetwork: config.networks.evm.network,
    evmPayTo: config.networks.evm.payTo,
    svmNetwork: config.networks.svm.network,
    svmPayTo: config.networks.svm.payTo,
    routeIds: Object.keys(config.routeConfigMap).sort(),
  });
}

async function getX402Runtime(): Promise<X402Runtime | null> {
  const config = getX402Config();
  if (!config.enabled) {
    return null;
  }

  if (!config.ready) {
    throw createX402UnavailableError("x402 is enabled but not fully configured. Set facilitator and pay-to env vars before enabling paid routes.");
  }

  const signature = getRuntimeSignature(config);
  if (!x402RuntimePromise || x402RuntimeSignature !== signature) {
    x402RuntimeSignature = signature;
    x402RuntimePromise = (async () => {
      const facilitatorClient = new X402HTTPFacilitatorClient({
        url: config.facilitatorUrl,
      });

      const resourceServer = new X402ResourceServer(facilitatorClient)
        .register(config.networks.evm.network, new ExactEvmScheme())
        .register(config.networks.svm.network, new ExactSvmScheme());

      const httpServer = new X402HTTPResourceServer(resourceServer, config.routeConfigMap as X402RoutesConfig);
      await httpServer.initialize();

      return {
        signature,
        config,
        facilitatorClient,
        resourceServer,
        httpServer,
      };
    })().catch((error) => {
      x402RuntimePromise = null;
      x402RuntimeSignature = null;
      throw error;
    });
  }

  return x402RuntimePromise;
}

function applyX402Response(reply: FastifyReply, instructions: X402HTTPResponseInstructions): void {
  reply.code(instructions.status);
  for (const [name, value] of Object.entries(instructions.headers)) {
    reply.header(name, value);
  }

  if (typeof instructions.body === "undefined") {
    reply.send();
    return;
  }

  reply.send(instructions.body);
}

function serializeX402Body(body: unknown): string | Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return body;
  }
  return JSON.stringify(body ?? {});
}

function buildAcceptsForRoute(
  spec: X402PaidRouteSpec,
  config: {
    evmNetwork: string;
    evmPayTo: string;
    svmNetwork: string;
    svmPayTo: string;
  },
): X402PaymentOption[] {
  const accepts: X402PaymentOption[] = [];

  if (isConfigured(config.evmPayTo)) {
    accepts.push({
      scheme: "exact",
      price: spec.priceUsd,
      network: config.evmNetwork,
      payTo: config.evmPayTo,
    });
  }

  if (isConfigured(config.svmPayTo)) {
    accepts.push({
      scheme: "exact",
      price: spec.priceUsd,
      network: config.svmNetwork,
      payTo: config.svmPayTo,
    });
  }

  return accepts;
}

function getBazaarCategory(spec: X402PaidRouteSpec): string {
  switch (spec.endpointName) {
    case "holderAnalysis":
    case "holders":
    case "tokenHolders":
      return "holders";
    case "walletReview":
    case "pnl":
    case "addressRelatedWallets":
      return "wallets";
    case "fudSearch":
    case "xSearch":
    case "xCountRecent":
    case "xUserByUsername":
    case "xUserLikes":
    case "xUserFollowers":
    case "xKolVolume":
      return "social";
    case "isScam":
    case "fullAudit":
      return "risk";
    case "strats/:id":
      return "strategy";
    case "gasFeed":
      return "gas";
    case "newPairs":
    case "trendingTokens":
    case "getTopEthTokens":
    case "getNewEthTradableTokens":
    case "tokenSearch":
      return "discovery";
    case "tokenScreener":
    case "filterTokens":
    case "volatilityScanner":
      return "screening";
    default:
      return "market-data";
  }
}

function getBazaarTags(spec: X402PaidRouteSpec): string[] {
  const tags = new Set<string>([
    "claw.click",
    spec.method.toLowerCase(),
    spec.tier,
  ]);

  const isSentimentRoute = spec.endpointName === "fudSearch"
    || spec.endpointName === "xSearch"
    || spec.endpointName === "xCountRecent"
    || spec.endpointName === "xUserByUsername"
    || spec.endpointName === "xUserLikes"
    || spec.endpointName === "xUserFollowers"
    || spec.endpointName === "xKolVolume";

  if (!isSentimentRoute) {
    tags.add("defi");
    tags.add("web3");
  }

  switch (spec.endpointName) {
    case "holderAnalysis":
      tags.add("distribution");
      tags.add("whales");
      break;
    case "tokenPriceHistory":
      tags.add("ohlcv");
      tags.add("history");
      break;
    case "tokenPoolInfo":
      tags.add("liquidity");
      tags.add("price");
      break;
    case "marketOverview":
      tags.add("sentiment");
      tags.add("overview");
      break;
    case "isScam":
    case "fullAudit":
      tags.add("security");
      tags.add("token-risk");
      break;
    case "tokenSearch":
      tags.add("search");
      tags.add("tokens");
      break;
    case "detailedTokenStats":
      tags.add("stats");
      tags.add("windows");
      break;
    case "priceHistoryIndicators":
      tags.add("indicators");
      tags.add("technical-analysis");
      break;
    case "rateMyEntry":
      tags.add("swing-trading");
      tags.add("entry-score");
      break;
    case "filterTokens":
      tags.add("screening");
      tags.add("filters");
      break;
    case "volatilityScanner":
      tags.add("volatility");
      tags.add("swings");
      break;
    case "holders":
    case "tokenHolders":
      tags.add("wallets");
      tags.add("ownership");
      break;
    case "fudSearch":
      tags.add("sentiment");
      tags.add("mentions");
      break;
    case "walletReview":
      tags.add("portfolio");
      tags.add("wallet-analysis");
      break;
    case "pnl":
      tags.add("portfolio");
      tags.add("performance");
      break;
    case "xSearch":
    case "xCountRecent":
    case "xUserByUsername":
    case "xUserLikes":
    case "xUserFollowers":
    case "xKolVolume":
      tags.add("social");
      tags.add("profiles");
      break;
    case "tokenScreener":
      tags.add("screening");
      tags.add("smart-money");
      break;
    case "addressRelatedWallets":
      tags.add("wallet-analysis");
      tags.add("clusters");
      break;
    case "jupiterDcas":
      tags.add("dca");
      tags.add("orders");
      break;
    case "smartMoneyNetflow":
      tags.add("smart-money");
      tags.add("flows");
      break;
    case "trendingTokens":
      tags.add("trending");
      tags.add("discovery");
      break;
    case "getTopEthTokens":
      tags.add("ethereum");
      tags.add("rankings");
      break;
    case "getNewEthTradableTokens":
      tags.add("ethereum");
      tags.add("new-listings");
      break;
    case "newPairs":
      tags.add("dex");
      tags.add("new-pairs");
      break;
    case "topTraders":
      tags.add("traders");
      tags.add("rankings");
      break;
    case "gasFeed":
      tags.add("fees");
      tags.add("evm");
      break;
    case "strats/:id":
      tags.add("guide");
      tags.add("playbook");
      break;
    default:
      tags.add("analytics");
      break;
  }

  return [...tags];
}

function buildRouteExtensions(spec: X402PaidRouteSpec): X402RouteExtensions {
  return {
    bazaar: {
      discoverable: true,
      category: getBazaarCategory(spec),
      tags: getBazaarTags(spec),
    },
  };
}

function buildRouteDescription(spec: X402PaidRouteSpec): string {
  const base = spec.description.trim().replace(/[. ]+$/, "");
  return `${base}. Learn more at ${X402_LEARN_MORE_URL}`;
}

export function getX402RouteSpecs(maxPhase = normalizeRolloutPhase(getOptionalEnv("X402_ROLLOUT_PHASE", "1"))): X402PaidRouteSpec[] {
  return x402PaidRouteCatalog.filter((route) => route.rolloutPhase <= maxPhase);
}

export function getX402RequiredRouteSpecs(maxPhase = normalizeRolloutPhase(getOptionalEnv("X402_ROLLOUT_PHASE", "1"))): X402PaidRouteSpec[] {
  return getX402RouteSpecs(maxPhase).filter((route) => route.accessPolicy === "payment_required");
}

export function getX402FallbackRouteSpecs(maxPhase = normalizeRolloutPhase(getOptionalEnv("X402_ROLLOUT_PHASE", "1"))): X402PaidRouteSpec[] {
  return getX402RouteSpecs(maxPhase).filter((route) => route.accessPolicy === "payment_fallback");
}

export function getX402RouteConfigMap(
  routeSpecs = getX402RouteSpecs(),
  options?: {
    evmNetwork?: string;
    evmPayTo?: string;
    svmNetwork?: string;
    svmPayTo?: string;
  },
): Record<string, X402RouteConfig> {
  const mode = normalizeMode(getOptionalEnv("X402_MODE", "testnet"));
  const defaults = getModeDefaults(mode);

  const evmNetwork = options?.evmNetwork ?? getConfiguredBaseNetwork(defaults.evmNetwork);
  const evmPayTo = options?.evmPayTo ?? getConfiguredBasePayTo();
  const svmNetwork = options?.svmNetwork ?? getConfiguredSolanaNetwork(defaults.svmNetwork);
  const svmPayTo = options?.svmPayTo ?? getConfiguredSolanaPayTo();

  return routeSpecs.reduce<Record<string, X402RouteConfig>>((acc, spec) => {
    const accepts = buildAcceptsForRoute(spec, {
      evmNetwork,
      evmPayTo,
      svmNetwork,
      svmPayTo,
    });
    if (accepts.length === 0) {
      return acc;
    }

    acc[spec.routeId] = {
      accepts,
      description: buildRouteDescription(spec),
      mimeType: spec.mimeType,
      extensions: buildRouteExtensions(spec),
    };
    return acc;
  }, {});
}

export function getX402Config(): X402ResolvedConfig {
  const mode = normalizeMode(getOptionalEnv("X402_MODE", "testnet"));
  const defaults = getModeDefaults(mode);
  const rolloutPhase = normalizeRolloutPhase(getOptionalEnv("X402_ROLLOUT_PHASE", "1"));
  const facilitatorUrl = getOptionalEnv("X402_FACILITATOR_URL", defaults.facilitatorUrl);
  const evmPayTo = getConfiguredBasePayTo();
  const svmPayTo = getConfiguredSolanaPayTo();
  const evmNetwork = getConfiguredBaseNetwork(defaults.evmNetwork);
  const svmNetwork = getConfiguredSolanaNetwork(defaults.svmNetwork);
  const routeSpecs = getX402RouteSpecs(rolloutPhase);
  const requiredRouteSpecs = routeSpecs.filter((route) => route.accessPolicy === "payment_required");
  const fallbackRouteSpecs = routeSpecs.filter((route) => route.accessPolicy === "payment_fallback");
  const routeConfigMap = getX402RouteConfigMap(routeSpecs, {
    evmNetwork,
    evmPayTo,
    svmNetwork,
    svmPayTo,
  });
  const enabled = getOptionalEnv("X402_ENABLED", "false").toLowerCase() === "true";
  const evmConfigured = isConfigured(evmPayTo);
  const svmConfigured = isConfigured(svmPayTo);

  return {
    enabled,
    ready: enabled && isConfigured(facilitatorUrl) && (evmConfigured || svmConfigured) && Object.keys(routeConfigMap).length > 0,
    mode,
    rolloutPhase,
    facilitatorUrl,
    sdk: x402SdkDescriptor,
    networks: {
      evm: {
        network: evmNetwork,
        payTo: evmPayTo,
        configured: evmConfigured,
        scheme: "exact",
      },
      svm: {
        network: svmNetwork,
        payTo: svmPayTo,
        configured: svmConfigured,
        scheme: "exact",
      },
    },
    routeSpecs,
    requiredRouteSpecs,
    fallbackRouteSpecs,
    routeConfigMap,
  };
}

export function getX402RouteSpec(method: string, path: string): X402PaidRouteSpec | null {
  const normalizedMethod = method.toUpperCase() as X402Method;
  return x402PaidRouteCatalog.find((route) => route.method === normalizedMethod && pathMatchesPattern(route.path, path)) ?? null;
}

export function isX402CandidateRoute(method: string, path: string): boolean {
  return getX402RouteSpec(method, path) !== null;
}

export function isX402ActiveRoute(method: string, path: string): boolean {
  const routeSpec = getX402RouteSpec(method, path);
  if (!routeSpec) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(getX402Config().routeConfigMap, routeSpec.routeId);
}

export async function processX402Request(request: FastifyRequest, reply: FastifyReply): Promise<X402RequestHandlingResult> {
  const pathname = getRequestPathname(request.raw.url ?? request.url);
  const routeSpec = getX402RouteSpec(request.method, pathname);
  if (!routeSpec) {
    return { handled: false };
  }

  const runtime = await getX402Runtime();
  if (!runtime) {
    return { handled: false };
  }

  if (!runtime.config.routeConfigMap[routeSpec.routeId]) {
    return { handled: false };
  }

  const processResult = await runtime.httpServer.processHTTPRequest(
    buildRequestContext(request, routeSpec.routeId),
  );

  if (processResult.type === "payment-error") {
    applyX402Response(reply, processResult.response);
    return { handled: true };
  }

  if (processResult.type === "payment-verified") {
    return {
      handled: false,
      verifiedRequest: {
        routeId: routeSpec.routeId,
        routePattern: routeSpec.routeId,
        paymentPayload: processResult.paymentPayload,
        paymentRequirements: processResult.paymentRequirements,
        declaredExtensions: processResult.declaredExtensions,
      },
    };
  }

  return { handled: false };
}

export async function processX402Settlement(
  request: FastifyRequest,
  reply: FastifyReply,
  verifiedRequest: X402VerifiedRequest,
): Promise<string | Buffer | undefined> {
  const runtime = await getX402Runtime();
  if (!runtime) {
    return undefined;
  }

  const settlement = await runtime.httpServer.processSettlement(
    verifiedRequest.paymentPayload,
    verifiedRequest.paymentRequirements,
    verifiedRequest.declaredExtensions,
    {
      request: buildRequestContext(request, verifiedRequest.routePattern),
    },
  );

  for (const [name, value] of Object.entries(settlement.headers)) {
    reply.header(name, value);
  }

  if (settlement.success) {
    return undefined;
  }

  reply.code(settlement.response.status);
  for (const [name, value] of Object.entries(settlement.response.headers)) {
    reply.header(name, value);
  }

  if (!reply.hasHeader("content-type")) {
    reply.header("content-type", "application/json; charset=utf-8");
  }

  return serializeX402Body(settlement.response.body);
}
