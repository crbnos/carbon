import type { JSONContent } from "@carbon/react";
import { z } from "zod";

/**
 * Tiptap document content. We keep validation loose (the editor owns the real
 * shape) and only pin the static TS type — mirrors how `terms` is stored.
 */
const jsonContentSchema = z.custom<JSONContent>(
  (val) => typeof val === "object" && val !== null
);

/** Fields shared by every block, built-in or extension. */
const baseFields = {
  id: z.string(),
  visible: z.boolean().default(true)
};

/**
 * Built-in blocks map 1:1 to the hardcoded sections of a document. They are
 * data-bound (the renderer fills them from the document) so they carry no
 * user-authored props — only identity + visibility.
 */
const builtInBlock = <T extends string>(type: T) =>
  z.object({ ...baseFields, type: z.literal(type) });

/**
 * A crop rectangle, normalized to the source image (0..1). `aspect` is the
 * pixel aspect ratio of the cropped region (cropPxW / cropPxH) so renderers can
 * size a clip box without knowing the image's intrinsic dimensions. Shared by
 * the document header logo and the tracking-label logo block.
 */
export const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  aspect: z.number().positive()
});
export type LogoCrop = z.infer<typeof cropSchema>;

/** Per-block display options for the Header block (logo + which fields show). */
export const DEFAULT_HEADER_OPTIONS = {
  showLogo: true,
  logoVariant: "mark",
  logoHeight: 50,
  showCompanyDetails: true,
  showDocumentTitle: true,
  showDocumentId: true
} as const;

export const headerOptionsSchema = z.object({
  showLogo: z.boolean().default(true),
  /** Which company logo to use: full logo (`mark`) or the square `icon`. */
  logoVariant: z.enum(["mark", "icon"]).default("mark"),
  logoHeight: z.number().min(16).max(120).default(50),
  /** Optional crop applied before rendering (PDF clip box). */
  logoCrop: cropSchema.optional(),
  showCompanyDetails: z.boolean().default(true),
  showDocumentTitle: z.boolean().default(true),
  showDocumentId: z.boolean().default(true)
});

/** Per-block display options for the Line Items table. */
export const DEFAULT_LINE_ITEMS_OPTIONS = {
  showThumbnails: true,
  zebra: true,
  textOverflow: "truncate"
} as const;

const lineItemsOptionsSchema = z.object({
  showThumbnails: z.boolean().default(true),
  zebra: z.boolean().default(true),
  /** How the item title/description behave: wrap to new lines or truncate. */
  textOverflow: z.enum(["wrap", "truncate"]).default("truncate")
});

/** Per-block options for the Summary totals. */
export const DEFAULT_SUMMARY_OPTIONS = {
  taxLabel: "Taxes"
} as const;

const summaryOptionsSchema = z.object({
  taxLabel: z.string().default("Taxes")
});

const headerBlock = z.object({
  ...baseFields,
  type: z.literal("header"),
  options: headerOptionsSchema.optional()
});
const partiesBlock = builtInBlock("parties");
const notesBlock = builtInBlock("notes");
/** Data-bound metadata block (e.g. shipment/transfer details). */
const detailsBlock = builtInBlock("details");
const lineItemsBlock = z.object({
  ...baseFields,
  type: z.literal("lineItems"),
  options: lineItemsOptionsSchema.optional()
});
const summaryBlock = z.object({
  ...baseFields,
  type: z.literal("summary"),
  options: summaryOptionsSchema.optional()
});
/**
 * Terms & Conditions. Built-in (not addable/removable) but carries its own
 * rich-text `content` — per-document, seeded from the company terms setting.
 * Empty content falls back to that setting at render time.
 */
const termsBlock = z.object({
  ...baseFields,
  type: z.literal("terms"),
  content: jsonContentSchema.optional()
});
/** Job Traveler built-ins (data-bound; render the existing bespoke content). */
const jobDetailsBlock = builtInBlock("jobDetails");
const operationsBlock = z.object({
  ...baseFields,
  type: z.literal("operations"),
  /** Print the full work instructions / procedure steps under each operation. */
  showWorkInstructions: z.boolean().default(false)
});
/** Issue built-ins (data-bound; render the existing bespoke content). */
const issueDetailsBlock = builtInBlock("issueDetails");
const associationsBlock = builtInBlock("associations");
const actionTasksBlock = builtInBlock("actionTasks");
const reviewersBlock = builtInBlock("reviewers");
/** Tracking-label fields (data-bound; one per label element). */
const labelHeadingBlock = builtInBlock("labelHeading");
/** A label field whose printed name (the prefix before the value) is editable. */
const labelNamedField = <T extends string>(type: T) =>
  z.object({
    ...baseFields,
    type: z.literal(type),
    label: z.string().optional()
  });
