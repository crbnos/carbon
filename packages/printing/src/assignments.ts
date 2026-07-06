import type {
  ContextAssignment,
  LocationAssignment,
  PrintingSettings
} from "./types";

export const printerContexts = [
  "default",
  "shipping",
  "receiving",
  "inventory",
  "workCenter"
] as const;

export type PrinterContext = (typeof printerContexts)[number];

const sourceDocumentContexts: Record<string, PrinterContext> = {
  Shipment: "shipping",
  Receipt: "receiving",
  StockTransfer: "inventory",
  StorageUnit: "inventory"
};

/**
 * Maps a print job's source document to the printer context whose
 * assignment should be used.
 */
export function getPrinterContextForSource(
  sourceDocument: string,
  workCenterId?: string
): PrinterContext {
  return (
    sourceDocumentContexts[sourceDocument] ??
    (workCenterId ? "workCenter" : "default")
  );
}

/**
 * Resolves the effective printer assignment for a context within a location.
 *
 * - "default" returns the location default.
 * - "workCenter" with no explicit entry inherits the location default outright.
 * - Other contexts fall back to the location's default printer when they have
 *   no printer of their own, but keep their own autoPrint flag.
 */
export function resolveContextAssignment(
  assignment: LocationAssignment,
  context: PrinterContext,
  workCenterId?: string
): ContextAssignment {
  const fallback: ContextAssignment = {
    printerRouteId: assignment.defaultPrinterRouteId ?? null,
    autoPrint: assignment.defaultAutoPrint ?? true
  };

  if (context === "default") return fallback;

  const explicit =
    context === "workCenter"
      ? workCenterId
        ? assignment.workCenters?.[workCenterId]
        : undefined
      : assignment[context];

  if (context === "workCenter" && !explicit) return fallback;

  return {
    printerRouteId: explicit?.printerRouteId ?? fallback.printerRouteId,
    autoPrint: explicit?.autoPrint ?? true
  };
}

export function emptyLocationAssignment(): LocationAssignment {
  return {
    defaultPrinterRouteId: null,
    defaultAutoPrint: true,
    shipping: { printerRouteId: null, autoPrint: true },
    receiving: { printerRouteId: null, autoPrint: true },
    inventory: { printerRouteId: null, autoPrint: true },
    workCenters: {}
  };
}

/**
 * Returns a copy of the settings with one context assignment replaced.
 */
export function setContextAssignment(
  settings: PrintingSettings,
  locationId: string,
  context: PrinterContext,
  value: ContextAssignment,
  workCenterId?: string
): PrintingSettings {
  const assignment: LocationAssignment = settings.assignments[locationId]
    ? { ...settings.assignments[locationId] }
    : emptyLocationAssignment();

  switch (context) {
    case "default":
      assignment.defaultPrinterRouteId = value.printerRouteId;
      assignment.defaultAutoPrint = value.autoPrint;
      break;
    case "workCenter":
      if (!workCenterId) {
        throw new Error("workCenterId is required for workCenter assignments");
      }
      assignment.workCenters = {
        ...assignment.workCenters,
        [workCenterId]: value
      };
      break;
    default:
      assignment[context] = value;
  }

  return {
    ...settings,
    assignments: { ...settings.assignments, [locationId]: assignment }
  };
}
