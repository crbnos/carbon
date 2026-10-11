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
import { toJson } from "@carbon/database/json";
import { datetime, formatMoney, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { requireEntitlement } from "../entitlements.server";
import { loadRatePeriod } from "../indirect-rates/loaders.server";
import { companyHasFeature } from "../plan.server";
import {
  budgetAvailability,
  type ControlAccountValues,
  type ElementNode,
  earnedValue,
  nearestBudgetedAncestor,
  plannedValue,
  rollUpControlAccounts,
  subtreeIds,
  type WorkPackageValues
} from "./compute";
import {
  type AcwpTotals,
  type EarnedValueElement,
  loadAcwp,
  loadWorkPackages,
  type ProjectWorkPackages
} from "./loaders.server";
import {
  ACWP_ELEMENTS,
  type AcwpElement,
  BUDGET_COMMITMENT_STATUSES,
  type BudgetCheckInput,
  type BudgetCheckResult,
  type BudgetNotice,
  type BudgetOverrun,
  budgetNotices,
  budgetOverrunMessage,
  type EarnedValueTechnique,
  type elementEarnedValueValidator,
  type projectControlSettingsValidator
} from "./models";

const OK: BudgetCheckResult = { status: "ok", overruns: [] };

/**
 * Checks each charge against the budget of its nearest budgeted element
 * (C2–C4). The element's committed cost (open PO lines and the open
 * planning group supply pegged to the project) and actual cost (ledger rows
 * without Burden) cover its whole subtree. The reads are 5 queries over all
 * the charged projects. The `db` client bypasses RLS, so
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

  const [elements, commitments, pegCommitments, actuals] = await Promise.all([
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
    // The project's share of open grouped supply, as `get_project_cost_summary`
    // counts it (peg_commitments, 20261010161720): each current Soft or Manual
    // peg on a planning group PO line commits the pegged quantity (inventory
    // units) at the line's unit price (per purchase unit). A grouped line has
    // no `projectId`, so the query above cannot see it.
    db
      .selectFrom("projectPeg as pp")
      .innerJoin("purchaseOrderLine as pol", (join) =>
        join
          .onRef("pol.id", "=", "pp.supplyId")
          .onRef("pol.companyId", "=", "pp.companyId")
      )
      .innerJoin("purchaseOrder as po", (join) =>
        join
          .onRef("po.id", "=", "pol.purchaseOrderId")
          .onRef("po.companyId", "=", "pol.companyId")
      )
      .select([
        "pp.projectElementId",
        sql<number>`SUM(pp."quantity" / COALESCE(NULLIF(pol."conversionFactor", 0), 1) * COALESCE(pol."unitPrice", 0))`.as(
          "amount"
        )
      ])
      .where("pp.companyId", "=", companyId)
      .where("pp.projectId", "in", controlledIds)
      .where("pp.projectElementId", "is not", null)
      .where("pp.supplyType", "=", "Purchase Order Line")
      .where("pp.state", "in", ["Soft", "Manual"])
      .where("pp.supersededAt", "is", null)
      .where("po.status", "in", [...BUDGET_COMMITMENT_STATUSES])
      .$if(excludeIds.length > 0, (qb) =>
        qb.where("pol.id", "not in", excludeIds)
      )
      .groupBy("pp.projectElementId")
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
  const committedById = new Map<string | null, number>();
  for (const row of [...commitments, ...pegCommitments]) {
    committedById.set(
      row.projectElementId,
      (committedById.get(row.projectElementId) ?? 0) + Number(row.amount)
    );
  }
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

/** The locale of a budget message: a flash or a notice has no user locale. */
const BUDGET_MESSAGE_LOCALE = "en-US";

/**
 * A money formatter in the company's base currency, for budget messages and
 * notices. One read (the base currency).
 */
async function budgetMoneyFormatter(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<(value: number) => string> {
  const currency = await db
    .selectFrom("company as c")
    .innerJoin("currency as cur", (join) =>
      join
        .onRef("cur.code", "=", "c.baseCurrencyCode")
        .onRef("cur.companyGroupId", "=", "c.companyGroupId")
    )
    .select(["cur.code", "cur.decimalPlaces"])
    .where("c.id", "=", companyId)
    .executeTakeFirst();
  return (value: number) =>
    currency
      ? formatMoney(
          value,
          BUDGET_MESSAGE_LOCALE,
          currency.code,
          currency.decimalPlaces
        )
      : String(value);
}

/**
 * The overrun text of a check result in the company's base currency, or ""
 * when there is no overrun.
 */
export async function formatBudgetCheckMessage(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  result: Pick<BudgetCheckResult, "overruns">
): Promise<string> {
  if (result.overruns.length === 0) return "";
  return budgetOverrunMessage(
    result,
    await budgetMoneyFormatter(db, companyId)
  );
}

/**
 * The budget check of a saved timesheet entry (C4). The amount is hours × the
 * labor category's cost rate on the entry date: the rate with the latest
 * `effectiveFrom` on or before it, the rule `post-timesheet` posts with. A
 * timesheet is never refused: the status is "ok" or "warn". `notices` are
 * the `ProjectBudgetExceeded` notices for the Block projects' owners; the
 * caller sends them and never fails the entry for them.
 */
export async function checkTimesheetBudget(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    entryDate: string;
    hours: number;
  }
): Promise<BudgetCheckResult & { message: string; notices: BudgetNotice[] }> {
  if (!input.projectElementId || !(input.hours > 0)) {
    return { ...OK, message: "", notices: [] };
  }
  const rate = await db
    .selectFrom("laborCategoryRate")
    .select("costRate")
    .where("companyId", "=", input.companyId)
    .where("laborCategoryId", "=", input.laborCategoryId)
    .where("effectiveFrom", "<=", input.entryDate)
    .orderBy("effectiveFrom", "desc")
    .limit(1)
    .executeTakeFirst();
  const result = await checkBudgetAvailability(db, client, {
    companyId: input.companyId,
    source: "timesheet",
    charges: [
      {
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        amount: input.hours * Number(rate?.costRate ?? 0)
      }
    ]
  });
  if (result.overruns.length === 0) {
    return { ...result, message: "", notices: [] };
  }
  const money = await budgetMoneyFormatter(db, input.companyId);
  return {
    ...result,
    message: budgetOverrunMessage(result, money),
    notices: budgetNotices(result, money)
  };
}

// ── Earned value (Task 13, C6–C10, C13, C17) ──────────────────────────────

const FEATURE = "GOVERNMENT_CONTRACTING" as const;

/** The project statuses whose work packages earned value covers. */
const EARNED_VALUE_PROJECT_STATUSES = [
  "Released",
  "On Hold",
  "Technically Complete"
] as const;

export const TAKE_A_BASELINE_FIRST = "Take a baseline first";
export const EARNED_VALUE_PERIOD_NOT_LOCKED =
  "Lock the period before you close earned value.";
export const EARNED_VALUE_PERIOD_CLOSED =
  "This period is closed. Its earned value is frozen.";
export const CONTROL_ACCOUNT_REQUIRED =
  "Mark a control account above this element first.";

function refuse(message: string) {
  return { data: null, error: { message } } as const;
}

export type WorkPackageResult = WorkPackageValues & {
  projectId: string;
  projectElementId: string;
  readableId: string;
  name: string;
  technique: EarnedValueTechnique;
  baselineId: string | null;
  acwpByElement: Record<AcwpElement, number>;
};

export type ControlAccountResult = ControlAccountValues & {
  readableId: string;
  name: string;
  controlAccountManagerId: string | null;
};

export type ProjectEarnedValue = {
  workPackages: WorkPackageResult[];
  controlAccounts: ControlAccountResult[];
  warnings: string[];
};

function emptyAcwpByElement(): Record<AcwpElement, number> {
  return Object.fromEntries(ACWP_ELEMENTS.map((e) => [e, 0])) as Record<
    AcwpElement,
    number
  >;
}

/** The nearest control account above an element (never the element itself). */
function controlAccountAbove(
  elementId: string,
  byId: Map<string, EarnedValueElement>
): EarnedValueElement | null {
  const seen = new Set<string>([elementId]);
  let current = byId.get(elementId);
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) return null;
    if (parent.isControlAccount) return parent;
    current = parent;
  }
  return null;
}

