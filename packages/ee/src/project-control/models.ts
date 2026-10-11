// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Constants, type Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";

// Government Contracting Phase 5c: budget control, earned value and stop-work orders.
// Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5c)
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5c.md

export type BudgetControl = Database["public"]["Enums"]["budgetControl"];
export type EarnedValueTechnique =
  Database["public"]["Enums"]["earnedValueTechnique"];

export const budgetControls = Constants.public.Enums.budgetControl;
export const earnedValueTechniques =
  Constants.public.Enums.earnedValueTechnique;

/** The material point of measurement (EIA-748 E14, decision C12). */
export const MATERIAL_MEASUREMENT_POINTS = ["Receipt", "Issue"] as const;
export type MaterialMeasurementPoint =
  (typeof MATERIAL_MEASUREMENT_POINTS)[number];

/** The elements of cost of the ACWP (decision C11). */
export const ACWP_ELEMENTS = [
  "Labor",
  "Material",
  "Subcontract",
  "Other Direct",
  "Overhead",
  "G&A"
] as const;
export type AcwpElement = (typeof ACWP_ELEMENTS)[number];

/** The days a stop-work order lasts (FAR 52.242-15). */
export const STOP_WORK_DAYS = 90;

/** The PO statuses whose open lines commit budget, as in `get_project_cost_summary`. */
export const BUDGET_COMMITMENT_STATUSES = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Planned"
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const projectControlSettingsValidator = z.object({
  projectId: z.string().min(1, { message: "Project is required" }),
  budgetControl: z.enum(budgetControls, {
    error: "Budget control is required"
  }),
  budgetTolerancePercent: zfd.numeric(
    z.number().min(0, { message: "Tolerance must be 0 or more" }).optional()
  ),
  materialMeasurementPoint: z.enum(MATERIAL_MEASUREMENT_POINTS, {
    error: "Material measurement point is required"
  })
});

export const elementEarnedValueValidator = z
  .object({
    elementId: z.string().min(1, { message: "Element is required" }),
    isControlAccount: zfd.checkbox(),
    controlAccountManagerId: zfd.text(z.string().optional()),
    earnedValueTechnique: zfd.text(z.enum(earnedValueTechniques).optional()),
    earnedValuePercent: zfd.numeric(
      z
        .number()
        .min(0, { message: "Percent complete must be 0 or more" })
        .max(1, { message: "Percent complete must be 100% or less" })
        .optional()
    ),
    apportionedToElementId: zfd.text(z.string().optional()),
    apportionedFactor: zfd.numeric(z.number().optional())
  })
  .refine((data) => !(data.isControlAccount && data.earnedValueTechnique), {
    message: "A control account has no earned value technique",
    path: ["earnedValueTechnique"]
  })
  .refine(
    (data) =>
      data.earnedValueTechnique !== "Apportioned" ||
      (!!data.apportionedToElementId && (data.apportionedFactor ?? 0) > 0),
    {
      message: "Apportioned needs a base element and a factor above 0",
      path: ["apportionedFactor"]
    }
  );

export const stopWorkValidator = z.object({
  projectId: z.string().min(1, { message: "Project is required" }),
  orderDate: z
    .string()
    .regex(ISO_DATE, { message: "Order date must be YYYY-MM-DD" })
});

// ── Budget availability (decisions C2–C5) ──────────────────────────────────

/** One amount a document charges to a project element. */
export type BudgetCharge = {
  projectId: string;
  projectElementId: string | null;
  amount: number;
  /** The saved PO lines the charge replaces, so their commitment is not counted twice (C2). */
  excludePurchaseOrderLineIds?: string[];
};

export type BudgetCheckSource = "purchase" | "issue" | "job" | "timesheet";

export type BudgetCheckInput = {
  companyId: string;
  source: BudgetCheckSource;
  charges: BudgetCharge[];
};

export type BudgetOverrun = {
  projectId: string;
  projectName: string;
  elementId: string;
  readableId: string;
  elementName: string;
  budget: number;
  projected: number;
  overBy: number;
  budgetControl: BudgetControl;
  ownerId: string | null;
};

export type BudgetCheckResult = {
  status: "ok" | "warn" | "block";
  overruns: BudgetOverrun[];
};

/**
 * The overrun text a flash or a notice shows. Each overrun reads
 * "<readableId> <elementName> goes over its budget of <budget> by <overBy>."
 */
export function budgetOverrunMessage(
  result: Pick<BudgetCheckResult, "overruns">,
  formatMoney: (n: number) => string
): string {
  return result.overruns
    .map(
      (overrun) =>
        `${overrun.readableId} ${overrun.elementName} goes over its budget of ${formatMoney(overrun.budget)} by ${formatMoney(overrun.overBy)}.`
    )
    .join(" ");
}

/**
 * The `ProjectBudgetExceeded` notices of a timesheet check: one per Block
 * project with an owner, with that project's overruns (C4, CAM 6-404.6(10)).
 */
export type BudgetNotice = {
  projectId: string;
  ownerId: string;
  title: string;
  body: string;
};

export function budgetNotices(
  result: Pick<BudgetCheckResult, "overruns">,
  formatMoney: (n: number) => string
): BudgetNotice[] {
  const byProject = new Map<string, BudgetOverrun[]>();
  for (const overrun of result.overruns) {
    if (overrun.budgetControl !== "Block" || !overrun.ownerId) continue;
    const list = byProject.get(overrun.projectId) ?? [];
    list.push(overrun);
    byProject.set(overrun.projectId, list);
  }
  return [...byProject.values()].map((overruns) => {
    const first = overruns[0] as BudgetOverrun;
    return {
      projectId: first.projectId,
      ownerId: first.ownerId as string,
      title: `Budget exceeded on ${first.projectName}`,
      body: budgetOverrunMessage({ overruns }, formatMoney)
    };
  });
}
