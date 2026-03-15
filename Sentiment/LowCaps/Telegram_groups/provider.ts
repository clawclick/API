// DOCS: https://core.telegram.org/bots/api

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
};

type TelegramResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

function getBotToken(): string {
  return getRequiredEnv("TELEGRAM_BOT_TOKEN");
}

export function isTelegramConfigured(): boolean {
  return isConfigured(getOptionalEnv("TELEGRAM_BOT_TOKEN"));
}

/** GET /getMe – verify bot token and return bot info. */
export async function getMe(): Promise<TelegramResponse<TelegramUser>> {
  return requestJson<TelegramResponse<TelegramUser>>(
    `https://api.telegram.org/bot${getBotToken()}/getMe`,
  );
}
