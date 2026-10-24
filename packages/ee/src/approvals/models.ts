// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";

// The approve / reject form every approval document type posts.
export const approvalDecisionValidator = z.object({
  approvalRequestId: z
    .string()
    .min(1, { message: "Approval request is required" }),
  decision: z.enum(["Approved", "Rejected"], {
    error: "Decision is required"
  }),
  notes: zfd.text(z.string().optional())
});

export const approvalDocumentType = [
  "purchaseOrder",
  "qualityDocument",
  "supplier",
  "changeOrder",
  "scrap"
] as const;

export type ApprovalDocumentType =
  Database["public"]["Enums"]["approvalDocumentType"];

export const approvalDocumentTypeLabel: Record<ApprovalDocumentType, string> = {
  purchaseOrder: "Purchase Order",
  qualityDocument: "Quality Document",
  supplier: "Supplier",
  changeOrder: "Change Notice",
  scrap: "Scrap"
};

// Scrap is tiered by the estimated value of what is scrapped.
export const approvalDocumentTypesWithAmounts: ApprovalDocumentType[] = [
  "purchaseOrder",
  "scrap"
];

export const approvalFiltersValidator = z.object({
  documentType: z.enum(approvalDocumentType, {
    error: "Document type is required"
  }),
  status: zfd.text(z.string().optional()),
  dateFrom: zfd.text(z.string().optional()),
  dateTo: zfd.text(z.string().optional())
});

export const approvalRequestValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentType: z.enum(approvalDocumentType, {
    error: "Document type is required"
  }),
  documentId: zfd.text(
    z.string().min(1, { message: "Document ID is required" })
  ),
  approverGroupIds: zfd.repeatableOfType(z.string()).optional()
});

export const approvalRuleValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentType: z.enum(approvalDocumentType, {
    error: "Document type is required"
  }),
  approverGroupIds: z.array(
    z.string().min(1, { message: "Invalid selection" })
  ),
  defaultApproverId: zfd.text(z.string().optional()),
  // 0 is a real floor: every document of the type needs approval.
  lowerBoundAmount: zfd.numeric(z.number().min(0).default(0)).optional(),
  enabled: zfd.checkbox()
});

export const approvalStatusType = [
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled"
] as const;
