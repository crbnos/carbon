import { textToTiptap } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const chartIntervals = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" }
];

export { documentTypes } from "@carbon/files";

export const incoterms = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CPT",
  "CIP",
  "CFR",
  "CIF",
  "DAP",
  "DPU",
  "DDP"
] as const;

export const inspectionStatus = ["Pass", "Fail"] as const;

export const tablesWithTags = [
  "consumable",
  "fixture",
  "job",
  "material",
  "part",
  "service",
  "suggestion",
  "tool"
];

// Item types that can appear as a BOM/method material component. Tool and
// Service are intentionally excluded — tools attach to operations
// (methodOperationTool) and services are billable activities bought or
// performed; neither is ever consumed as a component.
export const methodItemType = ["Part", "Material", "Consumable"] as const;

// Item types that can appear as a top-level quote/sales-order/purchase-order/
// invoice line. Tools and services are bought and sold even though neither is
// a method component, so this is wider than methodItemType.
export const itemType = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
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

export const methodOperationOrders = [
  "After Previous",
  "With Previous"
] as const;

export const methodType = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;

export const sourcingType = [
  "Specified",
  "Drop Ship",
  "Ship from Inventory"
] as const;

export const taxExemptionReasons = [
  "Resale",
  "Government",
  "Nonprofit",
  "Agriculture",
  "Industrial",
  "Export",
  "Medical",
  "Educational",
  "Religious",
  "Other"
] as const;

export const validMethodTypesByReplenishment: Record<
  string,
  readonly (typeof methodType)[number][]
> = {
  Buy: ["Pull from Inventory", "Purchase to Order"],
  Make: ["Pull from Inventory", "Make to Order"],
  "Buy and Make": ["Pull from Inventory", "Purchase to Order"]
};

export function getValidMethodTypes(
  replenishmentSystem: string
): readonly (typeof methodType)[number][] {
  return validMethodTypesByReplenishment[replenishmentSystem] ?? [];
}

export const noteValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentId: z.string().min(1),
  note: z.string().min(1, { message: "Note is required" })
});

// The single operation classification, shared by operations (methodOperation /
// quoteOperation / jobOperation) and by processes (process.processType) — one
// Postgres enum backs both so they can never drift. Subcontract logic keys on
// === "Outside Processing"; in-house logic keys on !== "Outside Processing"
// (never an enumeration of the in-house values) so future in-house types inherit
// costing/scheduling/PO behavior unchanged.
// See .ai/specs/2026-07-20-operation-type-consolidation.md.
export const operationTypes = [
  "Process",
  "Assembly",
  "Inspection",
  "Outside Processing"
] as const;

export type OperationType = (typeof operationTypes)[number];

// Each operation type has exactly one instruction-source pointer: Process →
// procedureId, Assembly → assemblyInstructionId, Inspection →
// inspectionDocumentId. Writes go through this so a stale pointer can't survive
// a type change (sanitize() only nullifies present-undefined keys — it never
// clears an omitted field). See .ai/specs/2026-07-21-operation-instruction-sources.md.
export function normalizeOperationSourceIds<
  T extends {
    operationType?: string;
    procedureId?: string | null;
    assemblyInstructionId?: string | null;
    inspectionDocumentId?: string | null;
  }
>(operation: T): T {
  return {
    ...operation,
    procedureId:
      operation.operationType === "Process"
        ? operation.procedureId || null
        : null,
    assemblyInstructionId:
      operation.operationType === "Assembly"
        ? operation.assemblyInstructionId || null
        : null,
    inspectionDocumentId:
      operation.operationType === "Inspection"
        ? operation.inspectionDocumentId || null
        : null
  };
}

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

export const feedbackValidator = z.object({
  feedback: z.string().min(1, { message: "" }),
  attachmentPath: z.string().optional(),
  location: z.string()
});

export const processTypes = [
  "Inside",
  "Outside",
  "Inside and Outside"
] as const;

export const suggestionValidator = z.object({
  suggestion: z.string().min(1, { message: "Suggestion is required" }),
  emoji: z.string().default("💡"),
  attachmentPath: z.string().optional(),
  path: z.string(),
  userId: zfd.text(z.string().optional()),
  sendToCarbon: zfd
    .text(z.string().optional())
    .transform((value) => value === "true")
});

export const oAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string()
});

/**
 * Coerces whatever a caller sent for a rich-text column into a tiptap document
 * object. Accepts plain text, a JSON-encoded document (a form post), or the
 * document itself (an MCP / API JSON body).
 *
 * Rich-text columns (`internalNotes`, `externalNotes`, step descriptions) are
 * `json`, and they MUST hold an object. A JSON string scalar stored there is
 * read back by supabase-js as a JS string; when the row is later copied through
 * Kysely (quote → sales order, RFQ → quote, quote → revision, method copies)
 * deno-postgres sends that string as raw text and Postgres rejects it with
 * `invalid input syntax for type json`. The edge functions now serialise on
 * their side too (`lib/json.ts`), but the write side must never store the
 * scalar in the first place. Never drops content to `{}`.
 *
 * Returns `any`: the doc is consumed both as a DB Json value and as editor
 * JSONContent, and a narrower type breaks one of the two call sites.
 */
