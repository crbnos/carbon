// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Server-only readers of project control (Government Contracting 5c).
//
// Every read goes through the Kysely `db`, scoped by `companyId`, and covers
// all the requested projects in one statement (never one query per project).
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5c.md (Task 12, C11, C12)

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import type { IndirectPoolType } from "../indirect-rates/models";
import {
  acwpElementFor,
  holdUntilIssued,
  type MaterialIssue,
  type MaterialReceipt
} from "./compute";
import {
  ACWP_ELEMENTS,
  type AcwpElement,
  type EarnedValueTechnique
} from "./models";

/** The actual cost of work performed of one project element (C11). */
export type AcwpTotals = {
  /** Labor hours (Σ `quantity` of the Labor rows). */
  hours: number;
  byElement: Record<AcwpElement, number>;
  /** Labor, Material, Subcontract and Other Direct. */
  direct: number;
  /** Overhead and G&A (Burden rows). */
  burden: number;
};

/** ACWP per project, then per element. The project root's key is null. */
export type AcwpByProject = Map<string, Map<string | null, AcwpTotals>>;

const BURDEN_ELEMENTS = new Set<AcwpElement>(["Overhead", "G&A"]);

function emptyTotals(): AcwpTotals {
  return {
    hours: 0,
    byElement: Object.fromEntries(
      ACWP_ELEMENTS.map((element) => [element, 0])
    ) as Record<AcwpElement, number>,
    direct: 0,
    burden: 0
  };
}

function addAmount(
  byProject: AcwpByProject,
  projectId: string,
  elementId: string | null,
  element: AcwpElement,
  amount: number,
  hours = 0
) {
  const elements =
    byProject.get(projectId) ?? new Map<string | null, AcwpTotals>();
  const totals = elements.get(elementId) ?? emptyTotals();
  totals.byElement[element] += amount;
  if (BURDEN_ELEMENTS.has(element)) totals.burden += amount;
  else totals.direct += amount;
  totals.hours += hours;
  elements.set(elementId, totals);
  byProject.set(projectId, elements);
}

/** The day before a `YYYY-MM-DD` date. */
function dayBefore(date: string): string {
  return parseDate(date).subtract({ days: 1 }).toString();
}

/**
 * The ACWP of the projects from the project ledger, per project and element,
 * up to `to` and, when `from` is set, from `from` (a period read).
 *
 * - The element of cost comes from the ledger cost type (`acwpElementFor`,
 *   C11); a Burden row takes its pool's type.
 * - Material point of measurement Issue (C12): for a project with
 *   `materialMeasurementPoint = 'Issue'` and `chargeAtReceipt`, the Purchase
 *   Receipt Material rows are taken out and come back as the project stock
 *   issues consume them (`holdUntilIssued`, first in first out). A period
 *   read takes the difference of the rule at `from − 1 day` and at `to`.
 *
 * Reads: the ledger (one grouped statement); for Issue projects, the projects,
 * their receipt rows and their issues (3 more).
 */
