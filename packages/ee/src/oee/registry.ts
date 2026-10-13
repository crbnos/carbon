// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { APP_ENV } from "@carbon/env";
import { SenseProvider } from "../sense/provider";
import type { OeeProvider } from "./types";

type OeeProviderFactory = (args: {
  apiKey: string;
  environment: string;
}) => OeeProvider;

/**
 * Integration id → provider factory. The one place an OEE provider is named;
 * everything else finds OEE integrations through `getIntegrationIdsByRole("oee")`.
 */
export const OEE_PROVIDERS: Record<string, OeeProviderFactory> = {
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
