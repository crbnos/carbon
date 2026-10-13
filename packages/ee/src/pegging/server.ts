// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyHasFeature } from "../plan.server";
import { writeGroupPegs } from "./peg-writer";

export {
  MANUAL_PEG_WITHOUT_DEMAND,
  type WriteGroupPegsResult,
  writeGroupPegs
} from "./peg-writer";
// Server-only entry point (`@carbon/ee/pegging.server`): planning group
// authoring and the MRP run's peg writer. Never import from a client module.
export { createManualPeg, upsertPlanningGroup } from "./service.server";

/**
 * The commercial functions an MRP run needs for planning groups. A
 * server-side caller passes this object to `runMrp` as its `deps`.
 * `@carbon/planning` is reachable from the ERP client bundle, so it imports
 * no `.server` module itself. Without `deps`, a run degrades as it does for a
 * company without PLANNING_GROUPS.
 */
export const planningGroupMrpDeps = {
  companyHasPlanningGroups: (
    client: SupabaseClient<Database>,
    companyId: string
  ) => companyHasFeature(client, companyId, { feature: "PLANNING_GROUPS" }),
  writeGroupPegs
};