/**
 * The earned value of one project at `periodEnd` (C6–C10). A work package is
 * an element with a technique whose nearest ancestor is a control account
 * (C7). BAC and the dates come from the baseline; the technique, the percent,
 * the base element and the state come from the live element. ACWP is the
 * direct cost of the work package's subtree: element budgets are direct
 * budgets (C3), so burden stays out of ACWP and CPI. `acwpByElement` keeps
 * every element of cost, burden included. Apportioned work packages are
 * computed last, from their base element's BCWP.
 */
export function computeProjectEarnedValue(
  project: ProjectWorkPackages,
  acwp: Map<string | null, AcwpTotals> | undefined,
  periodEnd: string
): ProjectEarnedValue {
  const byId = new Map(project.elements.map((e) => [e.id, e]));
  const tree: ElementNode[] = project.elements.map((e) => ({
    id: e.id,
    parentId: e.parentId,
    budget: null
  }));
  const packages = project.elements.flatMap((element) => {
    if (!element.earnedValueTechnique) return [];
    const controlAccount = controlAccountAbove(element.id, byId);
    return controlAccount
      ? [
          {
            element,
            technique: element.earnedValueTechnique,
            controlAccount
          }
        ]
      : [];
  });
  if (packages.length === 0) {
    return { workPackages: [], controlAccounts: [], warnings: [] };
  }
  const baseline = project.baseline;
  if (!baseline) {
    return {
      workPackages: [],
      controlAccounts: [],
      warnings: [TAKE_A_BASELINE_FIRST]
    };
  }

  const baselineChildren = new Map<string, string[]>();
  for (const [id, row] of baseline.elements) {
    if (!row.parentId) continue;
    const list = baselineChildren.get(row.parentId) ?? [];
    list.push(id);
    baselineChildren.set(row.parentId, list);
  }

  const bcwpById = new Map<string, number>();
  const results = new Map<string, WorkPackageResult>();
  const compute = (pkg: (typeof packages)[number]) => {
    const { element, technique, controlAccount } = pkg;
    const bac = baseline.elements.get(element.id)?.budget ?? 0;
    const dates = baseline.schedule.get(element.id);
    const childIds = baselineChildren.get(element.id) ?? [];
    const plannedMilestones = childIds.map((id) => ({
      budget: baseline.elements.get(id)?.budget ?? 0,
      targetDate: baseline.schedule.get(id)?.targetDate ?? null
    }));
    const bcws = plannedValue({
      technique,
      bac,
      start: dates?.startDate ?? null,
      end: dates?.targetDate ?? null,
      periodEnd,
      milestones: plannedMilestones
    });
    const bcwp = earnedValue({
      technique,
      bac,
      bcws,
      stateGroup: element.stateGroup,
      percent: element.earnedValuePercent,
      milestones: childIds.map((id) => ({
        budget: baseline.elements.get(id)?.budget ?? 0,
        completed: byId.get(id)?.stateGroup === "Completed"
      })),
      apportioned:
        technique === "Apportioned" && element.apportionedToElementId
          ? {
              factor: element.apportionedFactor ?? 0,
              baseBcwp: bcwpById.get(element.apportionedToElementId) ?? 0
            }
          : null
    });
    bcwpById.set(element.id, bcwp);

    const acwpByElement = emptyAcwpByElement();
    let direct = 0;
    let hours = 0;
    for (const id of subtreeIds(element.id, tree)) {
      const totals = acwp?.get(id);
      if (!totals) continue;
      for (const key of ACWP_ELEMENTS)
        acwpByElement[key] += totals.byElement[key];
      direct += totals.direct;
      hours += totals.hours;
    }
    for (const key of ACWP_ELEMENTS)
      acwpByElement[key] = round(acwpByElement[key]);

    results.set(element.id, {
      projectId: project.projectId,
      projectElementId: element.id,
      readableId: element.readableId,
      name: element.name,
      technique,
      baselineId: baseline.id,
      controlAccountId: controlAccount.id,
      bac: round(bac),
      bcws,
      bcwp,
      acwp: round(direct),
      acwpHours: round(hours),
      acwpByElement
    });
  };

  // Every other technique first; then Apportioned, repeating while a pass
  // resolves one whose base is ready, so a chain of Apportioned packages
  // reads each base's BCWP. An Apportioned package whose base is not a work
  // package (or a loop) reads a base BCWP of 0.
  const apportioned = packages.filter((p) => p.technique === "Apportioned");
  for (const pkg of packages) if (pkg.technique !== "Apportioned") compute(pkg);
  let pending = apportioned;
  while (pending.length > 0) {
    const ready = pending.filter(
      (p) =>
        !p.element.apportionedToElementId ||
        bcwpById.has(p.element.apportionedToElementId) ||
        !pending.some((q) => q.element.id === p.element.apportionedToElementId)
    );
    const next = ready.length > 0 ? ready : pending.slice(0, 1);
    for (const pkg of next) compute(pkg);
    pending = pending.filter((p) => !next.includes(p));
  }

  const workPackages = packages.flatMap((p) => {
    const result = results.get(p.element.id);
    return result ? [result] : [];
  });
  return {
    workPackages,
    controlAccounts: rollUpControlAccounts(workPackages).map((account) => {
      const element = byId.get(account.controlAccountId);
      return {
        ...account,
        readableId: element?.readableId ?? "",
        name: element?.name ?? "",
        controlAccountManagerId: element?.controlAccountManagerId ?? null
      };
    }),
    warnings: []
  };
}

