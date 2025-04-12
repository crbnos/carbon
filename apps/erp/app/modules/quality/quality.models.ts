import { z } from "zod";
import { zfd } from "zod-form-data";

export const nonConformanceInvestigationType = [
  "Inventory",
  "WIP",
  "Finished Goods",
  "Incoming Materials",
  "Process",
  "Documentation",
] as const;

export const nonConformanceRequiredAction = [
  "Root Cause Analysis",
  "Corrective Action",
  "Preventive Action",
  "Containment Action",
  "Verification",
  "Customer Communication",
] as const;

export const nonConformanceApprovalRequirement = ["MRB"] as const;

export const nonConformanceSource = ["Internal", "External"] as const;

export const nonConformanceStatus = [
  "Registered",
  "In Progress",
  "Closed",
] as const;

export const nonConformanceTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped",
] as const;

export const nonConformancePriority = [
  "Low",
  "Medium",
  "High",
  "Critical",
] as const;

export const nonConformanceValidator = z.object({
  id: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  name: z.string().min(1, { message: "Name is required" }),
  investigationTypes: z
    .array(z.enum(nonConformanceInvestigationType))
    .optional(),
  requiredActions: z.array(z.enum(nonConformanceRequiredAction)).optional(),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional(),
  locationId: z.string().min(1, { message: "Location is required" }),
  nonConformanceWorkflowId: z
    .string()
    .min(1, { message: "Workflow is required" }),
  nonConformanceTypeId: z.string().min(1, { message: "Type is required" }),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  closeDate: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().optional()),
  itemId: zfd.text(z.string().optional()),
  customerId: zfd.text(z.string().optional()),
  supplierId: zfd.text(z.string().optional()),
  jobId: zfd.text(z.string().optional()),
  jobOperationId: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  purchaseOrderLineId: zfd.text(z.string().optional()),
  salesOrderId: zfd.text(z.string().optional()),
  salesOrderLineId: zfd.text(z.string().optional()),
  shipmentId: zfd.text(z.string().optional()),
  shipmentLineId: zfd.text(z.string().optional()),
});

export const nonConformanceTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const nonConformanceWorkflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  content: z
    .string()
    .min(1, { message: "Content is required" })
    .transform((val) => {
      try {
        return JSON.parse(val);
      } catch (e) {
        return {};
      }
    }),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  investigationTypes: z
    .array(z.enum(nonConformanceInvestigationType))
    .optional(),
  requiredActions: z.array(z.enum(nonConformanceRequiredAction)).optional(),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional(),
});
