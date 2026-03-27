export const BASE_URL = process.env.SIGNAL_SOL_API_BASE_URL?.trim() || "https://api.claw.click";

const configuredApiKey = process.env.SIGNAL_SOL_API_KEY?.trim();

export const API_HEADERS = configuredApiKey
  ? { "x-api-key": configuredApiKey }
  : {};
