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
export type X402RouteFamily = "pilot" | "cheap" | "codex" | "nansen" | "x";

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

export type X402RouteConfig = {
  accepts: X402PaymentOption[];
  description: string;
  mimeType: string;
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

export const x402PaidRouteCatalog: readonly X402PaidRouteSpec[] = [
  {
    routeId: "GET /holderAnalysis",
    method: "GET",
    path: "/holderAnalysis",
    endpointName: "holderAnalysis",
    family: "pilot",
    accessPolicy: "payment_required",
    priceUsd: "$0.015",
    description: "Holder concentration and whale distribution analysis",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 1,
    rationale: "Pilot the x402 flow on one valuable read route before broad rollout.",
  },
  {
    routeId: "GET /tokenPoolInfo",
    method: "GET",
    path: "/tokenPoolInfo",
    endpointName: "tokenPoolInfo",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.005",
    description: "Premium token pool and liquidity intelligence",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Cheap route that can stay free for API-key holders until they exceed limits.",
  },
  {
    routeId: "GET /marketOverview",
    method: "GET",
    path: "/marketOverview",
    endpointName: "marketOverview",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.01",
    description: "Combined market, sentiment, and risk overview for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Useful entry-tier route that can flip to x402 when API-key access is unavailable.",
  },
  {
    routeId: "GET /isScam",
    method: "GET",
    path: "/isScam",
    endpointName: "isScam",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.005",
    description: "Fast risk screen for a token or contract",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Good low-cost fallback route when a caller has no key or is over free usage.",
  },
  {
    routeId: "GET /tokenSearch",
    method: "GET",
    path: "/tokenSearch",
    endpointName: "tokenSearch",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.002",
    description: "Search tokens by name, symbol, or address",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Natural fallback route for no-key and over-limit traffic.",
  },
  {
    routeId: "GET /swapQuote",
    method: "GET",
    path: "/swapQuote",
    endpointName: "swapQuote",
    family: "cheap",
    accessPolicy: "payment_fallback",
    priceUsd: "$0.003",
    description: "Retrieve a swap quote for a token pair",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Good candidate for overflow monetization after free API-key usage is exhausted.",
  },
  {
    routeId: "GET /detailedTokenStats",
    method: "GET",
    path: "/detailedTokenStats",
    endpointName: "detailedTokenStats",
    family: "codex",
    accessPolicy: "payment_required",
    priceUsd: "$0.01",
    description: "Detailed token statistics from Codex-backed market data",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Core Codex-backed route that should be part of the paid analytics bundle.",
  },
  {
    routeId: "GET /priceHistoryIndicators",
    method: "GET",
    path: "/priceHistoryIndicators",
    endpointName: "priceHistoryIndicators",
    family: "codex",
    accessPolicy: "payment_required",
    priceUsd: "$0.015",
    description: "Historical price data with technical indicators and aggregate signal",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Computed Codex-style signal endpoint that fits direct payment gating.",
  },
  {
    routeId: "GET /rateMyEntry",
    method: "GET",
    path: "/rateMyEntry",
    endpointName: "rateMyEntry",
    family: "codex",
    accessPolicy: "payment_required",
    priceUsd: "$0.015",
    description: "Codex-assisted swing-trade entry score for a token",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "High-signal derived endpoint that works well as a paid research action.",
  },
  {
    routeId: "GET /filterTokens",
    method: "GET",
    path: "/filterTokens",
    endpointName: "filterTokens",
    family: "codex",
    accessPolicy: "payment_required",
    priceUsd: "$0.01",
    description: "Filter tokens by market and performance metrics",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Primary Codex screening route and a natural paid query surface.",
  },
  {
    routeId: "GET /volatilityScanner",
    method: "GET",
    path: "/volatilityScanner",
    endpointName: "volatilityScanner",
    family: "codex",
    accessPolicy: "payment_required",
    priceUsd: "$0.01",
    description: "Volatility scan for swing-trade opportunities",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Distinct Codex-style scan endpoint that belongs in the paid analytics set.",
  },
  {
    routeId: "GET /nansenPresets",
    method: "GET",
    path: "/nansenPresets",
    endpointName: "nansenPresets",
    family: "nansen",
    accessPolicy: "payment_required",
    priceUsd: "$0.003",
    description: "List preset templates for Nansen-backed workflows",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Keeps the full Nansen workflow inside the same payment system from the start.",
  },
  {
    routeId: "GET /xSearch",
    method: "GET",
    path: "/xSearch",
    endpointName: "xSearch",
    family: "x",
    accessPolicy: "payment_required",
    priceUsd: "$0.02",
    description: "Search recent X posts for token or topic intelligence",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Core X intelligence endpoint and an obvious paid agent action.",
  },
  {
    routeId: "GET /xCountRecent",
    method: "GET",
    path: "/xCountRecent",
    endpointName: "xCountRecent",
    family: "x",
    accessPolicy: "payment_required",
    priceUsd: "$0.01",
    description: "Count recent X posts for a query",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Complements X search and belongs in the same paid social intelligence surface.",
  },
  {
    routeId: "GET /xUserByUsername",
    method: "GET",
    path: "/xUserByUsername",
    endpointName: "xUserByUsername",
    family: "x",
    accessPolicy: "payment_required",
    priceUsd: "$0.01",
    description: "Look up an X user profile by username",
    mimeType: "application/json",
    tier: "starter",
    rolloutPhase: 2,
    rationale: "Useful profile primitive for agents working across social endpoints.",
  },
  {
    routeId: "GET /xUserLikes",
    method: "GET",
    path: "/xUserLikes",
    endpointName: "xUserLikes",
    family: "x",
    accessPolicy: "payment_required",
    priceUsd: "$0.015",
    description: "Get liked X posts for a user",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "Deeper social graph query that should sit behind x402 from launch.",
  },
  {
    routeId: "GET /xUserFollowers",
    method: "GET",
    path: "/xUserFollowers",
    endpointName: "xUserFollowers",
    family: "x",
    accessPolicy: "payment_required",
    priceUsd: "$0.015",
    description: "Get followers for an X user",
    mimeType: "application/json",
    tier: "standard",
    rolloutPhase: 2,
    rationale: "High-value social graph lookup that fits the paid X bundle.",
  },
  {
    routeId: "POST /tokenScreener",
    method: "POST",
    path: "/tokenScreener",
    endpointName: "tokenScreener",
    family: "nansen",
    accessPolicy: "payment_required",
    priceUsd: "$0.05",
    description: "Nansen-backed smart-money token screening",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 2,
    rationale: "Primary Nansen analytics route and a strong paid workflow candidate.",
  },
  {
    routeId: "POST /addressRelatedWallets",
    method: "POST",
    path: "/addressRelatedWallets",
    endpointName: "addressRelatedWallets",
    family: "nansen",
    accessPolicy: "payment_required",
    priceUsd: "$0.08",
    description: "Cluster related wallets and trace fund movement",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 2,
    rationale: "High-value Nansen investigation route that should be paid from launch.",
  },
  {
    routeId: "POST /jupiterDcas",
    method: "POST",
    path: "/jupiterDcas",
    endpointName: "jupiterDcas",
    family: "nansen",
    accessPolicy: "payment_required",
    priceUsd: "$0.05",
    description: "Nansen Solana Jupiter DCA insights for a token",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 2,
    rationale: "Premium Nansen route with clear external cost and value.",
  },
  {
    routeId: "POST /smartMoneyNetflow",
    method: "POST",
    path: "/smartMoneyNetflow",
    endpointName: "smartMoneyNetflow",
    family: "nansen",
    accessPolicy: "payment_required",
    priceUsd: "$0.06",
    description: "Smart-money inflow and outflow analytics across chains",
    mimeType: "application/json",
    tier: "premium",
    rolloutPhase: 2,
    rationale: "High-signal Nansen route that belongs in the paid launch set.",
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
      description: spec.description,
      mimeType: spec.mimeType,
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
  const routeId = `${method.toUpperCase()} ${path}` as `${X402Method} ${string}`;
  return x402PaidRouteCatalog.find((route) => route.routeId === routeId) ?? null;
}

export function isX402CandidateRoute(method: string, path: string): boolean {
  return getX402RouteSpec(method, path) !== null;
}

export function isX402ActiveRoute(method: string, path: string): boolean {
  const routeId = `${method.toUpperCase()} ${path}`;
  return Object.prototype.hasOwnProperty.call(getX402Config().routeConfigMap, routeId);
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
