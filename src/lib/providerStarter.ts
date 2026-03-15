import { getOptionalEnv, getRequiredEnv } from "#config/env";
import { requestJson } from "#lib/http";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function printPreview(name: string, payload: unknown): void {
  const preview = JSON.stringify(payload, null, 2)?.slice(0, 2500) ?? "null";
  console.log(`\n=== ${name} ===`);
  console.log(preview);
}

export async function runRestStarter(options: {
  name: string;
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: JsonValue | Record<string, string>;
}): Promise<void> {
  const payload = await requestJson<unknown>(options.url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  printPreview(options.name, payload);
}

export async function runJsonRpcStarter(options: {
  name: string;
  rpcUrl: string;
  method: string;
  params?: JsonValue[];
}): Promise<void> {
  const payload = await requestJson<unknown>(options.rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: options.method,
      params: options.params ?? []
    })
  });

  printPreview(options.name, payload);
}

export async function runGraphqlStarter(options: {
  name: string;
  url: string;
  query: string;
  variables?: Record<string, JsonValue>;
  headers?: Record<string, string>;
}): Promise<void> {
  const payload = await requestJson<unknown>(options.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...options.headers
    },
    body: JSON.stringify({
      query: options.query,
      variables: options.variables ?? {}
    })
  });

  printPreview(options.name, payload);
}

export function bearerHeader(envName: string): Record<string, string> {
  return {
    Authorization: `Bearer ${getRequiredEnv(envName)}`
  };
}

export function apiKeyHeader(headerName: string, envName: string): Record<string, string> {
  return {
    [headerName]: getRequiredEnv(envName)
  };
}

export function optionalBaseUrl(envName: string, fallback: string): string {
  return getOptionalEnv(envName, fallback);
}