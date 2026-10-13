// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
  sense: (args) =>
    new SenseProvider({
      apiKey: args.apiKey,
      environment: args.environment === "staging" ? "staging" : "production"
    })
};
