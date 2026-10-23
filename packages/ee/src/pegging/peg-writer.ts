// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The peg writer (Projects Phase 3, `PLANNING_GROUPS`). The MRP run calls it
// inside the planning-action transaction, after the actions are written, so
// a peg on planned supply can name its `planningAction` id. That transaction
// already holds the company's advisory lock.
//
// A peg row is never updated in place. A changed peg is superseded
// (`supersededAt`, `supersededByRunId`) and a new row is inserted, so the
// table keeps the full history. The one in-place write here is a Manual
// peg's `exception`, which tells the planner its demand is gone.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import {
  type ComputedPeg,
  diffPegs,
  type ExistingPeg,
  type GroupPegInput,
  type PegPriorityRule,
  pegGroupSegment,
  splitGroupedJobDemand
} from "./mrp-pegging";

const BATCH_SIZE = 500;

export const MANUAL_PEG_WITHOUT_DEMAND = "Demand no longer exists";

type DemandSourceType = Database["public"]["Enums"]["demandSourceType"];

type CurrentPeg = ExistingPeg & {
  planningGroupId: string;
  itemId: string;
  locationId: string;
  exception: string | null;
};

export type WriteGroupPegsResult = {
  superseded: number;
  inserted: number;
  exceptionsSet: number;
  exceptionsCleared: number;
};

function segmentKeyOf(
  planningGroupId: string,
  itemId: string,
  locationId: string
): string {
  return [planningGroupId, itemId, locationId].join("\x1f");
}

/**
 * Diff-writes the pegs of every planning group of the company:
 * 1. Reads the current pegs (`supersededAt IS NULL`) in one query.
 * 2. Per (group, item, location), splits a grouped job's component demand by
 *    the job's pegs, pegs the group's supply, and diffs the Soft pegs.
 * 3. Supersedes the changed and stale Soft pegs, then inserts the new ones.
 * 4. Marks a Manual peg whose demand is gone, and clears the mark when its
 *    demand is back.
 * A current Soft peg of a (group, item, location) with no input has lost its
 * demand and its supply, so it is superseded.
 */
export async function writeGroupPegs(
  trx: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    runId: string;
    inputs: GroupPegInput[];
    priorityRuleByGroup: Record<string, PegPriorityRule>;
    priorityByProject: Record<string, number>;
  }
): Promise<WriteGroupPegsResult> {
  const { companyId, userId, runId } = args;

  const rows = await trx
    .selectFrom("projectPeg")
    .select([
      "id",
      "planningGroupId",
      "itemId",
      "locationId",
      "supplyType",
      "supplyId",
      "projectId",
      "projectElementId",
      "demandSourceType",
      "demandSourceId",
      "quantity",
      "state",
      "exception"
    ])
    .where("companyId", "=", companyId)
    .where("supersededAt", "is", null)
    .execute();

  const current: CurrentPeg[] = rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity)
  }));
  const currentBySegment = new Map<string, CurrentPeg[]>();
  for (const peg of current) {
    const key = segmentKeyOf(peg.planningGroupId, peg.itemId, peg.locationId);
    const list = currentBySegment.get(key) ?? [];
    list.push(peg);
    currentBySegment.set(key, list);
  }
  const jobPegs = current.filter((peg) => peg.supplyType === "Job");
  const priorityOf = (projectId: string) => args.priorityByProject[projectId];

  const supersedeIds: string[] = [];
  const inserts: (ComputedPeg & {
    planningGroupId: string;
    itemId: string;
    locationId: string;
  })[] = [];
  const setException: string[] = [];
  const clearException: string[] = [];
  const seen = new Set<string>();

  for (const input of args.inputs) {
    const key = segmentKeyOf(
      input.planningGroupId,
      input.itemId,
      input.locationId
    );
    seen.add(key);
    const existing = currentBySegment.get(key) ?? [];
    const result = pegGroupSegment({
      demands: splitGroupedJobDemand(input.demands, jobPegs, priorityOf),
      supplies: input.supplies,
      existing,
      priorityRule:
        args.priorityRuleByGroup[input.planningGroupId] ?? "Earliest Need"
    });
    const diff = diffPegs(
      existing.filter((peg) => peg.state === "Soft"),
      result.pegs
    );
    supersedeIds.push(...diff.supersedeIds);
    for (const peg of diff.inserts) {
      inserts.push({
        ...peg,
        planningGroupId: input.planningGroupId,
        itemId: input.itemId,
        locationId: input.locationId
      });
    }

    const withoutDemand = new Set(
      result.manualWithoutDemand.map((peg) => peg.id)
    );
    for (const peg of existing) {
      if (peg.state !== "Manual") continue;
      if (withoutDemand.has(peg.id)) {
        if (peg.exception !== MANUAL_PEG_WITHOUT_DEMAND) {
          setException.push(peg.id);
        }
      } else if (peg.exception !== null) {
        clearException.push(peg.id);
      }
    }
  }

  // A (group, item, location) with no demand and no supply this run.
  for (const [key, pegs] of currentBySegment) {
    if (seen.has(key)) continue;
    for (const peg of pegs) {
      if (peg.state === "Soft") supersedeIds.push(peg.id);
      if (
        peg.state === "Manual" &&
        peg.exception !== MANUAL_PEG_WITHOUT_DEMAND
      ) {
        setException.push(peg.id);
      }
    }
  }

  for (let i = 0; i < supersedeIds.length; i += BATCH_SIZE) {
    await trx
      .updateTable("projectPeg")
      .set({
        supersededAt: sql<string>`now()`,
        supersededByRunId: runId
      })
      .where("companyId", "=", companyId)
      .where("id", "in", supersedeIds.slice(i, i + BATCH_SIZE))
      .where("supersededAt", "is", null)
      .where("state", "=", "Soft")
      .execute();
  }

  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    await trx
      .insertInto("projectPeg")
      .values(
        inserts.slice(i, i + BATCH_SIZE).map((peg) => ({
          companyId,
          planningGroupId: peg.planningGroupId,
          itemId: peg.itemId,
          locationId: peg.locationId,
          supplyType: peg.supplyType,
          supplyId: peg.supplyId,
          projectId: peg.projectId,
          projectElementId: peg.projectElementId,
          demandSourceType: peg.demandSourceType as DemandSourceType,
          demandSourceId: peg.demandSourceId,
          parentPegId: peg.parentPegKey,
          quantity: peg.quantity,
          needDate: peg.needDate,
          state: "Soft" as const,
          createdByRunId: runId,
          createdBy: userId
        }))
      )
      .execute();
  }

  for (const [ids, exception] of [
    [setException, MANUAL_PEG_WITHOUT_DEMAND],
    [clearException, null]
  ] as const) {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      await trx
        .updateTable("projectPeg")
        .set({ exception })
        .where("companyId", "=", companyId)
        .where("id", "in", ids.slice(i, i + BATCH_SIZE))
        .where("state", "=", "Manual")
        .where("supersededAt", "is", null)
        .execute();
    }
  }

  return {
    superseded: supersedeIds.length,
    inserted: inserts.length,
    exceptionsSet: setException.length,
    exceptionsCleared: clearException.length
  };
}