const labelRevisionBlock = labelNamedField("labelRevision");
const labelQuantityBlock = labelNamedField("labelQuantity");
const labelTrackingBlock = labelNamedField("labelTracking");
/** A human-readable identifier line (defaults to the tracked-entity id). */
const labelEntityIdBlock = z.object({
  ...baseFields,
  type: z.literal("labelEntityId"),
  value: z.string().default("{label.trackedEntityId}")
});
/**
 * A scannable code (QR / PDF417 / Code128 / DataMatrix). `placement` is "right"
 * (small, top-right next to the logo) or "full" (full-width band, e.g. PDF417).
 */
const labelBarcodeBlock = z.object({
  ...baseFields,
  type: z.literal("labelBarcode"),
  symbology: z
    .enum(["qrcode", "pdf417", "code128", "datamatrix"])
    .default("qrcode"),
  value: z.string().default("{label.trackedEntityId}"),
  placement: z.enum(["right", "full", "center"]).default("right"),
  height: z.number().min(16).max(300).optional()
});
/** The company logo. Color in the PDF by default; `monochrome` for B&W / ZPL. */
const labelLogoBlock = z.object({
  ...baseFields,
  type: z.literal("labelLogo"),
  /** Which company logo to use: full logo (`mark`) or the square `icon`. */
  variant: z.enum(["mark", "icon"]).default("mark"),
  monochrome: z.boolean().optional(),
  /** Optional crop applied before rendering (PDF clip box / ZPL pre-crop). */
  crop: cropSchema.optional(),
  height: z.number().min(16).max(160).optional()
});

/** Extension blocks are user-authored and fully removable. */
const richTextBlock = z.object({
  ...baseFields,
  type: z.literal("richText"),
  title: z.string().optional(),
  content: jsonContentSchema
});

const keyValueBlock = z.object({
  ...baseFields,
  type: z.literal("keyValue"),
  title: z.string().optional(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })).default([])
});

const spacerBlock = z.object({
  ...baseFields,
  type: z.literal("spacer"),
  variant: z.enum(["space", "divider", "pageBreak"]).default("space"),
  /** Height in pt, only used by the "space" variant. */
  size: z.number().min(0).max(200).optional()
});

/** Reference to a shared documentSection, resolved at render time. */
const sharedBlock = z.object({
  ...baseFields,
  type: z.literal("shared"),
  sectionId: z.string()
});

/**
 * A single authored line: an optional `label` plus a `value`. With no label it
 * is plain text; with a label it is a single key-value. Maps 1:1 to one ZPL
 * `^FD` line, so it's the label-safe alternative to rich text / key-value lists.
 */
const fieldBlock = z.object({
  ...baseFields,
  type: z.literal("field"),
  label: z.string().optional(),
  value: z.string().default("")
});

/** Displays a single custom-field value (label + value) from the record. */
const customFieldBlock = z.object({
  ...baseFields,
  type: z.literal("customField"),
  /** The custom field's id (key into the record's `customFields` JSON). */
  fieldId: z.string(),
  /** Display label — defaults to the field's name at insert time. */
  label: z.string().default("")
});

/** Faint full-page company watermark (uses the company's watermark logo). */
const watermarkBlock = z.object({
  ...baseFields,
  type: z.literal("watermark"),
  opacity: z.number().min(0).max(1).default(0.07),
  placement: z.enum(["center", "top", "bottom"]).default("center"),
  size: z.number().min(10).max(100).default(50)
});

export const blockSchema = z.discriminatedUnion("type", [
  headerBlock,
  watermarkBlock,
  partiesBlock,
  notesBlock,
  detailsBlock,
  lineItemsBlock,
  summaryBlock,
  termsBlock,
  jobDetailsBlock,
  operationsBlock,
  issueDetailsBlock,
  associationsBlock,
  actionTasksBlock,
  reviewersBlock,
  labelHeadingBlock,
  labelRevisionBlock,
  labelQuantityBlock,
  labelTrackingBlock,
  labelEntityIdBlock,
  labelBarcodeBlock,
  labelLogoBlock,
  richTextBlock,
  keyValueBlock,
  spacerBlock,
  sharedBlock,
  fieldBlock,
  customFieldBlock
]);

/** Shared, reusable rich-text section. `placement` scopes where it's used. */
export const documentSectionPlacementSchema = z.enum([
  "body",
  "header",
  "footer"
]);

