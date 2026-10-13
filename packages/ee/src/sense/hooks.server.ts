// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createOeeProvider } from "../oee/registry";
import type { IntegrationHealthcheckResult } from "../types";

/** `metadata` arrives with the vaulted `apiKey` already resolved. */
export async function senseHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<IntegrationHealthcheckResult> {
  let provider: ReturnType<typeof createOeeProvider>["provider"];
  try {
    provider = createOeeProvider("sense", metadata).provider;
  } catch (error) {
    return {
      healthy: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  const { valid, error } = await provider.validate();
  return { healthy: valid, reason: error };
}