/**
 * The live earned value of a project as of `asOf` (`YYYY-MM-DD`, the
 * company's day). A RUNTIME read: without `GOVERNMENT_CONTRACTING` it
 * returns `{ gated: true }` and reads nothing else.
 */
export async function getEarnedValue(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { companyId: string; projectId: string; asOf: string }
): Promise<({ gated: false } & ProjectEarnedValue) | { gated: true }> {
  const { companyId, projectId, asOf } = args;
  if (!(await companyHasFeature(client, companyId, { feature: FEATURE }))) {
    return { gated: true };
  }
  const [packages, acwp] = await Promise.all([
    loadWorkPackages(db, { companyId, projectIds: [projectId], asOf }),
    loadAcwp(db, { companyId, projectIds: [projectId], from: null, to: asOf })
  ]);
  const project = packages.get(projectId);
  if (!project) {
    return {
      gated: false,
      workPackages: [],
      controlAccounts: [],
      warnings: []
    };
  }
  return {
    gated: false,
    ...computeProjectEarnedValue(project, acwp.get(projectId), asOf)
  };
}

/**
 * The frozen snapshot of a project for one accounting period, rolled up per
 * control account the same way as `getEarnedValue`. Reads with the user's
 * client: `earnedValuePeriod` is readable by every employee of the company.
 */
