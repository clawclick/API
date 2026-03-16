import type { ProviderStatus } from "#types/api";

export function addStatus(
  statuses: ProviderStatus[],
  provider: string,
  status: ProviderStatus["status"],
  detail?: string,
): void {
  statuses.push({ provider, status, detail });
}

/**
 * Runs a single provider task with automatic error handling.
 *
 * - If `shouldRun` is false the provider is marked "skipped" and `null` is returned.
 * - If the task throws, the error is captured into the `statuses` array as
 *   "error" with a human-readable detail string and `null` is returned so the
 *   caller can gracefully degrade (partial response).
 */
export async function runProvider<T>(
  statuses: ProviderStatus[],
  provider: string,
  shouldRun: boolean,
  task: () => Promise<T>,
  skipReason = "Provider not configured or not supported for this chain.",
): Promise<T | null> {
  if (!shouldRun) {
    addStatus(statuses, provider, "skipped", skipReason);
    return null;
  }

  try {
    const result = await task();
    addStatus(statuses, provider, "ok");
    return result;
  } catch (error: unknown) {
    const detail = formatProviderError(error);
    addStatus(statuses, provider, "error", detail);
    return null;
  }
}

export function summarizeStatus(statuses: ProviderStatus[]): "live" | "partial" {
  return statuses.some((s) => s.status === "ok") ? "live" : "partial";
}

/** Extracts a concise, actionable error message from any thrown value. */
function formatProviderError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name !== "Error" ? `[${error.name}] ` : "";
    return `${name}${error.message}`;
  }
  return String(error);
}