export async function loadAcwp(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectIds: string[];
    from: string | null;
    to: string;
  }
): Promise<AcwpByProject> {
  const { companyId, projectIds, from, to } = args;
  const byProject: AcwpByProject = new Map();
  if (projectIds.length === 0) return byProject;

  const [ledger, issueProjects] = await Promise.all([
    db
      .selectFrom("projectLedger as pl")
      .leftJoin("indirectPool as ip", (join) =>
        join
          .onRef("ip.id", "=", "pl.indirectPoolId")
          .onRef("ip.companyId", "=", "pl.companyId")
      )
      .select([
        "pl.projectId",
        "pl.projectElementId",
        "pl.costType",
        "ip.poolType",
        sql<boolean>`pl."documentType" = 'Purchase Receipt'`.as("isReceipt"),
        sql<number>`SUM(pl."amount")`.as("amount"),
        sql<number>`SUM(CASE WHEN pl."costType" = 'Labor' THEN COALESCE(pl."quantity", 0) ELSE 0 END)`.as(
          "hours"
        )
      ])
      .where("pl.companyId", "=", companyId)
      .where("pl.projectId", "in", projectIds)
      .where("pl.postingDate", "<=", to)
      .$if(from !== null, (qb) =>
        qb.where("pl.postingDate", ">=", from as string)
      )
      .groupBy([
        "pl.projectId",
        "pl.projectElementId",
        "pl.costType",
        "ip.poolType",
        sql`pl."documentType" = 'Purchase Receipt'`
      ])
      .execute(),
    db
      .selectFrom("project")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", projectIds)
      .where("materialMeasurementPoint", "=", "Issue")
      .where("chargeAtReceipt", "=", true)
      .execute()
  ]);

  const heldProjects = new Set(issueProjects.map((project) => project.id));

  for (const row of ledger) {
    if (
      heldProjects.has(row.projectId) &&
      row.costType === "Material" &&
      row.isReceipt
    ) {
      continue;
    }
    addAmount(
      byProject,
      row.projectId,
      row.projectElementId,
      acwpElementFor(row.costType, row.poolType as IndirectPoolType | null),
      Number(row.amount),
      Number(row.hours)
    );
  }

  if (heldProjects.size > 0) {
    const held = [...heldProjects];
    const [receiptRows, issueRows] = await Promise.all([
      db
        .selectFrom("projectLedger")
        .select([
          "id",
          "reversalOfId",
          "projectId",
          "projectElementId",
          "itemId",
          "postingDate",
          "quantity",
          "amount"
        ])
        .where("companyId", "=", companyId)
        .where("projectId", "in", held)
        .where("documentType", "=", "Purchase Receipt")
        .where("costType", "=", "Material")
        .where("itemId", "is not", null)
        .where("postingDate", "<=", to)
        .execute(),
      db
        .selectFrom("itemLedger")
        .select([
          "projectId",
          "itemId",
          "postingDate",
          sql<number>`SUM(-"quantity")`.as("quantity")
        ])
        .where("companyId", "=", companyId)
        .where("projectId", "in", held)
        .where("documentType", "in", ["Project Issue", "Job Consumption"])
        .where("postingDate", "<=", to)
        .groupBy(["projectId", "itemId", "postingDate"])
        .execute()
    ]);

    // A voided receipt and its reversal cancel out: neither is stock to issue.
    const reversed = new Set(
      receiptRows.flatMap((row) => (row.reversalOfId ? [row.reversalOfId] : []))
    );
    const receiptsByProject = new Map<string, MaterialReceipt[]>();
    for (const row of receiptRows) {
      if (row.reversalOfId || reversed.has(row.id)) continue;
      const list = receiptsByProject.get(row.projectId) ?? [];
      list.push({
        projectElementId: row.projectElementId,
        itemId: row.itemId as string,
        postingDate: row.postingDate,
        quantity: Number(row.quantity ?? 0),
        amount: Number(row.amount)
      });
      receiptsByProject.set(row.projectId, list);
    }
    // A return to project stock is a positive Project Issue row, so the
    // negated sum nets it against the issues.
    const issuesByProject = new Map<string, MaterialIssue[]>();
    for (const row of issueRows) {
      if (!row.projectId) continue;
      const list = issuesByProject.get(row.projectId) ?? [];
      list.push({
        itemId: row.itemId,
        postingDate: row.postingDate,
        quantity: Number(row.quantity)
      });
      issuesByProject.set(row.projectId, list);
    }

    for (const projectId of held) {
      const receipts = receiptsByProject.get(projectId) ?? [];
      if (receipts.length === 0) continue;
      const issues = issuesByProject.get(projectId) ?? [];
      const atEnd = holdUntilIssued(receipts, issues, to);
      const atStart = from
        ? holdUntilIssued(receipts, issues, dayBefore(from))
        : new Map<string | null, number>();
      const elementIds = new Set([...atEnd.keys(), ...atStart.keys()]);
      for (const elementId of elementIds) {
        const amount = round(
          (atEnd.get(elementId) ?? 0) - (atStart.get(elementId) ?? 0)
        );
        if (amount === 0) continue;
        addAmount(byProject, projectId, elementId, "Material", amount);
      }
    }
  }

  for (const elements of byProject.values()) {
    for (const totals of elements.values()) {
      for (const element of ACWP_ELEMENTS) {
        totals.byElement[element] = round(totals.byElement[element]);
      }
      totals.direct = round(totals.direct);
      totals.burden = round(totals.burden);
      totals.hours = round(totals.hours);
    }
  }
  return byProject;
}

export type ProjectStateGroup =
  | "Backlog"
  | "Unstarted"
  | "Started"
  | "Completed"
  | "Cancelled";

/** The live element fields earned value reads (Task 13). */
export type EarnedValueElement = {
  id: string;
  parentId: string | null;
  readableId: string;
  name: string;
  isChargeable: boolean;
  isControlAccount: boolean;
  controlAccountManagerId: string | null;
  earnedValueTechnique: EarnedValueTechnique | null;
  earnedValuePercent: number | null;
  apportionedToElementId: string | null;
  apportionedFactor: number | null;
  stateGroup: ProjectStateGroup;
};

