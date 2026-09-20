import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const approvalDecisionValidator = z.object({
  id: zfd.text(z.string().optional()),
  decision: z.enum(["Approved", "Rejected"], {
    error: "Decision is required"
  }),
  decisionNotes: zfd.text(z.string().optional())
});

export const approvalDocumentType = [
  "purchaseOrder",
  "qualityDocument",
  "supplier"
] as const;

export type ApprovalDocumentType =
  Database["public"]["Enums"]["approvalDocumentType"];

export const approvalDocumentTypeLabel: Record<ApprovalDocumentType, string> = {
  purchaseOrder: "Purchase Order",
  qualityDocument: "Quality Document",
  supplier: "Supplier"
};

export const approvalDocumentTypesWithAmounts: ApprovalDocumentType[] = [
  "purchaseOrder"
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
  lowerBoundAmount: zfd.numeric(z.number().gt(0).default(0)).optional(),
  enabled: zfd.checkbox()
});

export const approvalStatusType = [
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled"
] as const;