export function toTiptapDoc(value: unknown): any {
  if (typeof value === "string") {
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // raw text, not JSON
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    // Anything else the caller typed is literal text — including text that
    // happens to parse as JSON (`"quoted"`, `123`, `[1,2]`). Wrap the ORIGINAL
    // value so no characters are lost to the parse.
    return textToTiptap(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return textToTiptap(String(value));
}

/**
 * Optional rich-text field: absent or empty leaves the column untouched,
 * anything else is stored as a tiptap document via `toTiptapDoc`. Declared as
 * `string | object` on the input side so the MCP manifest (which publishes the
 * INPUT schema) tells a caller both shapes are accepted, instead of the bare
 * `{}` a `z.any()` produced.
 */
export const optionalTiptapDoc = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .transform((value): any => (value === "" ? undefined : toTiptapDoc(value)))
  // `.optional()` LAST so the inferred key is optional (`notes?:`) — placing it
  // before the transform makes zod infer a required key and every caller that
  // omits `notes` stops compiling.
  .optional();

export const operationStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    operationId: z.string().min(1, { message: "Operation is required" }),
    name: z.string().trim().min(1, { message: "Name is required" }),
    description: z
      .string()
      .min(1, { message: "Description is required" })
      .transform((val): any => toTiptapDoc(val)),
    type: z.enum(procedureStepType, {
      error: "Type is required"
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

// Display sizes for a step reference image, honored in the BOP editor grid and the MES
// operator view. Kept as a plain const tuple so both the zod enum and the UI reuse it.
export const slideSizes = ["small", "medium", "large"] as const;
export type SlideSize = (typeof slideSizes)[number];

// A single numbered annotation pin overlaid on a slide image. x/y are fractions (0..1) of
// the image box so a pin stays put at any rendered size. The pin's number is its position
// in the array (index + 1); label + color are optional.
export const slideAnnotationValidator = z.object({
  id: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string().optional(),
  color: z.string().optional(),
  // Optional "smart hotspot" link: the tool (item) this pin points at. Matches an
  // operationTool.toolId, so the MES view can name the tool and badge it with the
  // pin's sequence number. The pin's number (array index + 1) is the fastener order.
  toolId: z.string().optional()
});
export type SlideAnnotation = z.infer<typeof slideAnnotationValidator>;

// A reference "slide" attached to an operation step — either an image (`imagePath`) or a
// 3D model (`modelUploadId` → modelUpload; STEP sources are converted to GLB by the
// assembler service). Authored on the method and copied to job/quote by get-method.
// A create must carry one of the two; updates may omit both (sanitize() drops absent
// fields so a caption/size-only save never wipes the content). Pins are image-only.
// `annotations` arrives over FormData as a JSON string and is parsed into an array here.
export const operationStepSlideValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    stepId: z.string().min(1, { message: "Step is required" }),
    imagePath: zfd.text(z.string().optional()),
    modelUploadId: zfd.text(z.string().optional()),
    caption: zfd.text(z.string().optional()),
    sortOrder: zfd.numeric(z.number().min(0).optional()),
    size: zfd.text(z.enum(slideSizes).optional()),
    // Absent = "not changed" (preserve on update / default on insert); a JSON string (incl.
    // "[]" to clear) = the new pin set. Returning undefined when absent lets sanitize() drop
    // it so a caption/size-only save never wipes existing annotations.
    annotations: zfd.text(z.string().optional()).transform((value, ctx) => {
      if (!value) return undefined;
      try {
        return z.array(slideAnnotationValidator).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid annotations"
        });
        return z.NEVER;
      }
    })
  })
  .superRefine((slide, ctx) => {
    if (!slide.id && !slide.imagePath && !slide.modelUploadId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An image or model is required",
        path: ["imagePath"]
      });
    }
  });

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
  name: z
    .string()
    .trim()
    .min(1, { message: "A name is required to save a view" }),
  description: z.string().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  state: z.string(),
  type: z.enum(["Public", "Private"])
});

export const savedViewStateValidator = z.object({
  columnOrder: z.array(z.string()),
  columnPinning: z.any(),
  columnVisibility: z.record(z.string(), z.boolean()),
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

export type PriceBreak = {
  quantity: number;
  unitPrice: number;
};

export type SupplierPriceMap = Record<
  string,
  {
    priceBreaks: PriceBreak[];
    fallbackUnitPrice: number | null;
  }
>;
