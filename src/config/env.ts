import { config } from "dotenv";

config();

const placeholderPrefixes = ["replace_", "your_"];

export function getOptionalEnv(name: string, fallback = ""): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function isConfigured(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return !placeholderPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

export function getRequiredEnv(name: string): string {
  const value = getOptionalEnv(name);
  if (!isConfigured(value)) {
    throw new Error(`Set a real value for ${name} in the root .env file.`);
  }
  return value;
}

export const runtimeEnv = {
  host: getOptionalEnv("HOST", "0.0.0.0"),
  port: Number(getOptionalEnv("PORT", "3000"))
};