/** The parts of a baseline snapshot earned value reads (C6). */
export type EarnedValueBaseline = {
  id: string;
  /** Baseline element id → its `budget` and `parentId`. */
  elements: Map<string, { parentId: string | null; budget: number | null }>;
  /** Baseline element id → its `startDate` and `targetDate`. */
  schedule: Map<
    string,
    { startDate: string | null; targetDate: string | null }
  >;
};

export type ProjectWorkPackages = {
  projectId: string;
  elements: EarnedValueElement[];
  /** The latest baseline with `formatVersion` ≥ 2 taken on or before `asOf`. */
  baseline: EarnedValueBaseline | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10
    ? value.slice(0, 10)
    : null;
}

/** Reads the element rows and the schedule out of a stored snapshot. */
export function parseEarnedValueBaseline(
  id: string,
  snapshot: unknown
): EarnedValueBaseline {
  let value = snapshot;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const source = (value && typeof value === "object" ? value : {}) as {
    elements?: unknown;
    schedule?: unknown;
  };
  const elements = new Map<
    string,
    { parentId: string | null; budget: number | null }
  >();
  for (const row of Array.isArray(source.elements) ? source.elements : []) {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    elements.set(r.id, {
      parentId: typeof r.parentId === "string" ? r.parentId : null,
      budget: toNumberOrNull(r.budget)
    });
  }
  const schedule = new Map<
    string,
    { startDate: string | null; targetDate: string | null }
  >();
  for (const row of Array.isArray(source.schedule) ? source.schedule : []) {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    schedule.set(r.id, {
      startDate: toDateOrNull(r.startDate),
      targetDate: toDateOrNull(r.targetDate)
    });
  }
  return { id, elements, schedule };
}

/**
 * The elements, with their state group, and the qualifying baseline of each
 * project (C6, C7). Two reads for any number of projects: the elements
 * joined to their state, and the latest baseline per project with
 * `formatVersion` ≥ 2 whose `createdAt` falls on or before `asOf` on the
 * company's calendar.
 */
export async function loadWorkPackages(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectIds: string[]; asOf: string }
): Promise<Map<string, ProjectWorkPackages>> {
  const { companyId, projectIds, asOf } = args;
  const result = new Map<string, ProjectWorkPackages>();
  if (projectIds.length === 0) return result;

  const [elements, baselines] = await Promise.all([
    db
      .selectFrom("projectElement as e")
      .innerJoin("projectState as s", (join) =>
        join
          .onRef("s.id", "=", "e.stateId")
          .onRef("s.projectId", "=", "e.projectId")
          .onRef("s.companyId", "=", "e.companyId")
      )
      .select([
        "e.id",
        "e.projectId",
        "e.parentId",
        "e.readableId",
        "e.name",
        "e.isChargeable",
        "e.isControlAccount",
        "e.controlAccountManagerId",
        "e.earnedValueTechnique",
        "e.earnedValuePercent",
        "e.apportionedToElementId",
        "e.apportionedFactor",
        "s.group"
      ])
      .where("e.companyId", "=", companyId)
      .where("e.projectId", "in", projectIds)
      .execute(),
    sql<{ id: string; projectId: string; snapshot: unknown }>`
      SELECT DISTINCT ON (b."projectId") b."id", b."projectId", b."snapshot"
      FROM "projectBaseline" b
      JOIN "company" c ON c."id" = b."companyId"
      WHERE b."companyId" = ${companyId}
        AND b."projectId" IN (${sql.join(projectIds)})
        AND b."formatVersion" >= 2
        AND (b."createdAt" AT TIME ZONE COALESCE(c."timezone", 'UTC'))::date <= ${asOf}::date
      ORDER BY b."projectId", b."createdAt" DESC, b."sequence" DESC
    `.execute(db)
  ]);

  for (const projectId of projectIds) {
    result.set(projectId, { projectId, elements: [], baseline: null });
  }
  for (const element of elements) {
    result.get(element.projectId)?.elements.push({
      id: element.id,
      parentId: element.parentId,
      readableId: element.readableId,
      name: element.name,
      isChargeable: element.isChargeable,
      isControlAccount: element.isControlAccount,
      controlAccountManagerId: element.controlAccountManagerId,
      earnedValueTechnique: element.earnedValueTechnique,
      earnedValuePercent: toNumberOrNull(element.earnedValuePercent),
      apportionedToElementId: element.apportionedToElementId,
      apportionedFactor: toNumberOrNull(element.apportionedFactor),
      stateGroup: element.group
    });
  }
  for (const baseline of baselines.rows) {
    const project = result.get(baseline.projectId);
    if (project) {
      project.baseline = parseEarnedValueBaseline(
        baseline.id,
        baseline.snapshot
      );
    }
  }
  return result;
}
