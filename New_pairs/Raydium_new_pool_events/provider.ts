// DOCS: https://docs.raydium.io/raydium/ (Raydium V3 API)

import { requestJson } from "#lib/http";

type RaydiumPool = {
  id?: string;
  mintA?: { address?: string; symbol?: string };
  mintB?: { address?: string; symbol?: string };
  tvl?: number;
  day?: { volume?: number; apr?: number };
  type?: string;
  programId?: string;
};

type RaydiumPoolListResponse = {
  success?: boolean;
  data?: {
    count?: number;
    data?: RaydiumPool[];
  };
};

/** GET /pools/info/list – list pools sorted by creation date (newest first). No auth required. */
export async function getNewPools(page = 1, pageSize = 10): Promise<RaydiumPoolListResponse> {
  return requestJson<RaydiumPoolListResponse>(
    `https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=default&sortType=desc&page=${page}&pageSize=${pageSize}`,
  );
}
