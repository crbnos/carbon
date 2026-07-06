import type { JSONContent } from "@carbon/react";
import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentSettings,
  DocumentTemplate,
  DocumentTemplateType,
  DocumentTheme,
  ResolvedSection
} from "./schema";
import {
  CURRENT_TEMPLATE_FORMAT_VERSION,
  DEFAULT_DOCUMENT_SETTINGS,
  DEFAULT_HEADER_OPTIONS,
  DEFAULT_LINE_ITEMS_OPTIONS,
  DEFAULT_THEME
} from "./schema";

/** Empty tiptap doc — renders nothing, so referencing it keeps output identical. */
function emptyDoc(): JSONContent {
  return { type: "doc", content: [] };
}

/**
 * Stable ids for the system-provided header/footer sections. Every company
 * gets these in the library (read-only) and every default template references
 * them, so the page header/footer is customizable out of the box without a
 * per-company DB seed. They start empty — the structural footer (registration
 * line + page numbers, see pdf/components/Footer) renders as it does today;
 * editing one forks it into a real `documentSection` row.
 */
export const BUILT_IN_SECTION_IDS = {
  header: "system-header",
  footer: "system-footer"
} as const;

export const BUILT_IN_SECTIONS: ResolvedSection[] = [
  {
    id: BUILT_IN_SECTION_IDS.header,
    name: "Default Header",
    placement: "header",
    content: emptyDoc(),
    config: { ...DEFAULT_HEADER_OPTIONS },
    builtIn: true
  },
  {
    id: BUILT_IN_SECTION_IDS.footer,
    name: "Default Footer",
    placement: "footer",
    content: emptyDoc(),
    builtIn: true
  }
];

export function isBuiltInSectionId(id: string): boolean {
  return BUILT_IN_SECTIONS.some((s) => s.id === id);
}

export function getBuiltInSection(id: string): ResolvedSection | undefined {
  return BUILT_IN_SECTIONS.find((s) => s.id === id);
}

/**
 * Prepend the system sections to a company's stored rows (DB rows win on id
 * collision, so a forked/customized default replaces the built-in). Use this
 * anywhere the full section list is shown or resolved.
 */
export function withBuiltInSections<T extends { id: string }>(
  rows: T[]
): (T | ResolvedSection)[] {
  const builtInIds = new Set(BUILT_IN_SECTIONS.map((s) => s.id));
  const overridden = new Set(rows.map((r) => r.id));
  // A built-in section the user has customized exists as a DB row — keep its
  // `builtIn` flag so it still reads as System (editable, not deletable).
  const flaggedRows = rows.map((r) =>
    builtInIds.has(r.id) ? { ...r, builtIn: true } : r
  );
  return [
    ...BUILT_IN_SECTIONS.filter((s) => !overridden.has(s.id)),
    ...flaggedRows
  ];
}

export interface BlockMeta {
  /** Human label shown in the editor block list. */
  label: string;
  /** Built-in blocks are data-bound and cannot be added/removed by users. */
  isBuiltIn: boolean;
  /** Whether the user may delete the block (extension blocks only). */
  removable: boolean;
  /** Whether the user may hide the block. Data-critical blocks stay visible. */
  hideable: boolean;
  /** Whether the block appears in the "Add block" menu. */
  addable: boolean;
}

