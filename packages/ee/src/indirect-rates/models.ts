// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Constants, type Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";

// Government Contracting Phase 5b: indirect pools, rates and burden.
// Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5b)
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md

export type IndirectPoolType = Database["public"]["Enums"]["indirectPoolType"];
export type IndirectBaseType = Database["public"]["Enums"]["indirectBaseType"];
export type IndirectRateType = Database["public"]["Enums"]["indirectRateType"];
export type IndirectPoolAccountRole =
  Database["public"]["Enums"]["indirectPoolAccountRole"];

export const indirectPoolTypes = Constants.public.Enums.indirectPoolType;
export const indirectBaseTypes = Constants.public.Enums.indirectBaseType;
export const indirectRateTypes = Constants.public.Enums.indirectRateType;
export const indirectPoolAccountRoles =
  Constants.public.Enums.indirectPoolAccountRole;

/** The rate types a user enters. Only the rate run writes Actual rates (B12). */
export const enteredIndirectRateTypes = [
  "Provisional",
  "Target",
  "Final"
] as const satisfies readonly IndirectRateType[];

/** The rate types a company can burden projects with (B9). */
export const burdenRateTypes = [
  "Provisional",
  "Actual"
] as const satisfies readonly IndirectRateType[];

export type BaseBucket =
  | "Labor"
  | "LaborHours"
  | "Material"
  | "Subcontract"
  | "Other";

/** The base buckets each project cost type feeds. Burden rows feed no base. */
export const PROJECT_BASE_BUCKETS: Record<
  Database["public"]["Enums"]["projectCostType"],
  BaseBucket[]
> = {
  Labor: ["Labor", "LaborHours"],
  Material: ["Material"],
  "Material Variance": ["Material"],
  "Payback Variance": ["Material"],
  "Outside Processing": ["Subcontract"],
  "Purchased Service": ["Subcontract"],
  Machine: ["Other"],
  Overhead: ["Other"],
  "Other Direct": ["Other"],
  Burden: []
};

/** The buckets each base type sums. Value Added is TCI − material − subcontract. */
export const BASE_TYPE_BUCKETS: Record<IndirectBaseType, BaseBucket[]> = {
  "Total Labor Dollars": ["Labor"],
  "Direct Labor Dollars": ["Labor"],
  "Direct Labor Hours": ["LaborHours"],
  "Direct Material Dollars": ["Material"],
  "Total Cost Input": ["Labor", "Material", "Subcontract", "Other"],
  "Value Added": ["Labor", "Other"]
};

/** Cost objectives whose project cost is in a pool base (B2). */
export const BURDENED_COST_OBJECTIVES = [
  "Direct",
  "Commercial",
  "IR&D",
  "B&P"
] as const;

export const ICE_SCHEDULES = [
  "A",
  "B",
  "C",
  "E",
  "G",
  "H",
  "I",
  "K",
  "L"
] as const;

export const indirectPoolValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    poolType: z.enum(indirectPoolTypes, {
      error: "Pool type is required"
    }),
    sequence: zfd.numeric(
      z
        .number()
        .int({ message: "Sequence must be a whole number" })
        .min(1, { message: "Sequence must be 1 or more" })
    ),
    baseType: z.enum(indirectBaseTypes, {
      error: "Base type is required"
    }),
    appliedAccountId: zfd.text(z.string().optional()),
    appliesToProjects: zfd.checkbox(),
    offsetAbsorbedOverhead: zfd.checkbox(),
    active: zfd.checkbox()
  })
  .refine(
    (data) => !data.offsetAbsorbedOverhead || data.poolType === "Overhead",
    {
      message: "Only an Overhead pool can offset absorbed overhead",
      path: ["offsetAbsorbedOverhead"]
    }
  )
  .refine(
    (data) => data.poolType !== "Service Center" || !data.appliesToProjects,
    {
      message: "A Service Center pool cannot apply to projects",
      path: ["appliesToProjects"]
    }
  );

export const indirectPoolAccountValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    indirectPoolId: z.string().min(1, { message: "Pool is required" }),
    accountId: z.string().min(1, { message: "Account is required" }),
    dimensionId: zfd.text(z.string().optional()),
    dimensionValueId: zfd.text(z.string().optional()),
    role: z.enum(indirectPoolAccountRoles, { error: "Role is required" })
  })
  .refine((data) => !data.dimensionId === !data.dimensionValueId, {
    message: "Select both a dimension and a value, or neither",
    path: ["dimensionValueId"]
  });

export const indirectRateEntryValidator = z.object({
  indirectPoolId: z.string().min(1, { message: "Pool is required" }),
  fiscalYear: zfd.numeric(
    z.number().int({ message: "Fiscal year must be a whole number" })
  ),
  fromPeriod: zfd.numeric(
    z
      .number()
      .int({ message: "Period must be a whole number" })
      .min(1, { message: "Period must be 1 to 12" })
      .max(12, { message: "Period must be 1 to 12" })
  ),
  rateType: z.enum(enteredIndirectRateTypes, {
    error: "Rate type is required"
  }),
  // A fraction: 0.3 is 30 %.
  rate: zfd.numeric(z.number().min(0, { message: "Rate must be 0 or more" }))
});

export const contractRateCeilingValidator = z.object({
  id: zfd.text(z.string().optional()),
  customerContractLineId: z
    .string()
    .min(1, { message: "Contract line is required" }),
  indirectPoolId: z.string().min(1, { message: "Pool is required" }),
  // A fraction: 0.25 is 25 %.
  ceilingRate: zfd.numeric(
    z.number().min(0, { message: "Ceiling must be 0 or more" })
  )
});

export const burdenSettingsValidator = z.object({
  burdenRateType: z.enum(burdenRateTypes, {
    error: "Burden rate type is required"
  }),
  postAppliedBurden: zfd.checkbox()
});

/**
 * A unique key the database refused on a pool or a pool account, as a field
 * error the form shows (B4: one cell is Cost in at most one pool).
 */
export function indirectRatesFieldErrors(error: {
  code?: string;
  message?: string;
}): Record<string, string> | null {
  if (error.code !== "23505") return null;
  const message = error.message ?? "";
  if (message.includes("indirectPool_sequence_key")) {
    return { sequence: "Another pool already has this sequence" };
  }
  if (message.includes("indirectPool_name_key")) {
    return { name: "Another pool already has this name" };
  }
  if (message.includes("indirectPoolAccount_cost_key")) {
    return { accountId: "This account is already a Cost account of a pool" };
  }
  if (message.includes("indirectPoolAccount_cell_key")) {
    return { accountId: "This pool already has this account in this role" };
  }
  return null;
}
