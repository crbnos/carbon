import { z } from "zod";
import { zfd } from "zod-form-data";

export const nonConformanceInvestigationType = [
  "Root Cause Analysis",
  "Inventory",
  "WIP",
  "Finished Goods",
  "Incoming Materials",
  "Process",
  "Documentation",
] as const;

export const nonConformanceRequiredAction = [
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
});

export const nonConformanceReviewerValidator = z.object({
  title: z.string().min(1, { message: "Title is required" }),
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
