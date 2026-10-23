// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { SF1443_OVERRIDABLE_LINES, type Sf1443Line } from "./compute";

// Validators and enum lists of contract financing. Client-safe: the ERP forms
// and the routes both import them through `@carbon/ee/contract-financing`.

type Enums = Database["public"]["Enums"];

export type ContractFinancingMethod = Enums["contractFinancingMethod"];
export type ContractFinancingRequestStatus =
  Enums["contractFinancingRequestStatus"];
export type PerformanceBasedPaymentEventType =
  Enums["performanceBasedPaymentEventType"];

export const contractFinancingMethods = [
  "Progress Payments",
  "Performance-Based Payments"
] as const satisfies readonly ContractFinancingMethod[];

export const contractFinancingRequestStatuses = [
  "Draft",
  "Submitted",
  "Approved",
  "Paid",
  "Withdrawn"
] as const satisfies readonly ContractFinancingRequestStatus[];

export const performanceBasedPaymentEventTypes = [
  "Cumulative",
  "Severable"
] as const satisfies readonly PerformanceBasedPaymentEventType[];

/** The rates the form suggests: the customary rate for a large business. */
export const SUGGESTED_FINANCING_RATE = 0.8;
/** An estimate to complete older than this many months gets a warning. */
export const ESTIMATE_MAX_AGE_MONTHS = 6;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Enter a date" });
const fraction = z
  .number()
  .min(0, { message: "Enter a rate from 0 to 100 %" })
  .max(1, { message: "Enter a rate from 0 to 100 %" });

export const contractFinancingTermsValidator = z.object({
  financingMethod: z.enum(contractFinancingMethods, {
    error: "Financing method is required"
  }),
  contractPrice: zfd.numeric(
    z.number().positive({ message: "Enter the contract price" })
  ),
  initialAwardDate: isoDate,
  isSmallBusiness: zfd.checkbox(),
  maximumPaymentShare: zfd.numeric(
    z
      .number()
      .gt(0, { message: "Enter a share above 0 %" })
      .max(1, { message: "Enter a share up to 100 %" })
      .optional()
  )
});

export const contractFinancingRateValidator = z.object({
  effectiveDate: isoDate,
  progressPaymentRate: zfd.numeric(fraction.optional()),
  liquidationRate: zfd.numeric(fraction),
  modificationNumber: zfd.text(z.string().optional())
});

export const pbpEventValidator = z.object({
  id: zfd.text(z.string().optional()),
  sequence: zfd.numeric(
    z.number().int().min(1, { message: "Enter the event's order" })
  ),
  eventCode: z
    .string()
    .min(1, { message: "Enter an event code" })
    .max(10, { message: "An event code has at most 10 characters" }),
  description: z.string().min(1, { message: "Enter a description" }),
  completionCriteria: zfd.text(z.string().optional()),
  eventType: z.enum(performanceBasedPaymentEventTypes),
  customerContractLineId: zfd.text(z.string().optional()),
  amount: zfd.numeric(z.number().positive({ message: "Enter an amount" })),
  plannedDate: zfd.text(isoDate.optional())
});

export const pbpEventCompleteValidator = z.object({
  id: z.string().min(1),
  completedDate: isoDate,
  evidence: zfd.text(z.string().optional())
});

export const financingRequestValidator = z.object({
  requestDate: isoDate,
  costsThroughDate: isoDate,
  estimateToComplete: zfd.numeric(z.number().min(0).optional()),
  estimateDate: zfd.text(isoDate.optional())
});

export const financingOverrideValidator = z
  .object({
    line: z.enum(SF1443_OVERRIDABLE_LINES),
    /** Blank clears the override. */
    value: zfd.numeric(z.number().optional()),
    reason: zfd.text(z.string().optional())
  })
  .refine((data) => data.value === undefined || Boolean(data.reason), {
    message: "Give a reason for the override",
    path: ["reason"]
  });

export const financingApproveValidator = z.object({
  approvedAmount: zfd.numeric(
    z.number().min(0, { message: "Enter the approved amount" })
  )
});

/** The words of each SF 1443 line, as the form prints them, shortened. */
export const SF1443_LINE_LABELS: Record<Sf1443Line, string> = {
  "5": "Contract price",
  "11": "Costs eligible for progress payments",
  "12a": "Total costs incurred to date",
  "12b": "Estimated cost to complete",
  "12c": "Total estimated cost of performance",
  "13": "Eligible costs × progress payment rate",
  "14a": "Subcontract financing paid",
  "14b": "Subcontract financing liquidated",
  "14c": "Net subcontract financing",
  "14d": "Subcontract financing approved, not paid",
  "14e": "Total subcontract financing",
  "15": "Line 13 + line 14e",
  "16": "Contract price × liquidation rate",
  "17": "Lesser of line 15 or line 16",
  "18": "Previous progress payments requested",
  "19": "Maximum balance eligible",
  "20a": "Costs of items delivered, invoiced and accepted",
  "20b": "Costs of undelivered items",
  "20c": "Line 20b × progress payment rate",
  "20d": "Subcontract financing (line 14e)",
  "20e": "Limitation (line 20c + line 20d)",
  "21a": "Price of items delivered, accepted and invoiced",
  "21b": "Price of undelivered items",
  "21c": "Line 21b × liquidation rate",
  "21d": "Unliquidated advance payments and interest",
  "21e": "Limitation (line 21c − line 21d)",
  "22": "Maximum unliquidated progress payments",
  "23": "Progress payments liquidated and to be liquidated",
  "24": "Unliquidated progress payments",
  "25": "Maximum permissible progress payments",
  "26": "Amount of this request"
};
