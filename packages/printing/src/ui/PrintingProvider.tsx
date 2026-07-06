import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { PrinterContext } from "../assignments";
import { resolveContextAssignment } from "../assignments";
import type { PrinterRoute, PrintingSettings } from "../types";

export type PrintingProviderValue = {
  printing: PrintingSettings | null;
  printerRoutes: PrinterRoute[];
  useMetric: boolean;
  /** POST target for queueing a manual print job */
  printPath: string;
  /** href for the printer settings page */
  settingsPath: string;
  /** open printer settings in a new tab (e.g. MES links to ERP) */
  settingsExternal?: boolean;
};

const PrintingContext = createContext<PrintingProviderValue | null>(null);

export function PrintingProvider({
  value,
  children
}: {
  value: PrintingProviderValue;
  children: ReactNode;
}) {
  return (
    <PrintingContext.Provider value={value}>
      {children}
    </PrintingContext.Provider>
  );
}

export function usePrinting() {
  const context = useContext(PrintingContext);
  if (!context) {
    throw new Error("usePrinting must be used within a PrintingProvider");
  }

  const { printing, printerRoutes } = context;

  const routeMap = useMemo(
    () => new Map(printerRoutes.map((r) => [r.id, r])),
    [printerRoutes]
  );

  const resolvePrinterRoute = useCallback(
    (
      locationId: string | undefined,
      printerContext: PrinterContext,
      workCenterId?: string
    ): PrinterRoute | null => {
      if (!locationId || !printing) return null;

      const assignment = printing.assignments?.[locationId];
      if (!assignment) return null;

      const { printerRouteId } = resolveContextAssignment(
        assignment,
        printerContext,
        workCenterId
      );

      if (!printerRouteId) return null;
      return routeMap.get(printerRouteId) ?? null;
    },
    [printing, routeMap]
  );

  const hasPrinter = useCallback(
    (
      locationId: string | undefined,
      printerContext: PrinterContext,
      workCenterId?: string
    ): boolean => {
      return (
        resolvePrinterRoute(locationId, printerContext, workCenterId) !== null
      );
    },
    [resolvePrinterRoute]
  );

  return { ...context, resolvePrinterRoute, hasPrinter };
}
