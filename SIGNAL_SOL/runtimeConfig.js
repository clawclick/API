export const BASE_URL = "https://api.claw.click";

const configuredApiKey = 'click_a87f5eaa6d8c3f1c05e801697f9a3c4076d8de970012e1bf'
export const API_HEADERS = configuredApiKey
  ? { "x-api-key": configuredApiKey }
  : {};
