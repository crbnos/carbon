// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "../entitlements.server";

/**
 * Commercial planning group AUTHORING (Projects Phase 3, `PLANNING_GROUPS`).
 * A planning group pools projects with project stock into one MRP netting
 * segment. The entitlement LOCK lives inside this function (see
 * `entitlements.server`), so it cannot be stripped from open-licensed app
 * code. Deleting a group stays in the community module: a company whose plan
 * lapsed can still clean up.
 *
 * The input shape is declared inline, so `@carbon/ee` never imports app code.
 */

type Enums = Database["public"]["Enums"];

type PlanningGroupFields = {
  name: string;
  locationId: string;
  excessRule: Enums["planningGroupExcessRule"];
  exceptionProjectId?: string | null;
  priorityRule: Enums["planningGroupPriorityRule"];
  active: boolean;
};

function refusal(message: string) {
  return {
    data: null,
    error: { message } as unknown as PostgrestError
  };
}

export async function upsertPlanningGroup(
  client: SupabaseClient<Database>,
  group:
    | (PlanningGroupFields & { companyId: string; createdBy: string })
    | (PlanningGroupFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  await requireEntitlement(client, group.companyId, "PLANNING_GROUPS");

  // The location column has a single-column foreign key, so the database
  // would take another company's location.
  const [location, exceptionProject] = await Promise.all([
    client
      .from("location")
      .select("id")
      .eq("id", group.locationId)
      .eq("companyId", group.companyId)
      .maybeSingle(),
    group.excessRule === "Exception Project" && group.exceptionProjectId
      ? client
          .from("project")
          .select("id, projectStock")
          .eq("id", group.exceptionProjectId)
          .eq("companyId", group.companyId)
          .maybeSingle()
      : Promise.resolve(null)
  ]);
  if (location.error) return refusal(location.error.message);
  if (!location.data) return refusal("Choose a location of this company");
  if (exceptionProject?.error) return refusal(exceptionProject.error.message);
  if (exceptionProject && !exceptionProject.data?.projectStock) {
    // Excess stock is received into the exception project's stripe.
    return refusal("The exception project must have project stock");
  }

  const fields = {
    name: group.name,
    locationId: group.locationId,
    excessRule: group.excessRule,
    exceptionProjectId:
      group.excessRule === "Exception Project"
        ? (group.exceptionProjectId ?? null)
        : null,
    priorityRule: group.priorityRule,
    active: group.active
  };

  if ("createdBy" in group) {
    return client
      .from("planningGroup")
      .insert({
        ...fields,
        companyId: group.companyId,
        createdBy: group.createdBy
      })
      .select("id")
      .single();
  }

  return client
    .from("planningGroup")
    .update({
      ...fields,
      updatedBy: group.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", group.id)
    .eq("companyId", group.companyId)
    .select("id")
    .single();
}
