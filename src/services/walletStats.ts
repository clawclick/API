import { runProvider, summarizeStatus } from "#lib/runProvider";
import {
  codexDetailedWalletStats,
  isCodexConfigured,
  type CodexStatsPeriod,
} from "#providers/market/codex";
import type { WalletStatsQuery } from "#routes/helpers";
import type { WalletStatsResponse, WalletStatsPeriod, ProviderStatus } from "#types/api";

/* ── 3-minute cache ──────────────────────────────────────── */

type CacheEntry = { data: WalletStatsResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000;

/* ── Helpers ─────────────────────────────────────────────── */

function mapPeriod(p: CodexStatsPeriod | undefined): WalletStatsPeriod | null {
  if (!p) return null;
  return {
    volumeUsd: p.statsUsd?.volumeUsd ?? null,
    realizedProfitUsd: p.statsUsd?.realizedProfitUsd ?? null,
    realizedProfitPct: p.statsUsd?.realizedProfitPercentage ?? null,
    avgProfitPerTrade: p.statsUsd?.averageProfitUsdPerTrade ?? null,
    swaps: p.statsNonCurrency?.swaps ?? null,
    uniqueTokens: p.statsNonCurrency?.uniqueTokens ?? null,
    wins: p.statsNonCurrency?.wins ?? null,
    losses: p.statsNonCurrency?.losses ?? null,
  };
}

/* ── Service ─────────────────────────────────────────────── */

export async function getWalletStats(q: WalletStatsQuery): Promise<WalletStatsResponse> {
  const cached = cache.get(q.walletAddress);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const statuses: ProviderStatus[] = [];

  const result = await runProvider(
    statuses,
    "codex:detailedWalletStats",
    isCodexConfigured(),
    () => codexDetailedWalletStats(q.walletAddress),
    "CODEX_API_KEY not configured. Get one at https://dashboard.codex.io",
  );

  const d = result?.data?.detailedWalletStats;

  const response: WalletStatsResponse = {
    endpoint: "walletStats",
    status: summarizeStatus(statuses),
    cached: false,
    walletAddress: q.walletAddress,
    lastTransactionAt: d?.lastTransactionAt ?? null,
    labels: d?.labels ?? [],
    scammerScore: d?.scammerScore ?? null,
    botScore: d?.botScore ?? null,
    stats1d: mapPeriod(d?.statsDay1),
    stats1w: mapPeriod(d?.statsWeek1),
    stats30d: mapPeriod(d?.statsDay30),
    stats1y: mapPeriod(d?.statsYear1),
    networkBalances: (d?.networkBreakdown ?? []).map((nb) => ({
      networkId: nb.networkId ?? null,
      nativeTokenBalance: nb.nativeTokenBalance ?? null,
    })),
    firstFunding: d?.wallet?.firstFunding
      ? {
          timestamp: d.wallet.firstFunding.timestamp ?? null,
          address: d.wallet.firstFunding.address ?? null,
        }
      : null,
    providers: statuses,
  };

  if (statuses.some((s) => s.status === "ok")) {
    cache.set(q.walletAddress, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}
