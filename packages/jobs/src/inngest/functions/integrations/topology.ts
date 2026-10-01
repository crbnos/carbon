// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationTopology } from "@carbon/ee";
import type { IntegrationTopology } from "@carbon/ee/sync";
import { getLogger } from "@carbon/logger";

const logger = getLogger("jobs", "integration-topology");

/**
 * Read a company's integration topology.
 *
 * Lives in its own module because it imports the `@carbon/ee` BARREL — which
 * pulls every integration descriptor and validates the server env at import
 * time. Entry points (Inngest functions) import this; the decision cores take
 * the resolved topology as an argument and stay env-free and testable.
 */
export async function loadIntegrationTopology(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<IntegrationTopology> {
  const rows = await client
    .from("companyIntegration")
    // `metadata` carries the install mode, which is what decides a spend
    // provider's capabilities — without it push-only resolves as provider.
    .select("id, active, metadata")
    .eq("companyId", companyId);

  // "Carbon could not ask" is not "nobody owns it". An empty topology means no
  // ledger delegation, so a failed read would let TWO providers push the same
  // AP documents — fail the caller's step (Inngest retries it) instead.
  if (rows.error) {
    logger.error("Failed to read the company integration topology", {
      companyId,
      error: rows.error
    });
    throw new Error(
      `Failed to read integration topology for company ${companyId}: ${rows.error.message}`
    );
  }

  return resolveIntegrationTopology(rows.data ?? []);
}