export const BLOCK_META: Record<DocumentBlockType, BlockMeta> = {
  header: {
    label: "Header",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  watermark: {
    label: "Watermark",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  parties: {
    label: "Addresses & Details",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  notes: {
    label: "Notes",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  details: {
    label: "Details",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  lineItems: {
    label: "Line Items",
    isBuiltIn: true,
    removable: false,
    hideable: false,
    addable: false
  },
  summary: {
    label: "Summary",
    isBuiltIn: true,
    removable: false,
    hideable: false,
    addable: false
  },
  terms: {
    label: "Terms & Conditions",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  jobDetails: {
    label: "Job Details",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  operations: {
    label: "Operations",
    isBuiltIn: true,
    removable: false,
    hideable: false,
    addable: false
  },
  issueDetails: {
    label: "Issue Details",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  associations: {
    label: "Associations",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  actionTasks: {
    label: "Action Tasks",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  reviewers: {
    label: "Reviewers",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelHeading: {
    label: "Item ID",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelRevision: {
    label: "Revision",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelQuantity: {
    label: "Quantity",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelTracking: {
    label: "Serial / Batch",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelEntityId: {
    label: "Identifier",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelBarcode: {
    // The scannable code (QR / barcode) — built-in, configurable symbology.
    label: "Code",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  labelLogo: {
    // Built-in like the Code block — toggle it on/off, not add/remove.
    label: "Logo",
    isBuiltIn: true,
    removable: false,
    hideable: true,
    addable: false
  },
  richText: {
    label: "Rich Text",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: true
  },
  keyValue: {
    label: "Key-Value List",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: true
  },
  spacer: {
    label: "Spacer / Divider",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: true
  },
  shared: {
    // Added via the "Shared section" submenu (lists real sections), not the
    // generic add menu — so addable is false.
    label: "Shared Section",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: false
  },
  customField: {
    // Added via the "Custom field" submenu (lists the record's fields).
    label: "Custom Field",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: false
  },
  field: {
    // Added via the label add menu ("Text" / "Key-value"), not the generic one.
    label: "Field",
    isBuiltIn: false,
    removable: true,
    hideable: true,
    addable: false
  }
};

/** Block types a user may append, in menu order. */
export const ADDABLE_BLOCK_TYPES = (
  Object.keys(BLOCK_META) as DocumentBlockType[]
).filter((type) => BLOCK_META[type].addable);

/**
 * Standard layout for a transactional document (quote, order, invoice, PO).
 * Mirrors the hardcoded section order in the existing PDFs so output is
 * identical until a user customizes. Built-in blocks use stable ids (not
 * nanoid) so defaults are deterministic.
 */
function transactionalBlocks(): DocumentBlock[] {
  return [
    {
      id: "watermark",
      type: "watermark",
      visible: true,
      opacity: 0.07,
      placement: "center",
      size: 50
    },
    { id: "header", type: "header", visible: true },
    { id: "parties", type: "parties", visible: true },
    { id: "notes", type: "notes", visible: true },
    { id: "lineItems", type: "lineItems", visible: true },
    { id: "summary", type: "summary", visible: true },
    { id: "terms", type: "terms", visible: true }
  ];
}

/** Standard layout for a fulfillment document (packing slip): no summary. */
function fulfillmentBlocks(): DocumentBlock[] {
  return [
    { id: "header", type: "header", visible: true },
    { id: "parties", type: "parties", visible: true },
    { id: "details", type: "details", visible: true },
    { id: "lineItems", type: "lineItems", visible: true },
    { id: "notes", type: "notes", visible: true },
    { id: "terms", type: "terms", visible: true }
  ];
}

/** Internal warehouse doc (stock transfer): header + details + line items. */
function transferBlocks(): DocumentBlock[] {
  return [
    { id: "header", type: "header", visible: true },
    { id: "details", type: "details", visible: true },
    { id: "lineItems", type: "lineItems", visible: true }
  ];
}

/** Manufacturing routing doc (job traveler): header + job box + ops + notes. */
function jobTravelerBlocks(): DocumentBlock[] {
  return [
    { id: "header", type: "header", visible: true },
    { id: "jobDetails", type: "jobDetails", visible: true },
    {
      id: "operations",
      type: "operations",
      visible: true,
      showWorkInstructions: false
    },
    { id: "notes", type: "notes", visible: true }
  ];
}

/**
 * Tracking label: per-field elements stacked vertically inside each label tile.
 * No header/footer chrome belongs to the label body itself.
 */
function labelBlocks(): DocumentBlock[] {
  return [
    { id: "labelHeading", type: "labelHeading", visible: true },
    { id: "labelRevision", type: "labelRevision", visible: true },
    { id: "labelQuantity", type: "labelQuantity", visible: true },
    { id: "labelTracking", type: "labelTracking", visible: true },
    {
      id: "labelLogo",
      type: "labelLogo",
      visible: false,
      variant: "mark"
    },
    {
      id: "labelCode",
      type: "labelBarcode",
      visible: true,
      symbology: "qrcode",
      value: "{label.trackedEntityId}",
      placement: "right"
    },
    {
      id: "labelEntityId",
      type: "labelEntityId",
      visible: true,
      value: "{label.trackedEntityId}"
    }
  ];
}

/** Quality doc (issue): header + details + associations + notes + tasks + MRB. */
function issueBlocks(): DocumentBlock[] {
  return [
    { id: "header", type: "header", visible: true },
    { id: "issueDetails", type: "issueDetails", visible: true },
    { id: "associations", type: "associations", visible: true },
    { id: "notes", type: "notes", visible: true },
    { id: "actionTasks", type: "actionTasks", visible: true },
    { id: "reviewers", type: "reviewers", visible: true }
  ];
}

/**
 * Default template per supported document type. Adding a document = wire its
 * PDF to consume a template, then add its default here + to the schema enum.
 */
export const DEFAULT_TEMPLATES: Record<DocumentTemplateType, DocumentTemplate> =
  {
    salesInvoice: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "salesInvoice",
      blocks: transactionalBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    salesOrder: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "salesOrder",
      blocks: transactionalBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    purchaseOrder: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "purchaseOrder",
      blocks: transactionalBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    quote: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "quote",
      blocks: transactionalBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    packingSlip: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "packingSlip",
      blocks: fulfillmentBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    stockTransfer: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "stockTransfer",
      blocks: transferBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    jobTraveler: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "jobTraveler",
      blocks: jobTravelerBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    issue: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "issue",
      blocks: issueBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      headerSectionId: BUILT_IN_SECTION_IDS.header,
      footerSectionId: BUILT_IN_SECTION_IDS.footer
    },
    trackingLabel: {
      formatVersion: CURRENT_TEMPLATE_FORMAT_VERSION,
      documentType: "trackingLabel",
      blocks: labelBlocks(),
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      // Labels have no page chrome: the page is the label itself, so there is
      // no header or footer (the renderer ignores them and the editor hides
      // the rows).
      headerSectionId: null,
      footerSectionId: null
    }
  };

/** @deprecated prefer getDefaultTemplate("salesInvoice"). Kept for callers. */
export const DEFAULT_SALES_INVOICE_TEMPLATE = DEFAULT_TEMPLATES.salesInvoice;

export function getDefaultTemplate(
  documentType: DocumentTemplateType
): DocumentTemplate {
  return DEFAULT_TEMPLATES[documentType];
}

interface StoredTemplate {
  formatVersion?: number | null;
  blocks?: DocumentBlock[] | null;
  theme?: Partial<DocumentTheme> | null;
  settings?: Partial<DocumentSettings> | null;
  headerSectionId?: string | null;
  footerSectionId?: string | null;
}

/**
 * Migrate a stored template's block list to the current format version. Today
 * v1 is the only version, so this is a pass-through — but it's the single seam
 * where future shape changes get upgraded on read.
 */
function migrateBlocks(
  blocks: DocumentBlock[],
  _from: number
): DocumentBlock[] {
  return blocks;
}

/**
 * Resolve a stored template row to a renderable template, falling back to the
 * type's default when nothing is stored. Built-in blocks that are missing from
 * a stored template are appended (hidden) so a section added in a later release
 * never silently disappears from existing customer templates.
 */
export function resolveTemplate(
  documentType: DocumentTemplateType,
  stored?: StoredTemplate | null
): DocumentTemplate {
  const fallback = getDefaultTemplate(documentType);
  if (!stored) {
    return {
      ...fallback,
      theme: { ...DEFAULT_THEME },
      settings: { ...DEFAULT_DOCUMENT_SETTINGS }
    };
  }

  const theme = { ...DEFAULT_THEME, ...(stored.theme ?? {}) };
  const settings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(stored.settings ?? {}) };
  // A stored row carries explicit header/footer ids (null = "none" chosen by
  // the user). Only fall back to the default's ids when the field is absent.
  const headerSectionId =
    stored.headerSectionId !== undefined
      ? stored.headerSectionId
      : fallback.headerSectionId;
  const footerSectionId =
    stored.footerSectionId !== undefined
      ? stored.footerSectionId
      : fallback.footerSectionId;

  const formatVersion = CURRENT_TEMPLATE_FORMAT_VERSION;
  const storedBlocks = stored.blocks
    ? migrateBlocks(stored.blocks, stored.formatVersion ?? 1)
    : stored.blocks;

  if (!storedBlocks || storedBlocks.length === 0) {
    return {
      ...fallback,
      formatVersion,
      theme,
      settings,
      headerSectionId,
      footerSectionId
    };
  }

  const present = new Set(storedBlocks.map((b) => b.type));
  const missingBuiltIns = fallback.blocks
    .filter((b) => BLOCK_META[b.type].isBuiltIn && !present.has(b.type))
    .map((b) => ({ ...b, visible: false }));

  return {
    formatVersion,
    documentType,
    blocks: [...storedBlocks, ...missingBuiltIns],
    theme,
    settings,
    headerSectionId,
    footerSectionId
  };
}

/**
 * Whether a document's Line Items block renders thumbnails — the per-template
 * replacement for the old company-level `includeThumbnailsOn*Pdfs` flags. Used
 * by the file routes to decide whether to fetch the (expensive) image data.
 */
export function templateShowsThumbnails(
  template: StoredTemplate | null,
  documentType: DocumentTemplateType
): boolean {
  const resolved = resolveTemplate(documentType, template);
  const block = resolved.blocks.find(
    (b) => b.type === "lineItems" && b.visible
  );
  if (!block || block.type !== "lineItems") return false;
  return { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options }.showThumbnails;
}

/** Collect every section id a template references (body blocks + header/footer). */
export function collectSectionIds(template: {
  blocks: DocumentBlock[];
  headerSectionId?: string | null;
  footerSectionId?: string | null;
}): string[] {
  const ids = new Set<string>();
  for (const block of template.blocks) {
    if (block.type === "shared" && block.sectionId) ids.add(block.sectionId);
  }
  if (template.headerSectionId) ids.add(template.headerSectionId);
  if (template.footerSectionId) ids.add(template.footerSectionId);
  return [...ids];
}

/**
 * Every document users can browse in the customizer picker. `supported` flags
 * whether its PDF is wired to consume a template yet — unsupported docs render
 * disabled ("coming soon") in the picker. Keep `type` of supported entries in
 * sync with `documentTemplateTypeSchema`.
 */
/**
 * Which user-authored extension blocks a document supports:
 * - "all": rich text, key-value, custom field, spacer, shared section.
 * - "text": only the plain-text blocks (rich text, key-value, custom field) —
 *   used by labels, where every block must also be renderable as ZPL text.
 */
export type ExtensionSupport = "all" | "text";

export interface DocumentCatalogEntry {
  type: string;
  label: string;
  group: string;
  supported: boolean;
  /** Defaults to "all". */
  extensions?: ExtensionSupport;
  /**
   * Which theme colors apply (drives the editor's Colors tab + the rendered
   * palette). "full" = accent bar + headings + body; "text" = headings + body
   * only (no accent bar); omitted = none (labels, fixed-palette internal docs).
   */
  themeColors?: "full" | "text";
}

export const DOCUMENT_CATALOG: DocumentCatalogEntry[] = [
  {
    type: "quote",
    label: "Quote",
    group: "Sales",
    supported: true,
    themeColors: "full"
  },
  {
    type: "salesOrder",
    label: "Sales Order",
    group: "Sales",
    supported: true,
    themeColors: "full"
  },
  {
    type: "salesInvoice",
    label: "Sales Invoice",
    group: "Sales",
    supported: true,
    themeColors: "full"
  },
  {
    type: "purchaseOrder",
    label: "Purchase Order",
    group: "Purchasing",
    supported: true,
    themeColors: "full"
  },
  {
    type: "packingSlip",
    label: "Packing Slip",
    group: "Inventory",
    supported: true,
    themeColors: "full"
  },
  {
    type: "stockTransfer",
    label: "Stock Transfer",
    group: "Inventory",
    supported: true,
    themeColors: "full"
  },
  {
    type: "jobTraveler",
    label: "Job Traveler",
    group: "Production",
    supported: true
  },
  {
    type: "issue",
    label: "Issue",
    group: "Quality",
    supported: true,
    themeColors: "text"
  },
  {
    type: "trackingLabel",
    label: "Tracking Label",
    group: "Labels",
    supported: true,
    extensions: "text"
  }
];

export function getDocumentLabel(documentType: string): string {
  return (
    DOCUMENT_CATALOG.find((entry) => entry.type === documentType)?.label ??
    documentType
  );
}

/** Which extension blocks a document supports (defaults to "all"). */
export function extensionSupport(documentType: string): ExtensionSupport {
  return (
    DOCUMENT_CATALOG.find((entry) => entry.type === documentType)?.extensions ??
    "all"
  );
}

/**
 * The theme color keys that apply to a document, in display order — driven by
 * the catalog's `themeColors` policy. "full" docs get the accent bar; "text"
 * docs only headings + body; the rest (labels, fixed-palette internal docs) get
 * none. Drives which swatches the editor shows so users only see colors that
 * take effect.
 */
export function documentThemeColors(
  documentType: DocumentTemplateType
): (keyof DocumentTheme)[] {
  const mode = DOCUMENT_CATALOG.find(
    (entry) => entry.type === documentType
  )?.themeColors;
  if (!mode) return [];
  const keys: (keyof DocumentTheme)[] = [];
  if (mode === "full") keys.push("accent", "accentForeground");
  keys.push("heading", "text");
  return keys;
}
