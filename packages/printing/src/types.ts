export type ContextAssignment = {
  printerRouteId: string | null;
  autoPrint: boolean;
};

export type LocationAssignment = {
  defaultPrinterRouteId: string | null;
  defaultAutoPrint: boolean;
  shipping: ContextAssignment;
  receiving: ContextAssignment;
  inventory: ContextAssignment;
  workCenters: Record<string, ContextAssignment>;
};

export type PrintingSettings = {
  assignments: Record<string, LocationAssignment>;
};

export type PrinterRoute = {
  id: string;
  companyId: string;
  locationId: string | null;
  name: string;
  format: "zpl" | "pdf";
  mediaSizeId: string | null;
  printerUrl: string;
  apiKey: string | null;
  templateId: string | null;
};

export type PrintJobStatus =
  | "generating"
  | "queued"
  | "printing"
  | "completed"
  | "failed";
export type PrintJobOrigin = "auto" | "manual" | "reprint";
export type PrintJobContentType = "zpl" | "pdf";

export type PrintJob = {
  id: string;
  companyId: string;
  status: PrintJobStatus;
  contentType: PrintJobContentType | null;
  content: string | null;
  printerUrl: string;
  sourceDocument: string;
  sourceDocumentId: string;
  sourceDocumentReadableId: string | null;
  description: string;
  origin: PrintJobOrigin;
  error: string | null;
  attempts: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
  completedAt: string | null;
};
