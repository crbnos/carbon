// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { normalizeOnshapeUrl } from "./connection";
import { ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID } from "./integration-id";

const logger = getLogger("ee", "onshape", "panel-origin");

/**
 * `server` when an active `onshape-v2-government` connection names it as its
 * Onshape URL, else null. The panel route has no session, so an admin having
 * configured the origin is what makes it trusted.
 */
export async function getConfiguredOnshapePanelOrigin(
  server: string | null | undefined
): Promise<string | null> {
  if (!server) return null;
  // An exact https origin only, as the Onshape `server` parameter is.
  const origin = normalizeOnshapeUrl(server);
  if (!origin || origin !== server) return null;

  const result = await getCarbonServiceRole()
    .from("companyIntegration")
    .select("companyId")
    .eq("id", ONSHAPE_V2_GOVERNMENT_INTEGRATION_ID)
    .eq("active", true)
    .eq("metadata->>baseUrl", origin)
    .limit(1);
  if (result.error) {
    logger.error("Failed to read the Onshape Government panel origins", {
      error: result.error
    });
    return null;
  }
  return result.data.length > 0 ? origin : null;
}
