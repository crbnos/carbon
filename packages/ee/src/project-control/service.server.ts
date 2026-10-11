// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Server-only project control (Government Contracting 5c).
//
// `checkBudgetAvailability` is a RUNTIME path: without GOVERNMENT_CONTRACTING
// it degrades to "ok" through `companyHasFeature`, so a company that loses
// the feature can still save its documents.
//
// Reached only through `@carbon/ee/project-control.server` (`./server.ts`).
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5c.md (Task 8, C2–C5)

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { companyHasFeature } from "../plan.server";
import {
  budgetAvailability,
  type ElementNode,
  nearestBudgetedAncestor,
  subtreeIds
} from "./compute";
import {
  BUDGET_COMMITMENT_STATUSES,
  type BudgetCheckInput,
  type BudgetCheckResult,
  type BudgetOverrun
} from "./models";

const OK: BudgetCheckResult = { status: "ok", overruns: [] };

/**
 * Checks each charge against the budget of its nearest budgeted element
 * (C2–C4). The element's committed cost (open PO lines) and actual cost
 * (ledger rows without Burden) cover its whole subtree. The reads are 4
 * queries over all the charged projects. The `db` client bypasses RLS, so
 * every read is scoped by `companyId`.
 *
 * Status: `block` when an overrun is on a Block project and the source is not
 * a timesheet; `warn` when any overrun exists; else `ok`. A timesheet is never
 * refused for budget (DCAAM 7641.90).
 */
export async function checkBudgetAvailability(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  input: BudgetCheckInput
): Promise<BudgetCheckResult> {
  const { companyId, source } = input;
  if (input.charges.length === 0) return OK;
  if (
    !(await companyHasFeature(client, companyId, {
      feature: "GOVERNMENT_CONTRACTING"
    }))
  ) {
    return OK;
  }

  const projectIds = [...new Set(input.charges.map((c) => c.projectId))];
  const projects = await db
    .selectFrom("project")
    .select([
      "id",
      "name",
      "budgetControl",
      "budgetTolerancePercent",
      "ownerId"
    ])
    .where("companyId", "=", companyId)
    .where("id", "in", projectIds)
    .execute();
  const controlled = new Map(
    projects
      .filter((project) => project.budgetControl !== "None")
      .map((project) => [project.id, project])
  );
  const charges = input.charges.filter(
    (charge) => controlled.has(charge.projectId) && charge.projectElementId
  );
  if (charges.length === 0) return OK;

  const controlledIds = [...controlled.keys()];
  const excludeIds = [
    ...new Set(charges.flatMap((c) => c.excludePurchaseOrderLineIds ?? []))
  ];

  const [elements, commitments, actuals] = await Promise.all([
    db
      .selectFrom("projectElement")
      .select(["id", "projectId", "parentId", "budget", "readableId", "name"])
      .where("companyId", "=", companyId)
      .where("projectId", "in", controlledIds)
      .execute(),
    db
      .selectFrom("purchaseOrderLine as pol")
      .innerJoin("purchaseOrder as po", (join) =>
        join
          .onRef("po.id", "=", "pol.purchaseOrderId")
          .onRef("po.companyId", "=", "pol.companyId")
      )
      .select([
        "pol.projectElementId",
        sql<number>`SUM(GREATEST(pol."purchaseQuantity" - COALESCE(pol."quantityReceived", 0), 0) * COALESCE(pol."unitPrice", 0))`.as(
          "amount"
        )
      ])
      .where("pol.companyId", "=", companyId)
      .where("pol.projectId", "in", controlledIds)
      .where("pol.projectElementId", "is not", null)
      .where("po.status", "in", [...BUDGET_COMMITMENT_STATUSES])
      .$if(excludeIds.length > 0, (qb) =>
        qb.where("pol.id", "not in", excludeIds)
      )
      .groupBy("pol.projectElementId")
      .execute(),
    db
      .selectFrom("projectLedger")
      .select(["projectElementId", sql<number>`SUM("amount")`.as("amount")])
      .where("companyId", "=", companyId)
      .where("projectId", "in", controlledIds)
      .where("projectElementId", "is not", null)
      .where("costType", "!=", "Burden")
      .groupBy("projectElementId")
      .execute()
  ]);

  const elementsByProject = new Map<string, ElementNode[]>();
  const elementById = new Map(elements.map((e) => [e.id, e]));
  for (const element of elements) {
    const list = elementsByProject.get(element.projectId) ?? [];
    list.push({
      id: element.id,
      parentId: element.parentId,
      budget: element.budget === null ? null : Number(element.budget)
    });
    elementsByProject.set(element.projectId, list);
  }
  const committedById = new Map(
    commitments.map((row) => [row.projectElementId, Number(row.amount)])
  );
  const actualById = new Map(
    actuals.map((row) => [row.projectElementId, Number(row.amount)])
  );

  // The new amount per budgeted element. A charge with no budgeted ancestor
  // is outside budget control.
  const newAmountByAncestor = new Map<string, number>();
  for (const charge of charges) {
    const tree = elementsByProject.get(charge.projectId) ?? [];
    const ancestorId = nearestBudgetedAncestor(
      charge.projectElementId as string,
      tree
    );
    if (!ancestorId) continue;
    newAmountByAncestor.set(
      ancestorId,
      (newAmountByAncestor.get(ancestorId) ?? 0) + charge.amount
    );
  }

  const overruns: BudgetOverrun[] = [];
  for (const [ancestorId, newAmount] of newAmountByAncestor) {
    // A change that adds no cost cannot cause an overrun.
    if (newAmount <= 0) continue;
    const element = elementById.get(ancestorId);
    if (!element) continue;
    const project = controlled.get(element.projectId);
    if (!project) continue;
    const subtree = subtreeIds(
      ancestorId,
      elementsByProject.get(element.projectId) ?? []
    );
    const committed = subtree.reduce(
      (sum, id) => sum + (committedById.get(id) ?? 0),
      0
    );
    const actual = subtree.reduce(
      (sum, id) => sum + (actualById.get(id) ?? 0),
      0
    );
    const budget = Number(element.budget);
    const result = budgetAvailability({
      budget,
      committed,
      actual,
      newAmount,
      tolerancePercent: Number(project.budgetTolerancePercent ?? 0)
    });
    if (!result.over) continue;
    overruns.push({
      projectId: project.id,
      projectName: project.name,
      elementId: element.id,
      readableId: element.readableId,
      elementName: element.name,
      budget,
      projected: result.projected,
      overBy: result.overBy,
      budgetControl: project.budgetControl,
      ownerId: project.ownerId
    });
  }

  if (overruns.length === 0) return OK;
  const blocks =
    source !== "timesheet" &&
    overruns.some((overrun) => overrun.budgetControl === "Block");
  return { status: blocks ? "block" : "warn", overruns };
}