/**
 * Layout config carried by a header section — logo + which company fields show.
 * Global: the header is one shared section reused across every document.
 */
export const sectionConfigSchema = headerOptionsSchema.partial();

export const documentSectionSchema = z.object({
  name: z.string().min(1),
  placement: documentSectionPlacementSchema.default("body"),
  content: jsonContentSchema,
  config: sectionConfigSchema.optional()
});

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export const DEFAULT_THEME = {
  /** Strong brand color — fills the line-items header bar. */
  accent: "#1f2937",
  /** Text/icons drawn on top of the accent color. */
  accentForeground: "#ffffff",
  /** Section headings (BILL TO, INVOICE DETAILS, NOTES…). Maps gray-600. */
  heading: "#4b5563",
  /** Body text: addresses, line-item values, the document title. Maps gray-800. */
  text: "#1f2937"
} as const;

export const themeSchema = z.object({
  accent: z.string().regex(HEX_COLOR).default(DEFAULT_THEME.accent),
  accentForeground: z
    .string()
    .regex(HEX_COLOR)
    .default(DEFAULT_THEME.accentForeground),
  heading: z.string().regex(HEX_COLOR).default(DEFAULT_THEME.heading),
  text: z.string().regex(HEX_COLOR).default(DEFAULT_THEME.text)
});

// Body fonts offered in the editor. Helvetica/Times/Courier are PDF built-ins; the
// rest are bundled (see pdf/fonts.ts).
export const DOCUMENT_FONTS = [
  { value: "Inter", label: "Inter", kind: "Sans" },
  { value: "Helvetica", label: "Helvetica", kind: "Sans" },
  { value: "Times-Roman", label: "Times", kind: "Serif" },
  { value: "Courier", label: "Courier", kind: "Mono" },
  { value: "Roboto", label: "Roboto", kind: "Sans" },
  { value: "Open Sans", label: "Open Sans", kind: "Sans" },
  { value: "Lato", label: "Lato", kind: "Sans" },
  { value: "Montserrat", label: "Montserrat", kind: "Sans" },
  { value: "Merriweather", label: "Merriweather", kind: "Serif" },
  { value: "Playfair Display", label: "Playfair Display", kind: "Serif" },
  { value: "Lora", label: "Lora", kind: "Serif" }
] as const;

export type DocumentFont = (typeof DOCUMENT_FONTS)[number]["value"];

/** Document-level settings (font + footer page numbers + registration line). */
export const DEFAULT_DOCUMENT_SETTINGS = {
  fontFamily: "Inter",
  showPageNumbers: true,
  pageNumberFormat: "pageOfTotal",
  showRegistrationLine: true
} as const;

export const documentSettingsSchema = z.object({
  fontFamily: z
    .enum([
      "Inter",
      "Helvetica",
      "Times-Roman",
      "Courier",
      "Roboto",
      "Open Sans",
      "Lato",
      "Montserrat",
      "Merriweather",
      "Playfair Display",
      "Lora"
    ])
    .default("Inter"),
  showPageNumbers: z.boolean().default(true),
  /** "pageOfTotal" → "Page 1 of 3"; "page" → "Page 1". */
  pageNumberFormat: z.enum(["pageOfTotal", "page"]).default("pageOfTotal"),
  showRegistrationLine: z.boolean().default(true)
});

/** Document types that support a customizable template. Widen as docs ship. */
export const documentTemplateTypeSchema = z.enum([
  "salesInvoice",
  "salesOrder",
  "purchaseOrder",
  "quote",
  "packingSlip",
  "stockTransfer",
  "jobTraveler",
  "issue",
  "trackingLabel"
]);

/**
 * Schema version of the stored template JSON. Bump when the block/theme shape
 * changes in a non-additive way; `resolveTemplate` migrates older versions
 * forward on read. (Idea borrowed from Bindery's `formatVersion`.)
 */
export const CURRENT_TEMPLATE_FORMAT_VERSION = 1;

export const documentTemplateSchema = z.object({
  formatVersion: z.number().int().default(CURRENT_TEMPLATE_FORMAT_VERSION),
  documentType: documentTemplateTypeSchema,
  blocks: z.array(blockSchema),
  theme: themeSchema.default(DEFAULT_THEME),
  settings: documentSettingsSchema.default(DEFAULT_DOCUMENT_SETTINGS),
  /** Shared sections used as the repeating page header/footer (or none). */
  headerSectionId: z.string().nullable().default(null),
  footerSectionId: z.string().nullable().default(null)
});

