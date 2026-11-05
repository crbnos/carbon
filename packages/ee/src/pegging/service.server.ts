// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
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

/**
 * A planner's override of one Soft peg of a project: a Manual peg, with a
 * reason, on a PO line or job made for the same group and item. MRP keeps a
 * Manual peg on every run. One transaction:
 * 1. Lock the Soft peg it replaces and supersede it.
 * 2. Insert the Manual peg with the replaced peg's demand.
 * `db` writes past row-level security (`projectPeg` takes no direct write),
 * so the caller checks `update: projects` first. The entitlement LOCK is
 * here. The next MRP run re-pegs what the Manual peg does not cover.
 */
export async function createManualPeg(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    pegId: string;
    supplyType: "Purchase Order Line" | "Job";
    supplyId: string;
    quantity: number;
    manualReason: string;
  }
): Promise<{ id: string | null; error: string | null }> {
  await requireEntitlement(client, args.companyId, "PLANNING_GROUPS");
  const { companyId } = args;
  if (!(args.quantity > 0)) {
    return { id: null, error: "Quantity must be greater than 0" };
  }
  const reason = args.manualReason.trim();
  if (!reason) return { id: null, error: "Reason is required" };

  return db.transaction().execute(async (trx) => {
    const peg = await trx
      .selectFrom("projectPeg")
      .selectAll()
      .where("id", "=", args.pegId)
      .where("companyId", "=", companyId)
      .where("projectId", "=", args.projectId)
      .where("supersededAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!peg) {
      return { id: null, error: "The peg has changed. Reload the page." };
    }
    if (peg.state !== "Soft") {
      return { id: null, error: "Only a Soft peg can be overridden" };
    }

    // The supply must be open and made for the same group and item.
    const supply =
      args.supplyType === "Purchase Order Line"
        ? await trx
            .selectFrom("purchaseOrderLine")
            .select("id")
            .where("id", "=", args.supplyId)
            .where("companyId", "=", companyId)
            .where("planningGroupId", "=", peg.planningGroupId)
            .where("itemId", "=", peg.itemId)
            .where("receivedComplete", "=", false)
            .executeTakeFirst()
        : await trx
            .selectFrom("job")
            .select("id")
            .where("id", "=", args.supplyId)
            .where("companyId", "=", companyId)
            .where("planningGroupId", "=", peg.planningGroupId)
            .where("itemId", "=", peg.itemId)
            .where("status", "in", [
              "Planned",
              "Ready",
              "In Progress",
              "Paused"
            ])
            .executeTakeFirst();
    if (!supply) {
      return {
        id: null,
        error: "Choose an open order of the planning group for this item"
      };
    }

    await trx
      .updateTable("projectPeg")
      .set({ supersededAt: sql<string>`now()` })
      .where("id", "=", peg.id)
      .where("companyId", "=", companyId)
      .execute();
    const inserted = await trx
      .insertInto("projectPeg")
      .values({
        companyId,
        planningGroupId: peg.planningGroupId,
        itemId: peg.itemId,
        locationId: peg.locationId,
        supplyType: args.supplyType,
        supplyId: args.supplyId,
        projectId: peg.projectId,
        projectElementId: peg.projectElementId,
        demandSourceType: peg.demandSourceType,
        demandSourceId: peg.demandSourceId,
        parentPegId: peg.parentPegId,
        quantity: args.quantity,
        needDate: peg.needDate,
        state: "Manual",
        manualReason: reason,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id: inserted.id, error: null };
  });
}