export async function getEarnedValueSnapshots(
  client: SupabaseClient<Database>,
  args: { companyId: string; projectId: string; accountingPeriodId: string }
): Promise<ProjectEarnedValue> {
  const { companyId, projectId, accountingPeriodId } = args;
  const rows = await client
    .from("earnedValuePeriod")
    .select("*")
    .eq("companyId", companyId)
    .eq("projectId", projectId)
    .eq("accountingPeriodId", accountingPeriodId);
  if (rows.error) throw new Error(rows.error.message);
  const ids = [
    ...new Set(
      (rows.data ?? []).flatMap((r) => [r.projectElementId, r.controlAccountId])
    )
  ];
  const elements =
    ids.length === 0
      ? { data: [], error: null }
      : await client
          .from("projectElement")
          .select("id, readableId, name, controlAccountManagerId")
          .eq("companyId", companyId)
          .in("id", ids);
  if (elements.error) throw new Error(elements.error.message);
  const byId = new Map((elements.data ?? []).map((e) => [e.id, e]));

  const workPackages: WorkPackageResult[] = (rows.data ?? []).map((row) => ({
    projectId: row.projectId,
    projectElementId: row.projectElementId,
    readableId: byId.get(row.projectElementId)?.readableId ?? "",
    name: byId.get(row.projectElementId)?.name ?? "",
    technique: row.technique,
    baselineId: row.baselineId,
    controlAccountId: row.controlAccountId,
    bac: Number(row.bac),
    bcws: Number(row.bcws),
    bcwp: Number(row.bcwp),
    acwp: Number(row.acwp),
    acwpHours: Number(row.acwpHours),
    acwpByElement: {
      ...emptyAcwpByElement(),
      ...((row.acwpByElement ?? {}) as Partial<Record<AcwpElement, number>>)
    }
  }));
  return {
    workPackages,
    controlAccounts: rollUpControlAccounts(workPackages).map((account) => {
      const element = byId.get(account.controlAccountId);
      return {
        ...account,
        readableId: element?.readableId ?? "",
        name: element?.name ?? "",
        controlAccountManagerId: element?.controlAccountManagerId ?? null
      };
    }),
    warnings: []
  };
}

