// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { APP_ENV } from "@carbon/env";
import { SenseProvider } from "../sense/provider";
import {
  DEFAULT_MINIMUM_STATE_SECONDS,
  type OeeProvider,
  type OeeProviderId
} from "./types";

type OeeProviderFactory = (args: {
  apiKey: string;
  environment: string;
}) => OeeProvider;

/**
 * Integration id → provider factory. The one place an OEE provider is named;
 * everything else finds OEE integrations through `getIntegrationIdsByRole("oee")`.
 */
export const OEE_PROVIDERS: Record<OeeProviderId, OeeProviderFactory> = {
  sense: (args) => {
    // Sense staging has no HTTPS endpoint, so its bearer key would travel in
    // plain text. Testing only: never in a production deployment.
    if (args.environment === "staging" && APP_ENV === "production") {
      throw new Error(SENSE_STAGING_REFUSED);
    }
    return new SenseProvider({
      apiKey: args.apiKey,
      environment: args.environment === "staging" ? "staging" : "production"
    });
  }
};

export const SENSE_STAGING_REFUSED =
  "Sense staging uses plain HTTP and is not available in production. Choose Production.";

export function isOeeProviderId(id: string): id is OeeProviderId {
  return Object.hasOwn(OEE_PROVIDERS, id);
}

/**
 * Builds the provider for an integration from its metadata (with the vaulted
 * `apiKey` already resolved). Throws when the id is not an OEE provider, when
 * the API key is empty, or when the provider's factory refuses the settings.
 */
export function createOeeProvider(
  integrationId: string,
  metadata: Record<string, unknown>
): { provider: OeeProvider; minimumStateSeconds: number } {
  if (!isOeeProviderId(integrationId)) {
    throw new Error(`${integrationId} is not an OEE provider`);
  }
  const apiKey = typeof metadata.apiKey === "string" ? metadata.apiKey : "";
  if (!apiKey) throw new Error("No API key");

  const provider = OEE_PROVIDERS[integrationId]({
    apiKey,
    environment: String(metadata.environment ?? "production")
  });

  const minimum = Number(metadata.minimumStateSeconds);
  return {
    provider,
    minimumStateSeconds:
      Number.isFinite(minimum) && minimum >= 0
        ? minimum
        : DEFAULT_MINIMUM_STATE_SECONDS
  };
}
