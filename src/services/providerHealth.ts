import { getOptionalEnv, isConfigured } from "#config/env";
import { providerRegistry } from "#services/providerRegistry";
import type { EndpointName } from "#types/domain";

export function getProviderHealth(endpoint?: EndpointName) {
  return providerRegistry
    .filter((provider) => !endpoint || provider.endpoints.includes(endpoint))
    .map((provider) => ({
      id: provider.id,
      label: provider.label,
      folder: provider.folder,
      category: provider.category,
      configured: provider.env.every((envName) => isConfigured(getOptionalEnv(envName)))
    }));
}