/**
 * Writes the earned value snapshot of a Locked period (C13): one
 * `earnedValuePeriod` row per work package of every Released, On Hold or
 * Technically Complete project, cumulative to the period end. A rerun
 * replaces the period's rows. The freeze trigger refuses any write once the
 * period is Closed, and reads the period `FOR SHARE`, so a close waits for
 * this transaction.
 */
export async function closeEarnedValuePeriod(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; accountingPeriodId: string }
): Promise<
  | {
      data: { projects: number; workPackages: number; warnings: string[] };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  const { companyId, userId, accountingPeriodId } = args;
  await requireEntitlement(client, companyId, FEATURE);

  const period = await loadRatePeriod(db, { companyId, accountingPeriodId });
  if (period.period.closeStatus === "Closed") {
    return refuse(EARNED_VALUE_PERIOD_CLOSED);
  }
  if (period.period.closeStatus !== "Locked") {
    return refuse(EARNED_VALUE_PERIOD_NOT_LOCKED);
  }
  const periodEnd = period.period.endDate;

  const projects = await db
    .selectFrom("project as p")
    .select(["p.id", "p.name"])
    .where("p.companyId", "=", companyId)
    .where("p.status", "in", [...EARNED_VALUE_PROJECT_STATUSES])
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom("projectElement as e")
          .select("e.id")
          .whereRef("e.projectId", "=", "p.id")
          .whereRef("e.companyId", "=", "p.companyId")
          .where("e.earnedValueTechnique", "is not", null)
      )
    )
    .execute();
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) {
    return {
      data: { projects: 0, workPackages: 0, warnings: [] },
      error: null
    };
  }

  const [packages, acwp] = await Promise.all([
    loadWorkPackages(db, { companyId, projectIds, asOf: periodEnd }),
    loadAcwp(db, { companyId, projectIds, from: null, to: periodEnd })
  ]);

  const warnings: string[] = [];
  const rows: WorkPackageResult[] = [];
  let projectCount = 0;
  for (const project of projects) {
    const loaded = packages.get(project.id);
    if (!loaded) continue;
    const result = computeProjectEarnedValue(
      loaded,
      acwp.get(project.id),
      periodEnd
    );
    for (const warning of result.warnings) {
      warnings.push(`${project.name}: ${warning}`);
    }
    if (result.workPackages.length > 0) projectCount += 1;
    rows.push(...result.workPackages);
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("earnedValuePeriod")
      .where("companyId", "=", companyId)
      .where("accountingPeriodId", "=", accountingPeriodId)
      .where("projectId", "in", projectIds)
      .execute();
    if (rows.length === 0) return;
    await trx
      .insertInto("earnedValuePeriod")
      .values(
        rows.map((row) => ({
          companyId,
          projectId: row.projectId,
          projectElementId: row.projectElementId,
          controlAccountId: row.controlAccountId,
          accountingPeriodId,
          fiscalYear: period.fiscalYear,
          periodNumber: period.periodNumber,
          technique: row.technique,
          baselineId: row.baselineId,
          bac: row.bac,
          bcws: row.bcws,
          bcwp: row.bcwp,
          acwp: row.acwp,
          acwpHours: row.acwpHours,
          acwpByElement: toJson(row.acwpByElement),
          createdBy: userId
        }))
      )
      .execute();
  });

  return {
    data: { projects: projectCount, workPackages: rows.length, warnings },
    error: null
  };
}