export type DocumentBlock = z.infer<typeof blockSchema>;
export type DocumentBlockType = DocumentBlock["type"];
export type SharedBlock = Extract<DocumentBlock, { type: "shared" }>;
export type DocumentSection = z.infer<typeof documentSectionSchema>;
export type DocumentSectionPlacement = z.infer<
  typeof documentSectionPlacementSchema
>;
/** A section row resolved for rendering (id + name + content + layout config). */
export interface ResolvedSection {
  id: string;
  name: string;
  placement: DocumentSectionPlacement;
  content: JSONContent;
  /** Header layout config (logo, which fields show). Header sections only. */
  config?: SectionConfig;
  /** True for code-provided system sections — shown read-only in the library. */
  builtIn?: boolean;
}
export type DocumentTheme = z.infer<typeof themeSchema>;
export type DocumentSettings = z.infer<typeof documentSettingsSchema>;
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;
export type DocumentTemplateType = z.infer<typeof documentTemplateTypeSchema>;

/** The stored `documentTemplate` row shape (JSON columns are untyped here). */
export interface StoredDocumentTemplateRow {
  formatVersion?: number | null;
  blocks?: unknown;
  theme?: unknown;
  settings?: unknown;
  headerSectionId?: string | null;
  footerSectionId?: string | null;
}

/**
 * Map a stored `documentTemplate` row to a `DocumentTemplate` (or null). The one
 * place the JSON columns are cast — callers (services + PDF/ZPL routes) use this
 * instead of re-deriving the shape. The result still passes through
 * `resolveTemplate` at render, which applies defaults/validation.
 */
export function toDocumentTemplate(
  row: unknown,
  documentType: DocumentTemplateType
): DocumentTemplate | null {
  if (!row) return null;
  const r = row as StoredDocumentTemplateRow;
  return {
    formatVersion: r.formatVersion ?? CURRENT_TEMPLATE_FORMAT_VERSION,
    documentType,
    blocks: r.blocks as DocumentTemplate["blocks"],
    theme: r.theme as DocumentTemplate["theme"],
    settings: r.settings as DocumentTemplate["settings"],
    headerSectionId: r.headerSectionId ?? null,
    footerSectionId: r.footerSectionId ?? null
  };
}

/** Narrowing helpers for the extension blocks (used by editor + renderers). */
export type RichTextBlock = Extract<DocumentBlock, { type: "richText" }>;
export type KeyValueBlock = Extract<DocumentBlock, { type: "keyValue" }>;
export type SpacerBlock = Extract<DocumentBlock, { type: "spacer" }>;
export type TermsBlock = Extract<DocumentBlock, { type: "terms" }>;
export type HeaderBlock = Extract<DocumentBlock, { type: "header" }>;
export type HeaderOptions = z.infer<typeof headerOptionsSchema>;
export type SectionConfig = z.infer<typeof sectionConfigSchema>;
export type LineItemsBlock = Extract<DocumentBlock, { type: "lineItems" }>;
export type LineItemsOptions = z.infer<typeof lineItemsOptionsSchema>;
export type SummaryBlock = Extract<DocumentBlock, { type: "summary" }>;
export type SummaryOptions = z.infer<typeof summaryOptionsSchema>;
export type FieldBlock = Extract<DocumentBlock, { type: "field" }>;
export type CustomFieldBlock = Extract<DocumentBlock, { type: "customField" }>;
export type JobDetailsBlock = Extract<DocumentBlock, { type: "jobDetails" }>;
export type OperationsBlock = Extract<DocumentBlock, { type: "operations" }>;
export type IssueDetailsBlock = Extract<
  DocumentBlock,
  { type: "issueDetails" }
>;
export type AssociationsBlock = Extract<
  DocumentBlock,
  { type: "associations" }
>;
export type ActionTasksBlock = Extract<DocumentBlock, { type: "actionTasks" }>;
export type ReviewersBlock = Extract<DocumentBlock, { type: "reviewers" }>;
export type LabelHeadingBlock = Extract<
  DocumentBlock,
  { type: "labelHeading" }
>;
/** Label fields whose printed name is editable. */
export type LabelNamedBlock = Extract<
  DocumentBlock,
  { type: "labelRevision" | "labelQuantity" | "labelTracking" }
>;
export type LabelBarcodeBlock = Extract<
  DocumentBlock,
  { type: "labelBarcode" }
>;
export type LabelLogoBlock = Extract<DocumentBlock, { type: "labelLogo" }>;
export type WatermarkBlock = Extract<DocumentBlock, { type: "watermark" }>;
export type LabelEntityIdBlock = Extract<
  DocumentBlock,
  { type: "labelEntityId" }
>;
