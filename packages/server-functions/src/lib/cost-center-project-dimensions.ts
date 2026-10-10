// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB, Kysely } from "@carbon/database/client";

/**
 * The dimension a charge or reimbursement line's cost center and project
 * post under: the oldest active Cost Center and Project dimension of the
 * company group, or null when the group has none. One read for both.
 */
export async function costCenterAndProjectDimensions(
  trx: Kysely<DB>,
  companyGroupId: string | null
): Promise<{ costCenter: string | null; project: string | null }> {
  // A company in no group has no dimensions.
  if (!companyGroupId) return { costCenter: null, project: null };
  const dimensions = await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["CostCenter", "Project"])
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return {
    costCenter:
      dimensions.find((dimension) => dimension.entityType === "CostCenter")
        ?.id ?? null,
    project:
      dimensions.find((dimension) => dimension.entityType === "Project")?.id ??
      null
  };
}
