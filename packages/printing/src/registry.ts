export type DocumentTypeDefinition = {
  id: string;
  displayName: string;
  sourceDocuments: string[];
  builtInRenderer: "zpl" | "pdf" | null;
  defaultFormat: "zpl" | "pdf";
  description: string;
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
      "StockTransfer"
    ],
    builtInRenderer: "zpl" as const,
    defaultFormat: "zpl" as const,
    description: "Labels for tracked entities (serial/batch numbers)"
  },
  {
    id: "kanbanCard",
    displayName: "Kanban Card",
    sourceDocuments: ["Kanban"],
    builtInRenderer: "pdf" as const,
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
  }
] as const satisfies readonly DocumentTypeDefinition[];

export type DocumentTypeId = (typeof documentTypeRegistry)[number]["id"];
export type SourceDocument =
  (typeof documentTypeRegistry)[number]["sourceDocuments"][number];

export function getDocumentTypesForSource(
  sourceDocument: string
): DocumentTypeId[] {
  return documentTypeRegistry
    .filter((dt) =>
      (dt.sourceDocuments as readonly string[]).includes(sourceDocument)
    )
    .map((dt) => dt.id) as DocumentTypeId[];
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
