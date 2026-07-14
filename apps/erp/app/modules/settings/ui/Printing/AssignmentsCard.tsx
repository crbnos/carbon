import type {
  ContextAssignment,
  LocationAssignment,
  PrinterContext,
  PrinterRoute,
  PrintingSettings
} from "@carbon/printing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  Switch,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo } from "react";
import {
  LuBlocks,
  LuHandCoins,
  LuMapPin,
  LuTruck,
  LuWrench
} from "react-icons/lu";
import { useFetcher } from "react-router";

type AssignmentUpdate = {
  locationId: string;
  context: PrinterContext;
  contextId?: string;
  printerRouteId?: string;
  autoPrint?: boolean;
};

export function AssignmentsCard({
  printing,
  printerRoutes,
  locations,
  workCenters
}: {
  printing: PrintingSettings | null;
  printerRoutes: PrinterRoute[];
  locations: { id: string; name: string }[];
  workCenters: {
    id: string | null;
    name: string | null;
    locationId: string | null;
  }[];
}) {
  const { t } = useLingui();
  const assignmentFetcher = useFetcher<{ success: boolean; message: string }>();

  const printerRouteOptions = useMemo(
    () => [
      { value: "", label: t`None` },
      ...printerRoutes.map((r) => ({
        value: r.id,
        label: r.name
      }))
    ],
    [printerRoutes, t]
  );

  const printerRouteMap = useMemo(
    () => new Map(printerRoutes.map((r) => [r.id, r.name])),
    [printerRoutes]
  );

  const workCentersByLocation = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const wc of workCenters) {
      if (!wc.id || !wc.name || !wc.locationId) continue;
      const existing = map.get(wc.locationId) ?? [];
      existing.push({ id: wc.id, name: wc.name });
      map.set(wc.locationId, existing);
    }
    return map;
  }, [workCenters]);

  useEffect(() => {
    if (
      assignmentFetcher.data?.success === true &&
      assignmentFetcher.data?.message
    ) {
      toast.success(assignmentFetcher.data.message);
    }
    if (
      assignmentFetcher.data?.success === false &&
      assignmentFetcher.data?.message
    ) {
      toast.error(assignmentFetcher.data.message);
    }
  }, [assignmentFetcher.data?.message, assignmentFetcher.data?.success]);

  const submitAssignment = useCallback(
    (data: AssignmentUpdate) => {
      const formData = new FormData();
      formData.set("intent", "updateAssignment");
      formData.set("locationId", data.locationId);
      formData.set("context", data.context);
      if (data.contextId) formData.set("contextId", data.contextId);
      if (data.printerRouteId)
        formData.set("printerRouteId", data.printerRouteId);
      if (data.autoPrint) formData.set("autoPrint", "on");
      assignmentFetcher.submit(formData, { method: "POST" });
    },
    [assignmentFetcher]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Assignments</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Assign printers to locations. Shipping, receiving, and work centers
            inherit the location default unless overridden.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {locations.length > 0 ? (
          <div className="flex flex-col">
            {locations.map((location) => (
              <LocationSection
                key={location.id}
                locationId={location.id}
                locationName={location.name}
                assignment={printing?.assignments?.[location.id] ?? null}
                workCenters={workCentersByLocation.get(location.id) ?? []}
                printerRouteOptions={printerRouteOptions}
                printerRouteMap={printerRouteMap}
                onUpdate={submitAssignment}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>No locations found.</Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type AssignmentRowModel = {
  context: PrinterContext;
  contextId?: string;
  label: string;
  icon: ReactNode;
  isDefault?: boolean;
  /** The explicitly stored assignment for this context (not the resolved one) */
  explicit: ContextAssignment | null;
};

function LocationSection({
  locationId,
  locationName,
  assignment,
  workCenters,
  printerRouteOptions,
  printerRouteMap,
  onUpdate
}: {
  locationId: string;
  locationName: string;
  assignment: LocationAssignment | null;
  workCenters: { id: string; name: string }[];
  printerRouteOptions: { value: string; label: string }[];
  printerRouteMap: Map<string, string>;
  onUpdate: (data: AssignmentUpdate) => void;
}) {
  const defaultPrinterId = assignment?.defaultPrinterRouteId ?? null;
  const defaultPrinterName = defaultPrinterId
    ? (printerRouteMap.get(defaultPrinterId) ?? null)
    : null;

  const rows: AssignmentRowModel[] = [
    {
      context: "default",
      label: locationName,
      icon: <LuMapPin />,
      isDefault: true,
      explicit: assignment
        ? {
            printerRouteId: assignment.defaultPrinterRouteId,
            autoPrint: assignment.defaultAutoPrint
          }
        : null
    },
    {
      context: "shipping",
      label: "Shipping",
      icon: <LuTruck />,
      explicit: assignment?.shipping ?? null
    },
    {
      context: "receiving",
      label: "Receiving",
      icon: <LuHandCoins />,
      explicit: assignment?.receiving ?? null
    },
    {
      context: "inventory",
      label: "Inventory",
      icon: <LuBlocks />,
      explicit: assignment?.inventory ?? null
    },
    ...workCenters.map<AssignmentRowModel>((wc) => ({
      context: "workCenter",
      contextId: wc.id,
      label: wc.name,
      icon: <LuWrench />,
      explicit: assignment?.workCenters?.[wc.id] ?? null
    }))
  ];

  return (
    <div className="border-b border-border last:border-b-0">
      {rows.map((row) => (
        <AssignmentRow
          key={row.contextId ?? row.context}
          label={row.label}
          icon={row.icon}
          isBold={row.isDefault}
          isIndented={!row.isDefault}
          printerRouteId={row.explicit?.printerRouteId ?? null}
          inheritedName={row.isDefault ? null : defaultPrinterName}
          autoPrint={row.explicit?.autoPrint ?? true}
          printerRouteOptions={printerRouteOptions}
          onPrinterChange={(printerRouteId) =>
            onUpdate({
              locationId,
              context: row.context,
              contextId: row.contextId,
              printerRouteId,
              autoPrint: printerRouteId
                ? true
                : (row.explicit?.autoPrint ?? false)
            })
          }
          onAutoPrintChange={(autoPrint) =>
            onUpdate({
              locationId,
              context: row.context,
              contextId: row.contextId,
              printerRouteId: row.explicit?.printerRouteId ?? undefined,
              autoPrint
            })
          }
        />
      ))}
    </div>
  );
}

function AssignmentRow({
  label,
  icon,
  isBold,
  isIndented,
  printerRouteId,
  inheritedName,
  autoPrint,
  printerRouteOptions,
  onPrinterChange,
  onAutoPrintChange
}: {
  label: string;
  icon: ReactNode;
  isBold?: boolean;
  isIndented?: boolean;
  printerRouteId: string | null;
  inheritedName: string | null;
  autoPrint: boolean;
  printerRouteOptions: { value: string; label: string }[];
  onPrinterChange: (printerRouteId: string) => void;
  onAutoPrintChange: (autoPrint: boolean) => void;
}) {
  const displayState = printerRouteId
    ? ("assigned" as const)
    : inheritedName
      ? ("inherited" as const)
      : ("missing" as const);

  const placeholder =
    displayState === "inherited"
      ? `inherits ${inheritedName}`
      : displayState === "missing"
        ? "No printer"
        : undefined;

  return (
    <div
      className={`flex items-center justify-between py-2.5 ${isIndented ? "pl-7" : ""} ${!isBold ? "border-t border-border/50" : ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="size-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
          <span className="size-4 text-muted-foreground">{icon}</span>
        </div>
        <span
          className={`text-sm ${isBold ? "font-medium" : "text-muted-foreground"}`}
        >
          {label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-[320px]">
          <Combobox
            size="sm"
            value={printerRouteId ?? ""}
            options={printerRouteOptions}
            onChange={(selected) => onPrinterChange(selected)}
            isClearable
            placeholder={placeholder}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Switch
            variant="small"
            checked={autoPrint}
            onCheckedChange={onAutoPrintChange}
          />
          <span className="text-xs text-muted-foreground">Auto-print</span>
        </div>
      </div>
    </div>
  );
}
