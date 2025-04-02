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
  investigationTypes: z
    .array(z.enum(nonConformanceInvestigationType))
    .optional(),
  requiredActions: z.array(z.enum(nonConformanceRequiredAction)).optional(),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional(),
});
