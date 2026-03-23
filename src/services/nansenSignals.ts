import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  type NansenJupiterDcasRequest,
  type NansenSmartMoneyNetflowRequest,
  type NansenTokenScreenerRequest,
  getAddressRelatedWallets as fetchAddressRelatedWallets,
  getJupiterDcas as fetchJupiterDcas,
  getSmartMoneyNetflow as fetchSmartMoneyNetflow,
  getTokenScreener as fetchTokenScreener,
  isNansenConfigured,
} from "#providers/walletTracking/nansen";
import type {
  AddressRelatedWalletsQuery,
  JupiterDcasQuery,
  NansenPresetCatalogQuery,
  SmartMoneyNetflowQuery,
  TokenScreenerQuery,
} from "#routes/helpers";
import type {
  AddressRelatedWalletItem,
  AddressRelatedWalletsResponse,
  JupiterDcaItem,
  JupiterDcasResponse,
  NansenPagination,
  NansenPresetTemplate,
  NansenPresetsResponse,
  ProviderStatus,
  SmartMoneyNetflowItem,
  SmartMoneyNetflowResponse,
  TokenScreenerItem,
  TokenScreenerResponse,
} from "#types/api";

const NANSEN_PRESET_TEMPLATES: NansenPresetTemplate[] = [
  {
    id: "buyCandidates",
    endpoint: "tokenScreener",
    label: "Buy Candidates",
    intent: "Find tokens with fresh smart-money participation and meaningful buy-side activity.",
    requestTemplate: {
      chains: ["ethereum", "solana", "base"],
      timeframe: "24h",
      pagination: { page: 1, per_page: 25 },
      filters: {
        only_smart_money: true,
        token_age_days: { min: 1, max: 180 },
      },
      order_by: [{ field: "buy_volume", direction: "DESC" }],
    },
  },
  {
    id: "avoidTokens",
    endpoint: "smartMoneyNetflow",
    label: "Avoid Tokens",
    intent: "Surface tokens seeing broad smart-money distribution so they can be deprioritized or avoided.",
    requestTemplate: {
      chains: ["ethereum", "solana", "base"],
      filters: {
        include_native_tokens: false,
        include_stablecoins: false,
        exclude_smart_money_labels: ["30D Smart Trader"],
      },
      pagination: { page: 1, per_page: 25 },
      order_by: [{ field: "net_flow_24h_usd", direction: "ASC" }],
    },
  },
  {
    id: "solDcaAccumulation",
    endpoint: "jupiterDcas",
    label: "Solana DCA Accumulation",
    intent: "Inspect larger active Jupiter DCA orders on Solana to see which tokens are being accumulated over time.",
    requestTemplate: {
      pagination: { page: 1, per_page: 25 },
      filters: {
        deposit_amount: { min: 100 },
        deposit_usd_value: { min: 1000 },
        status: "Active",
      },
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => toNullableString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizePagination(input: { page?: number; per_page?: number; is_last_page?: boolean } | null | undefined): NansenPagination {
  return {
    page: input?.page ?? 1,
    perPage: input?.per_page ?? 0,
    isLastPage: typeof input?.is_last_page === "boolean" ? input.is_last_page : null,
  };
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function mergeOptionalObject(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = {
    ...(left ?? {}),
    ...(right ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergePresetRequest<T extends Record<string, unknown>>(
  template: Partial<T>,
  overrides: Record<string, unknown>,
  omittedOverrideKeys: string[] = [],
): T {
  const sanitizedTemplate = omitUndefined(template as Record<string, unknown>);
  const sanitizedOverrides = omitUndefined(
    Object.fromEntries(Object.entries(overrides).filter(([key]) => !omittedOverrideKeys.includes(key))),
  );

  const request: Record<string, unknown> = {
    ...sanitizedTemplate,
    ...sanitizedOverrides,
  };

  const pagination = mergeOptionalObject(
    isRecord(sanitizedTemplate.pagination) ? sanitizedTemplate.pagination : undefined,
    isRecord(sanitizedOverrides.pagination) ? sanitizedOverrides.pagination : undefined,
  );
  const filters = mergeOptionalObject(
    isRecord(sanitizedTemplate.filters) ? sanitizedTemplate.filters : undefined,
    isRecord(sanitizedOverrides.filters) ? sanitizedOverrides.filters : undefined,
  );
  const date = mergeOptionalObject(
    isRecord(sanitizedTemplate.date) ? sanitizedTemplate.date : undefined,
    isRecord(sanitizedOverrides.date) ? sanitizedOverrides.date : undefined,
  );

  if (pagination) {
    request.pagination = pagination;
  } else {
    delete request.pagination;
  }

  if (filters) {
    request.filters = filters;
  } else {
    delete request.filters;
  }

  if (date) {
    request.date = date;
  } else {
    delete request.date;
  }

  if (sanitizedOverrides.order_by !== undefined) {
    request.order_by = sanitizedOverrides.order_by;
  } else if (sanitizedTemplate.order_by !== undefined) {
    request.order_by = sanitizedTemplate.order_by;
  } else {
    delete request.order_by;
  }

  return request as T;
}

function getPresetTemplate(id: string | undefined, endpoint: NansenPresetTemplate["endpoint"]): NansenPresetTemplate | null {
  if (!id) {
    return null;
  }

  return NANSEN_PRESET_TEMPLATES.find((preset) => preset.id === id && preset.endpoint === endpoint) ?? null;
}

function resolveTokenScreenerRequest(query: TokenScreenerQuery): { presetApplied: string | null; request: NansenTokenScreenerRequest } {
  const preset = getPresetTemplate(query.preset, "tokenScreener");
  if (query.preset && !preset) {
    throw new Error(`Preset ${query.preset} is not supported for /tokenScreener.`);
  }

  const request = mergePresetRequest<NansenTokenScreenerRequest>(
    (preset?.requestTemplate ?? {}) as NansenTokenScreenerRequest,
    query as unknown as Record<string, unknown>,
    ["preset"],
  );

  if (query.date) {
    delete request.timeframe;
  }

  if (query.timeframe) {
    delete request.date;
  }

  if (!request.chains || request.chains.length === 0) {
    throw new Error("Provide chains or use a preset that defines chains.");
  }

  if (request.timeframe && request.date) {
    throw new Error("Use timeframe or date, not both.");
  }

  if (!request.timeframe && !request.date) {
    throw new Error("Provide timeframe or date, or use a preset that defines one.");
  }

  return { presetApplied: preset?.id ?? null, request };
}

function resolveJupiterDcasRequest(query: JupiterDcasQuery): { presetApplied: string | null; request: NansenJupiterDcasRequest } {
  const preset = getPresetTemplate(query.preset, "jupiterDcas");
  if (query.preset && !preset) {
    throw new Error(`Preset ${query.preset} is not supported for /jupiterDcas.`);
  }

  const request = mergePresetRequest<NansenJupiterDcasRequest>(
    (preset?.requestTemplate ?? {}) as NansenJupiterDcasRequest,
    query as unknown as Record<string, unknown>,
    ["preset"],
  );

  if (!request.token_address) {
    throw new Error("Provide token_address when calling /jupiterDcas, including when using solDcaAccumulation.");
  }

  return { presetApplied: preset?.id ?? null, request };
}

function resolveSmartMoneyNetflowRequest(query: SmartMoneyNetflowQuery): { presetApplied: string | null; request: NansenSmartMoneyNetflowRequest } {
  const preset = getPresetTemplate(query.preset, "smartMoneyNetflow");
  if (query.preset && !preset) {
    throw new Error(`Preset ${query.preset} is not supported for /smartMoneyNetflow.`);
  }

  const request = mergePresetRequest<NansenSmartMoneyNetflowRequest>(
    (preset?.requestTemplate ?? {}) as NansenSmartMoneyNetflowRequest,
    query as unknown as Record<string, unknown>,
    ["preset"],
  );

  if (!request.chains || request.chains.length === 0) {
    throw new Error("Provide chains or use a preset that defines chains.");
  }

  return { presetApplied: preset?.id ?? null, request };
}

export async function getNansenPresetsData(query: NansenPresetCatalogQuery): Promise<NansenPresetsResponse> {
  const presets = query.endpoint
    ? NANSEN_PRESET_TEMPLATES.filter((preset) => preset.endpoint === query.endpoint)
    : NANSEN_PRESET_TEMPLATES;

  return {
    endpoint: "nansenPresets",
    status: "live",
    count: presets.length,
    presets,
    providers: [],
  };
}

export async function getTokenScreenerData(query: TokenScreenerQuery): Promise<TokenScreenerResponse> {
  const { presetApplied, request } = resolveTokenScreenerRequest(query);
  const statuses: ProviderStatus[] = [];
  const data = await runProvider(
    statuses,
    "nansen:tokenScreener",
    isNansenConfigured(),
    () => fetchTokenScreener(request),
    "Nansen API key not configured.",
  );

  const tokens: TokenScreenerItem[] = (data?.data ?? []).map((item) => ({
    chain: toNullableString(item.chain),
    tokenAddress: toNullableString(item.token_address),
    tokenSymbol: toNullableString(item.token_symbol),
    tokenAgeDays: toNullableNumber(item.token_age_days),
    marketCapUsd: toNullableNumber(item.market_cap_usd),
    liquidityUsd: toNullableNumber(item.liquidity),
    priceUsd: toNullableNumber(item.price_usd),
    priceChangePct: toNullableNumber(item.price_change),
    fdvUsd: toNullableNumber(item.fdv),
    fdvMcRatio: toNullableNumber(item.fdv_mc_ratio),
    buyVolumeUsd: toNullableNumber(item.buy_volume),
    inflowFdvRatio: toNullableNumber(item.inflow_fdv_ratio),
    outflowFdvRatio: toNullableNumber(item.outflow_fdv_ratio),
    sellVolumeUsd: toNullableNumber(item.sell_volume),
    volumeUsd: toNullableNumber(item.volume),
    netflowUsd: toNullableNumber(item.netflow),
  }));

  const strongestInflow = [...tokens]
    .filter((item) => item.netflowUsd !== null)
    .sort((left, right) => (right.netflowUsd ?? Number.NEGATIVE_INFINITY) - (left.netflowUsd ?? Number.NEGATIVE_INFINITY))[0] ?? null;

  const response: TokenScreenerResponse = {
    endpoint: "tokenScreener",
    status: summarizeStatus(statuses),
    chains: request.chains,
    presetApplied,
    timeframe: request.timeframe ?? null,
    dateRange: request.date ?? null,
    count: tokens.length,
    summary: {
      positiveNetflowCount: tokens.filter((item) => (item.netflowUsd ?? 0) > 0).length,
      negativeNetflowCount: tokens.filter((item) => (item.netflowUsd ?? 0) < 0).length,
      strongestInflow,
    },
    pagination: normalizePagination(data?.pagination),
    tokens,
    providers: statuses,
  };

  return response;
}

export async function getAddressRelatedWalletsData(query: AddressRelatedWalletsQuery): Promise<AddressRelatedWalletsResponse> {
  const statuses: ProviderStatus[] = [];
  const data = await runProvider(
    statuses,
    "nansen:addressRelatedWallets",
    isNansenConfigured(),
    () => fetchAddressRelatedWallets(query),
    "Nansen API key not configured.",
  );

  const relatedWallets: AddressRelatedWalletItem[] = (data?.data ?? []).map((item) => ({
    address: toNullableString(item.address),
    addressLabel: toNullableString(item.address_label),
    relation: toNullableString(item.relation),
    transactionHash: toNullableString(item.transaction_hash),
    blockTimestamp: toNullableString(item.block_timestamp),
    order: toNullableNumber(item.order),
    chain: toNullableString(item.chain),
  }));

  const response: AddressRelatedWalletsResponse = {
    endpoint: "addressRelatedWallets",
    status: summarizeStatus(statuses),
    address: query.address,
    chain: query.chain,
    count: relatedWallets.length,
    summary: {
      relationTypes: [...new Set(relatedWallets.map((item) => item.relation).filter((item): item is string => Boolean(item)))],
      latestInteractionAt: relatedWallets
        .map((item) => item.blockTimestamp)
        .filter((item): item is string => Boolean(item))
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
    },
    pagination: normalizePagination(data?.pagination),
    relatedWallets,
    providers: statuses,
  };

  return response;
}

export async function getJupiterDcasData(query: JupiterDcasQuery): Promise<JupiterDcasResponse> {
  const { presetApplied, request } = resolveJupiterDcasRequest(query);
  const statuses: ProviderStatus[] = [];
  const data = await runProvider(
    statuses,
    "nansen:jupiterDcas",
    isNansenConfigured(),
    () => fetchJupiterDcas(request),
    "Nansen API key not configured.",
  );

  const orders: JupiterDcaItem[] = (data?.data ?? []).map((item) => ({
    sinceTimestamp: toNullableString(item.since_timestamp),
    lastTimestamp: toNullableString(item.last_timestamp),
    traderAddress: toNullableString(item.trader_address),
    creationHash: toNullableString(item.creation_hash),
    traderLabel: toNullableString(item.trader_label),
    dcaVaultAddress: toNullableString(item.dca_vault_address),
    inputMintAddress: toNullableString(item.input_mint_address),
    outputMintAddress: toNullableString(item.output_mint_address),
    depositAmount: toNullableNumber(item.deposit_amount),
    depositSpent: toNullableNumber(item.deposit_spent),
    otherTokenRedeemed: toNullableNumber(item.other_token_redeemed),
    statusLabel: toNullableString(item.status),
    tokenInput: toNullableString(item.token_input),
    tokenOutput: toNullableString(item.token_output),
    depositUsdValue: toNullableNumber(item.deposit_usd_value),
  }));

  const response: JupiterDcasResponse = {
    endpoint: "jupiterDcas",
    status: summarizeStatus(statuses),
    chain: "solana",
    tokenAddress: request.token_address,
    presetApplied,
    count: orders.length,
    summary: {
      activeCount: orders.filter((item) => item.statusLabel?.toLowerCase() === "active").length,
      closedCount: orders.filter((item) => item.statusLabel?.toLowerCase() === "closed").length,
      totalDepositUsdValue: orders.reduce((sum, item) => sum + (item.depositUsdValue ?? 0), 0),
    },
    pagination: normalizePagination(data?.pagination),
    orders,
    providers: statuses,
  };

  return response;
}

export async function getSmartMoneyNetflowData(query: SmartMoneyNetflowQuery): Promise<SmartMoneyNetflowResponse> {
  const { presetApplied, request } = resolveSmartMoneyNetflowRequest(query);
  const statuses: ProviderStatus[] = [];
  const data = await runProvider(
    statuses,
    "nansen:smartMoneyNetflow",
    isNansenConfigured(),
    () => fetchSmartMoneyNetflow(request),
    "Nansen API key not configured.",
  );

  const tokens: SmartMoneyNetflowItem[] = (data?.data ?? []).map((item) => ({
    tokenAddress: toNullableString(item.token_address),
    tokenSymbol: toNullableString(item.token_symbol),
    netFlow1hUsd: toNullableNumber(item.net_flow_1h_usd),
    netFlow24hUsd: toNullableNumber(item.net_flow_24h_usd),
    netFlow7dUsd: toNullableNumber(item.net_flow_7d_usd),
    netFlow30dUsd: toNullableNumber(item.net_flow_30d_usd),
    chain: toNullableString(item.chain),
    tokenSectors: toStringArray(item.token_sectors),
    traderCount: toNullableNumber(item.trader_count),
    tokenAgeDays: toNullableNumber(item.token_age_days),
    marketCapUsd: toNullableNumber(item.market_cap_usd),
  }));

  const by24hFlow = [...tokens].filter((item) => item.netFlow24hUsd !== null).sort(
    (left, right) => (right.netFlow24hUsd ?? Number.NEGATIVE_INFINITY) - (left.netFlow24hUsd ?? Number.NEGATIVE_INFINITY),
  );

  const response: SmartMoneyNetflowResponse = {
    endpoint: "smartMoneyNetflow",
    status: summarizeStatus(statuses),
    chains: request.chains,
    presetApplied,
    count: tokens.length,
    summary: {
      accumulationCount: tokens.filter((item) => (item.netFlow24hUsd ?? 0) > 0).length,
      distributionCount: tokens.filter((item) => (item.netFlow24hUsd ?? 0) < 0).length,
      strongestInflow: by24hFlow[0] ?? null,
      strongestOutflow: by24hFlow.length > 0 ? by24hFlow[by24hFlow.length - 1] : null,
    },
    pagination: normalizePagination(data?.pagination),
    tokens,
    providers: statuses,
  };

  return response;
}