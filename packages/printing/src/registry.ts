// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PageId } from "@carbon/database/access";

export type DocumentTypeDefinition = {
  id: string;
  displayName: string;
  sourceDocuments: string[];
  builtInRenderer: "zpl" | "pdf" | null;
  defaultFormat: "zpl" | "pdf";
  description: string;
  /** The page a user must be able to view to print it. Labels need none. */
  viewPermission?: PageId;
};

export const documentTypeRegistry = [
  {
    id: "productLabel",
    displayName: "Product Label",
    sourceDocuments: [
      "Receipt",
      "Shipment",
      "Operation",
      "Entity",
      "Job",
      "Split",
      "StockTransfer",
      "PickingList"
    ],
    builtInRenderer: "zpl" as const,
    defaultFormat: "zpl" as const,
    description: "Labels for tracked entities (serial/batch numbers)"
  },
  {
    id: "kanbanCard",
    displayName: "Kanban Card",
    sourceDocuments: ["Kanban"],
    builtInRenderer: "zpl" as const,
    defaultFormat: "pdf" as const,
    description: "Replenishment cards for kanban bins"
  },
  {
    id: "storageUnitLabel",
    displayName: "Storage Unit Label",
    sourceDocuments: ["StorageUnit"],
    builtInRenderer: "zpl" as const,
    defaultFormat: "zpl" as const,
    description: "Labels for shelves, bins, and storage locations"
  },
  {
    id: "packingSlip",
    displayName: "Packing Slip",
    sourceDocuments: ["PackingSlip"],
    builtInRenderer: "pdf" as const,
    defaultFormat: "pdf" as const,
    description: "Full-page packing slip for a shipment",
    viewPermission: "inventory.shipments"
  },
  {
    id: "salesInvoice",
    displayName: "Sales Invoice",
    sourceDocuments: ["SalesInvoice"],
    builtInRenderer: "pdf" as const,
    defaultFormat: "pdf" as const,
    description: "Full-page invoice for a document printer",
    viewPermission: "invoicing.salesInvoices"
  }
] as const satisfies readonly DocumentTypeDefinition[];

export type DocumentTypeId = (typeof documentTypeRegistry)[number]["id"];
export type SourceDocument =
  (typeof documentTypeRegistry)[number]["sourceDocuments"][number];

/**
 * The slots a company sets a BinderyPress template for, one per label type and
 * media size. A product label fills the serial or the batch slot by the item's
 * tracking type; every other label type is its own slot. Full-page documents
 * (invoices) have no slot.
 */
export const labelTemplateTypes = [
  "serialLabel",
  "batchLabel",
  "kanbanCard",
  "storageUnitLabel"
] as const;

export type LabelTemplateType = (typeof labelTemplateTypes)[number];

export function getLabelTemplateType(
  documentTypeId: DocumentTypeId,
  trackingType?: string | null
): LabelTemplateType | null {
  if (documentTypeId === "productLabel") {
    return trackingType === "Serial" ? "serialLabel" : "batchLabel";
  }
  return (labelTemplateTypes as readonly string[]).includes(documentTypeId)
    ? (documentTypeId as LabelTemplateType)
    : null;
}

export function getDocumentTypesForSource(
  sourceDocument: string
): DocumentTypeId[] {
  return documentTypeRegistry
    .filter((dt) =>
      (dt.sourceDocuments as readonly string[]).includes(sourceDocument)
    )
    .map((dt) => dt.id) as DocumentTypeId[];
}

/**
 * The pages a user may view to print a source document (any one of them). The
 * print task reads as the service role, so the route that queues it checks these.
 */
export function getPrintPermissions(sourceDocument: string): PageId[] {
  const permissions = new Set<PageId>();
  for (const dt of documentTypeRegistry as readonly DocumentTypeDefinition[]) {
    if (dt.viewPermission && dt.sourceDocuments.includes(sourceDocument)) {
      permissions.add(dt.viewPermission);
    }
  }
  return [...permissions];
}

export function getDocumentType(
  id: string
): DocumentTypeDefinition | undefined {
  return documentTypeRegistry.find((dt) => dt.id === id);
}

export function getDocumentTypeOptions(): {
  value: string;
  label: string;
}[] {
  return documentTypeRegistry.map((dt) => ({
    value: dt.id,
    label: dt.displayName
  }));
}
