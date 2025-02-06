import { z } from "zod";
import { zfd } from "zod-form-data";

export const chartIntervals = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
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
  "Other",
] as const;

export const tablesWithTags = [
  "consumable",
  "fixture",
  "job",
  "material",
  "part",
  "tool",
];

export const methodItemType = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  // "Service",
] as const;

export const methodOperationOrders = [
  "After Previous",
  "With Previous",
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
  "December",
] as const;

export const methodType = ["Buy", "Make", "Pick"] as const;

export const noteValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentId: z.string().min(1),
  note: z.string().min(1, { message: "Note is required" }),
});

export const operationTypes = ["Inside", "Outside"] as const;

export const processTypes = [
  "Inside",
  "Outside",
  "Inside and Outside",
] as const;

export const feedbackValidator = z.object({
  feedback: z.string().min(1, { message: "" }),
  attachmentPath: z.string().optional(),
  location: z.string(),
});

export const operationToolValidator = z.object({
  id: zfd.text(z.string().optional()),
  operationId: z.string().min(1, { message: "Operation is required" }),
  toolId: z.string().min(1, { message: "Tool is required" }),
  quantity: zfd.numeric(
    z.number().min(0.000001, { message: "Quantity is required" })
  ),
});

export const savedViewValidator = z.object({
  id: zfd.text(z.string().optional()),
  table: z.string(),
  name: z.string().min(1, { message: "A name is required to save a view" }),
  description: z.string().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  state: z.string(),
  type: z.enum(["Public", "Private"]),
});

export const savedViewStateValidator = z.object({
  columnOrder: z.array(z.string()),
  columnPinning: z.any(),
  columnVisibility: z.record(z.boolean()),
  filters: z.array(z.string()).optional(),
  sorts: z.array(z.string()).optional(),
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
  "Total Minutes",
] as const;
