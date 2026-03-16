const DEFAULT_TIMEOUT_MS = 60_000;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly responseBody: string,
    public readonly url: string,
  ) {
    const category =
      statusCode === 401 || statusCode === 403 ? "Auth error"
      : statusCode === 429 ? "Rate limited"
      : statusCode === 404 ? "Not found"
      : statusCode >= 500 ? "Upstream server error"
      : "HTTP error";
    super(`${category} ${statusCode} ${statusText} from ${stripApiKeys(url)}: ${responseBody.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

/** Remove API keys from URL query strings so they don't leak into error messages. */
function stripApiKeys(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.includes("key") || lower.includes("token") || lower.includes("secret") || lower.includes("auth")) {
        u.searchParams.set(key, "***");
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${stripApiKeys(url)}`);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request aborted: ${stripApiKeys(url)}`);
    }
    throw new Error(`Network error (fetch failed) for ${stripApiKeys(url)}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(could not read response body)");
    throw new HttpError(response.status, response.statusText, body, url);
  }

  return response.json() as Promise<T>;
}

export async function requestText(url: string, init?: RequestInit): Promise<string> {
  const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${stripApiKeys(url)}`);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request aborted: ${stripApiKeys(url)}`);
    }
    throw new Error(`Network error (fetch failed) for ${stripApiKeys(url)}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(could not read response body)");
    throw new HttpError(response.status, response.statusText, body, url);
  }

  return response.text();
}