/** Saves the budget control fields of a project (authoring, entitled). */
export async function updateProjectControlSettings(
  client: SupabaseClient<Database>,
  input: z.infer<typeof projectControlSettingsValidator> & {
    companyId: string;
    userId: string;
  }
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  return client
    .from("project")
    .update({
      budgetControl: input.budgetControl,
      budgetTolerancePercent: input.budgetTolerancePercent ?? null,
      materialMeasurementPoint: input.materialMeasurementPoint,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.projectId)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

/**
 * Saves the earned value fields of an element (authoring, entitled). A
 * technique needs a chargeable element below a control account. Fields the
 * technique does not use are cleared, so the CHECKs hold.
 */
export async function updateElementEarnedValue(
  client: SupabaseClient<Database>,
  input: z.infer<typeof elementEarnedValueValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId } = input;
  await requireEntitlement(client, companyId, FEATURE);

  const element = await client
    .from("projectElement")
    .select("id, projectId, isChargeable")
    .eq("id", input.elementId)
    .eq("companyId", companyId)
    .single();
  if (element.error) return { data: null, error: element.error };

  const technique = input.isControlAccount
    ? null
    : (input.earnedValueTechnique ?? null);
  if (technique) {
    if (!element.data.isChargeable) {
      return refuse(
        "Only a chargeable element takes an earned value technique."
      );
    }
    const elements = await client
      .from("projectElement")
      .select("id, parentId, isControlAccount")
      .eq("projectId", element.data.projectId)
      .eq("companyId", companyId);
    if (elements.error) return { data: null, error: elements.error };
    const byId = new Map(
      (elements.data ?? []).map((e) => [
        e.id,
        {
          ...e,
          isControlAccount:
            e.id === input.elementId ? false : e.isControlAccount
        }
      ])
    );
    const seen = new Set<string>([input.elementId]);
    let parentId = byId.get(input.elementId)?.parentId ?? null;
    let found = false;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.isControlAccount) {
        found = true;
        break;
      }
      parentId = parent.parentId;
    }
    if (!found) return refuse(CONTROL_ACCOUNT_REQUIRED);
    if (
      technique === "Apportioned" &&
      input.apportionedToElementId === input.elementId
    ) {
      return refuse("An element cannot be apportioned to itself.");
    }
  }

  return client
    .from("projectElement")
    .update({
      isControlAccount: input.isControlAccount,
      controlAccountManagerId: input.isControlAccount
        ? (input.controlAccountManagerId ?? null)
        : null,
      earnedValueTechnique: technique,
      earnedValuePercent:
        technique === "Percent Complete"
          ? (input.earnedValuePercent ?? null)
          : null,
      apportionedToElementId:
        technique === "Apportioned"
          ? (input.apportionedToElementId ?? null)
          : null,
      apportionedFactor:
        technique === "Apportioned" ? (input.apportionedFactor ?? null) : null,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.elementId)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

// ── The ACWP export (Task 15, C15) ─────────────────────────────────────────

export const ACWP_PERIOD_NOT_CLOSED =
  "Close the period before you export its actual cost.";

/** The columns of the ACWP export, in order. Cobra maps them on import. */
export const ACWP_EXPORT_FIELDS = [
  "Project",
  "Charge Number",
  "Element",
  "Control Account",
  "Fiscal Year",
  "Period",
  "Element of Cost",
  "Cost Class",
  "Hours",
  "Amount"
];

/**
 * The period-closed ACWP for Cobra (C15): one row per charge number × element
 * of cost with a non-zero amount, in hours (Labor rows only) and dollars,
 * marked Direct or Burden. The projects are the Direct cost objective ones,
 * or only `projectId` when it is set. Refuses unless the period is Closed.
 */
export async function buildAcwpExport(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { companyId: string; accountingPeriodId: string; projectId?: string }
): Promise<
  | {
      data: {
        fields: string[];
        rows: (string | number)[][];
        fiscalYear: number;
        periodNumber: number;
      };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  const { companyId, accountingPeriodId, projectId } = args;
  await requireEntitlement(client, companyId, FEATURE);

  const period = await loadRatePeriod(db, { companyId, accountingPeriodId });
  if (period.period.closeStatus !== "Closed") {
    return refuse(ACWP_PERIOD_NOT_CLOSED);
  }

  const projects = await db
    .selectFrom("project")
    .select(["id", "identifier", "name"])
    .where("companyId", "=", companyId)
    .$if(!!projectId, (qb) => qb.where("id", "=", projectId as string))
    .$if(!projectId, (qb) => qb.where("costObjective", "=", "Direct"))
    .orderBy("identifier")
    .execute();
  const projectIds = projects.map((p) => p.id);
  const result = {
    fields: ACWP_EXPORT_FIELDS,
    rows: [] as (string | number)[][],
    fiscalYear: period.fiscalYear,
    periodNumber: period.periodNumber
  };
  if (projectIds.length === 0) return { data: result, error: null };

  const [acwp, elements] = await Promise.all([
    loadAcwp(db, {
      companyId,
      projectIds,
      from: period.period.startDate,
      to: period.period.endDate
    }),
    db
      .selectFrom("projectElement")
      .select(["id", "parentId", "readableId", "name", "isControlAccount"])
      .where("companyId", "=", companyId)
      .where("projectId", "in", projectIds)
      .execute()
  ]);
  const elementById = new Map(elements.map((e) => [e.id, e]));
  const nearestControlAccount = (elementId: string): string => {
    const seen = new Set<string>();
    let current = elementById.get(elementId);
    while (current && !seen.has(current.id)) {
      if (current.isControlAccount) return current.readableId;
      seen.add(current.id);
      current = current.parentId
        ? elementById.get(current.parentId)
        : undefined;
    }
    return "";
  };

  for (const project of projects) {
    const byElement = acwp.get(project.id);
    if (!byElement) continue;
    const identifier = project.identifier ?? project.name;
    const lines = [...byElement.entries()]
      .map(([elementId, totals]) => {
        const element = elementId ? elementById.get(elementId) : undefined;
        return {
          chargeNumber: element?.readableId ?? identifier,
          name: element?.name ?? project.name,
          controlAccount: elementId ? nearestControlAccount(elementId) : "",
          totals
        };
      })
      .sort((a, b) => a.chargeNumber.localeCompare(b.chargeNumber));
    for (const line of lines) {
      for (const elementOfCost of ACWP_ELEMENTS) {
        const amount = line.totals.byElement[elementOfCost];
        if (!amount) continue;
        result.rows.push([
          identifier,
          line.chargeNumber,
          line.name,
          line.controlAccount,
          period.fiscalYear,
          period.periodNumber,
          elementOfCost,
          elementOfCost === "Overhead" || elementOfCost === "G&A"
            ? "Burden"
            : "Direct",
          elementOfCost === "Labor" ? line.totals.hours : "",
          amount
        ]);
      }
    }
  }
  return { data: result, error: null };
}
