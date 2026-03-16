// DOCS: https://docs.dune.com/api-reference/overview/introduction

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type DuneResultRow = Record<string, unknown>;

type DuneQueryResultsResponse = {
  execution_id?: string;
  query_id?: number;
  state?: string;
  result?: {
    rows?: DuneResultRow[];
    metadata?: {
      column_names?: string[];
      column_types?: string[];
      total_row_count?: number;
    };
  };
};

function getHeaders(): Record<string, string> {
  return {
    "X-Dune-API-Key": getRequiredEnv("DUNE_API_KEY"),
  };
}

function getSimHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "X-Sim-Api-Key": getRequiredEnv("SIM_API_KEY"),
  };
}

export function isDuneConfigured(): boolean {
  return isConfigured(getOptionalEnv("DUNE_API_KEY"));
}

export function isSimConfigured(): boolean {
  return isConfigured(getOptionalEnv("SIM_API_KEY"));
}

/** GET /api/v1/query/{queryId}/results – fetch the latest results of a saved query. */
export async function getQueryResults(queryId: string): Promise<DuneQueryResultsResponse> {
  return requestJson<DuneQueryResultsResponse>(
    `https://api.dune.com/api/v1/query/${queryId}/results`,
    { headers: getHeaders() },
  );
}

/* ── NEW ENDPOINTS ────────────────────────────────────────── */

type DuneExecuteResponse = {
  execution_id?: string;
  state?: string;
};

/** POST /api/v1/query/{queryId}/execute – trigger execution of a saved query. */
export async function executeQuery(queryId: string, parameters?: Record<string, unknown>): Promise<DuneExecuteResponse> {
  return requestJson<DuneExecuteResponse>(
    `https://api.dune.com/api/v1/query/${queryId}/execute`,
    {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ query_parameters: parameters ?? {} }),
    },
  );
}

type DuneStatusResponse = {
  execution_id?: string;
  query_id?: number;
  state?: string;
  queue_position?: number;
  result_set_bytes?: number;
  execution_started_at?: string;
  execution_ended_at?: string;
};

/** GET /api/v1/execution/{executionId}/status – poll execution status until complete. */
export async function getExecutionStatus(executionId: string): Promise<DuneStatusResponse> {
  return requestJson<DuneStatusResponse>(
    `https://api.dune.com/api/v1/execution/${executionId}/status`,
    { headers: getHeaders() },
  );
}

/** GET /api/v1/execution/{executionId}/results – fetch results of a specific execution run. */
export async function getExecutionResults(executionId: string): Promise<DuneQueryResultsResponse> {
  return requestJson<DuneQueryResultsResponse>(
    `https://api.dune.com/api/v1/execution/${executionId}/results`,
    { headers: getHeaders() },
  );
}

type SimTokenHolder = {
  wallet_address?: string;
  balance?: string;
  first_acquired?: string;
  has_initiated_transfer?: boolean;
};

export type SimTokenHoldersResponse = {
  token_address?: string;
  chain_id?: number;
  holders?: SimTokenHolder[];
  next_offset?: string | null;
};

export async function getSimTokenHolders(
  chainId: number,
  tokenAddress: string,
  limit = 100,
  offset?: string,
): Promise<SimTokenHoldersResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) {
    params.set("offset", offset);
  }

  return requestJson<SimTokenHoldersResponse>(
    `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${encodeURIComponent(tokenAddress)}?${params.toString()}`,
    { headers: getSimHeaders() },
  );
}
