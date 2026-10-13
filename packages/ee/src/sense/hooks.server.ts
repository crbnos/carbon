// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { OEE_PROVIDERS } from "../oee/registry";
import type { IntegrationHealthcheckResult } from "../types";

/** `metadata` arrives with the vaulted `apiKey` already resolved. */
export async function senseHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<IntegrationHealthcheckResult> {
  const apiKey = typeof metadata.apiKey === "string" ? metadata.apiKey : "";
  if (!apiKey) return { healthy: false, reason: "No API key" };
  const factory = OEE_PROVIDERS.sense;
  if (!factory) return { healthy: false, reason: "Sense is not registered" };
  let provider: ReturnType<typeof factory>;
  try {
    provider = factory({
      apiKey,
      environment: String(metadata.environment ?? "production")
    });
  } catch (error) {
    return {
      healthy: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  const { valid, error } = await provider.validate();
  return { healthy: valid, reason: error };
}
