import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const approvalDecisionValidator = z.object({
  id: zfd.text(z.string().optional()),
  decision: z.enum(["Approved", "Rejected"], {
    errorMap: () => ({ message: "Decision is required" })
  }),
  decisionNotes: zfd.text(z.string().optional())
});

export const approvalDocumentType = [
  "purchaseOrder",
  "qualityDocument"
] as const;

export type ApprovalDocumentType =
  Database["public"]["Enums"]["approvalDocumentType"];

export const approvalDocumentTypeLabel: Record<ApprovalDocumentType, string> = {
  purchaseOrder: "Purchase Order",
  qualityDocument: "Quality Document"
};

export const approvalDocumentTypesWithAmounts: ApprovalDocumentType[] = [
  "purchaseOrder"
] as const;

export const approvalFiltersValidator = z.object({
  documentType: z.enum(approvalDocumentType, {
    errorMap: () => ({ message: "Document type is required" })
  }),
  status: zfd.text(z.string().optional()),
  dateFrom: zfd.text(z.string().optional()),
  dateTo: zfd.text(z.string().optional())
});

export const approvalRequestValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentType: z.enum(approvalDocumentType, {
    errorMap: () => ({ message: "Document type is required" })
  }),
  documentId: zfd.text(
    z.string().min(1, { message: "Document ID is required" })
  ),
  approverGroupIds: zfd.repeatableOfType(z.string()).optional(),
  approverId: zfd.text(z.string().optional())
});

export const approvalRuleValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentType: z.enum(approvalDocumentType, {
    errorMap: () => ({ message: "Document type is required" })
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

export const chartIntervals = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" }
];

export const documentTypes = [
  "Archive",
  "Document",
  "Presentation",
  "PDF",
  "Spreadsheet",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Model",
  "Other"
] as const;

export const inspectionStatus = ["Pass", "Fail"] as const;

export const tablesWithTags = [
  "consumable",
  "fixture",
  "job",
  "material",
  "part",
  "suggestion",
  "tool"
];

export const methodItemType = [
  "Part",
  "Material",
  "Tool",
  "Consumable"
  // "Service",
] as const;

export const methodOperationOrders = [
  "After Previous",
  "With Previous"
] as const;

export const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

export const methodType = ["Buy", "Make", "Pick"] as const;

export const noteValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentId: z.string().min(1),
  note: z.string().min(1, { message: "Note is required" })
});

export const operationTypes = ["Inside", "Outside"] as const;

export const procedureStepType = [
  "Task",
  "Value",
  "Measurement",
  "Checkbox",
  "Timestamp",
  "Person",
  "List",
  "File",
  "Inspection"
] as const;

export const processTypes = [
  "Inside",
  "Outside",
  "Inside and Outside"
] as const;

export const feedbackValidator = z.object({
  feedback: z.string().min(1, { message: "" }),
  attachmentPath: z.string().optional(),
  location: z.string()
});

export const suggestionValidator = z.object({
  suggestion: z.string().min(1, { message: "Suggestion is required" }),
  emoji: z.string().default("💡"),
  attachmentPath: z.string().optional(),
  path: z.string(),
  userId: zfd.text(z.string().optional())
});

export const oAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string()
});

export const operationStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    operationId: z.string().min(1, { message: "Operation is required" }),
    name: z.string().min(1, { message: "Name is required" }),
    description: z
      .string()
      .min(1, { message: "Description is required" })
      .transform((val) => {
        try {
          return JSON.parse(val);
          // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
        } catch (e) {
          return {};
        }
      }),
    type: z.enum(procedureStepType, {
      errorMap: () => ({ message: "Type is required" })
    }),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    minValue: zfd.numeric(z.number().min(0).optional()),
    maxValue: zfd.numeric(z.number().min(0).optional()),
    listValues: z.array(z.string()).optional(),
    sortOrder: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      if (data.type === "Measurement") {
        return !!data.unitOfMeasureCode;
      }
      return true;
    },
    {
      message: "Unit of measure is required",
      path: ["unitOfMeasureCode"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "List") {
        return (
          Array.isArray(data.listValues) &&
          data.listValues.length > 0 &&
          data.listValues.every((option) => option.trim() !== "")
        );
      }
      return true;
    },
    {
      message: "List options are required",
      path: ["listOptions"]
    }
  )
  .refine(
    (data) => {
      if (data.minValue != null && data.maxValue != null) {
        return data.maxValue >= data.minValue;
      }
      return true;
    },
    {
      message: "Maximum value must be greater than or equal to minimum value",
      path: ["maxValue"]
    }
  );

export const operationToolValidator = z.object({
  id: zfd.text(z.string().optional()),
  operationId: z.string().min(1, { message: "Operation is required" }),
  toolId: z.string().min(1, { message: "Tool is required" }),
  quantity: zfd.numeric(
    z.number().min(0.000001, { message: "Quantity is required" })
  )
});

export const operationParameterValidator = z.object({
  id: zfd.text(z.string().optional()),
  operationId: z.string().min(1, { message: "Operation is required" }),
  key: z.string().min(1, { message: "Key is required" }),
  value: z.string().min(1, { message: "Value is required" })
});

export const savedViewValidator = z.object({
  id: zfd.text(z.string().optional()),
  table: z.string(),
  name: z.string().min(1, { message: "A name is required to save a view" }),
  description: z.string().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  state: z.string(),
  type: z.enum(["Public", "Private"])
});

export const savedViewStateValidator = z.object({
  columnOrder: z.array(z.string()),
  columnPinning: z.any(),
  columnVisibility: z.record(z.boolean()),
  filters: z.array(z.string()).optional(),
  sorts: z.array(z.string()).optional()
});

export const standardFactorType = [
  "Hours/Piece",
  "Hours/100 Pieces",
  "Hours/1000 Pieces",
  "Minutes/Piece",
  "Minutes/100 Pieces",
  "Minutes/1000 Pieces",
  "Pieces/Hour",
  "Pieces/Minute",
  "Seconds/Piece",
  "Total Hours",
  "Total Minutes"
] as const;
