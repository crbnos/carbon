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
