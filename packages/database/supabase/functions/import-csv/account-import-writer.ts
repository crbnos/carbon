// Applies an account ImportPlan inside a Kysely transaction. Kept apart from
// the planner so the planner and its tests import nothing from lib/.

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Transaction } from "npm:kysely@0.27.6";
import type { DB } from "../lib/database.ts";
import type { ImportPlan, PlanNode } from "./account-import.ts";

// ---------------------------------------------------------------------------

export type ApplyResult = {
  inserted: number;
  updated: number;
  // key → account id, for every node that now exists
  idByKey: Map<string, string>;
  csvMappings: Array<{ entityId: string; externalId: string }>;
};

// Applies a plan inside `trx`. Parents are inserted before children by walking
// the plan in its own (depth-first) order, so a single transaction suffices.
// Any DB error propagates and rolls back the whole import — the planner has
// already pre-checked uniques and system rows, so one here is a genuine bug or
// a concurrent edit, and the caller turns it into a 500.
export async function applyAccountPlan(
  trx: Transaction<DB>,
  plan: ImportPlan,
  args: {
    companyGroupId: string;
    userId: string;
    alreadyMappedEntityIds: Set<string>;
  }
): Promise<ApplyResult> {
  const now = new Date().toISOString();
  const idByKey = new Map<string, string>();
  const csvMappings: Array<{ entityId: string; externalId: string }> = [];
  let inserted = 0;
  let updated = 0;

  for (const node of plan.nodes) {
    if (node.existingId) idByKey.set(node.key, node.existingId);
  }

  const parentIdFor = (node: PlanNode): string | null => {
    if (node.parentKey) return idByKey.get(node.parentKey) ?? null;
    return node.parentId;
  };

  for (const node of plan.nodes) {
    if (node.action === "create") {
      const id = nanoid();
      const parentId = parentIdFor(node);
      if (node.parentKey && !parentId) {
        throw new Error(`Parent for "${node.name}" was not created`);
      }
      // The planner never emits a create without a resolved class; this guard
      // narrows the types for the NOT NULL columns.
      if (!node.class || !node.incomeBalance || !node.consolidatedRate) {
        throw new Error(`"${node.name}" has no class and cannot be created`);
      }
      await trx
        .insertInto("account")
        .values({
          id,
          name: node.name,
          number: node.number,
          class: node.class,
          incomeBalance: node.incomeBalance,
          accountType: node.accountType,
          consolidatedRate: node.consolidatedRate,
          isGroup: node.kind === "group",
          parentId,
          companyGroupId: args.companyGroupId,
          active: node.active,
          customFields: {},
          createdBy: args.userId,
          createdAt: now,
        })
        .execute();
      idByKey.set(node.key, id);
      inserted += 1;
      if (node.externalId) csvMappings.push({ entityId: id, externalId: node.externalId });
    } else if (node.action === "update" && node.existingId) {
      const set: Record<string, unknown> = { updatedBy: args.userId, updatedAt: now };
      for (const change of node.changes ?? []) {
        if (change.startsWith("name:")) set.name = node.name;
        else if (change.startsWith("number:")) set.number = node.number;
        else if (change.startsWith("type:")) set.accountType = node.accountType;
        else if (change.startsWith("class:")) {
          set.class = node.class;
          set.incomeBalance = node.incomeBalance;
          set.consolidatedRate = node.consolidatedRate;
        } else if (change.startsWith("parent:")) set.parentId = parentIdFor(node);
        else if (change === "deactivate") set.active = false;
        else if (change === "reactivate") set.active = true;
      }
      await trx
        .updateTable("account")
        .set(set)
        .where("id", "=", node.existingId)
        .execute();
      updated += 1;
      if (node.externalId && !args.alreadyMappedEntityIds.has(node.existingId)) {
        csvMappings.push({ entityId: node.existingId, externalId: node.externalId });
        args.alreadyMappedEntityIds.add(node.existingId);
      }
    } else if (
      (node.action === "unchanged" || node.action === "link") &&
      node.existingId &&
      node.externalId &&
      !args.alreadyMappedEntityIds.has(node.existingId)
    ) {
      csvMappings.push({ entityId: node.existingId, externalId: node.externalId });
      args.alreadyMappedEntityIds.add(node.existingId);
    }
  }

  return { inserted, updated, idByKey, csvMappings };
}
