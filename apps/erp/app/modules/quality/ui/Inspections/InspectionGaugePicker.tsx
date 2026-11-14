// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuGauge,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { GaugeCalibrationStatus } from "../Gauge/GaugeStatus";

// A row of the `gauges` view (every column is nullable on a view).
export type GaugeOption = {
  id: string | null;
  gaugeId: string | null;
  description: string | null;
  gaugeTypeId: string | null;
  gaugeStatus: Database["public"]["Enums"]["gaugeStatus"] | null;
  gaugeCalibrationStatusWithDueDate:
    | Database["public"]["Enums"]["gaugeCalibrationStatus"]
    | null;
};

type InspectionGaugePickerProps = {
  // Every Active gauge plus any (possibly retired) gauge recorded on this lot.
  // Only Active gauges are offered; the rest exist so a recorded gauge still
  // displays by its readable id.
  gauges: GaugeOption[];
  // The characteristic's label (balloon number), for the trigger's
  // accessible name.
  characteristicLabel: string;
  // Gauge ids most recently recorded at this lot's work center, newest first.
  recentGaugeIds: string[];
  // The feature's required gauge type — when set, only gauges of that type
  // are offered.
  gaugeTypeId: string | null;
  gaugeTypeName: string | null;
  value: string | null;
  isReadOnly: boolean;
  onChange: (gaugeId: string | null) => void;
  // "cell" fills a table cell (By characteristic). "chip" is a compact pill
  // that sits beside the progress badges in a column header (By part).
  variant?: "cell" | "chip";
};

const isOutOfCalibration = (gauge: GaugeOption) =>
  gauge.gaugeCalibrationStatusWithDueDate === "Out-of-Calibration";

// The gauge cell of an inspection grid: a button filling the whole cell that
// opens a searchable list, with the gauges recently used at this work center
// on top and the rest below.
const InspectionGaugePicker = ({
  gauges,
  characteristicLabel,
  recentGaugeIds,
  gaugeTypeId,
  gaugeTypeName,
  value,
  isReadOnly,
  onChange,
  variant = "cell"
}: InspectionGaugePickerProps) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const selected = value ? gauges.find((g) => g.id === value) : undefined;

  const { recent, rest } = useMemo(() => {
    const eligible = gauges.filter(
      (g) =>
        g.id &&
        g.gaugeStatus === "Active" &&
        (!gaugeTypeId || g.gaugeTypeId === gaugeTypeId)
    );
    const byId = new Map(eligible.map((g) => [g.id as string, g]));
    const recent = recentGaugeIds
      .map((id) => byId.get(id))
      .filter((g): g is GaugeOption => g !== undefined);
    const recentIds = new Set(recent.map((g) => g.id));
    return {
      recent,
      rest: eligible.filter((g) => !recentIds.has(g.id))
    };
  }, [gauges, recentGaugeIds, gaugeTypeId]);

  const placeholder = gaugeTypeName ?? t`Add gauge`;
  const isInactive = selected?.gaugeStatus === "Inactive";

  const outOfCalibration = selected ? isOutOfCalibration(selected) : false;
  const chipClassName = cn(
    // Capped so a long description truncates instead of widening the column.
    "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
    !value &&
      "border-dashed border-border text-muted-foreground hover:border-solid hover:bg-accent hover:text-foreground",
    value &&
      !outOfCalibration &&
      "border-border bg-muted/40 text-foreground hover:bg-accent",
    outOfCalibration &&
      "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
  );
  const chipContent = (
    <>
      {outOfCalibration ? (
        <LuTriangleAlert
          role="img"
          className="size-3.5 shrink-0"
          aria-label={t`Out of calibration`}
        />
      ) : (
        <LuGauge className="size-3.5 shrink-0" aria-hidden />
      )}
      {selected ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "shrink-0 font-medium",
              isInactive && "text-muted-foreground"
            )}
          >
            {selected.gaugeId}
          </span>
          {selected.description && (
            <span className="truncate text-muted-foreground">
              {selected.description}
            </span>
          )}
          {isInactive && (
            <span className="shrink-0 text-muted-foreground">
              {t`(Inactive)`}
            </span>
          )}
        </span>
      ) : (
        <span className="truncate">
          {value ? t`Unknown gauge` : placeholder}
        </span>
      )}
    </>
  );

  // The cell variant shows the same content as the chip, without its border.
  const cellContent = (
    <span
      className={cn(
        "flex min-w-0 max-w-[220px] items-center gap-1.5 text-xs",
        !value && "text-muted-foreground",
        outOfCalibration && "text-red-700 dark:text-red-300"
      )}
    >
      {chipContent}
    </span>
  );

  if (variant === "chip" && isReadOnly) {
    return value ? (
      <span className={cn(chipClassName, "pointer-events-none")}>
        {chipContent}
      </span>
    ) : null;
  }

  if (isReadOnly) {
    return (
      <div className="flex h-full min-w-[120px] items-center px-3">
        {selected || value ? cellContent : "—"}
      </div>
    );
  }

  const renderItem = (gauge: GaugeOption) => (
    <CommandItem
      key={gauge.id}
      value={`${gauge.gaugeId ?? ""} ${gauge.description ?? ""} ${gauge.id}`}
      onSelect={() => {
        onChange(gauge.id);
        setOpen(false);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium">{gauge.gaugeId}</span>
        {gauge.description && (
          <span className="truncate text-xs text-muted-foreground">
            {gauge.description}
          </span>
        )}
      </div>
      {isOutOfCalibration(gauge) && (
        <GaugeCalibrationStatus
          status={gauge.gaugeCalibrationStatusWithDueDate}
        />
      )}
      <LuCheck
        className={cn(
          "ml-2 size-4 shrink-0",
          gauge.id === value ? "opacity-100" : "opacity-0"
        )}
      />
    </CommandItem>
  );

  const currentGauge = selected
    ? `${selected.gaugeId ?? ""}${isInactive ? ` ${t`(Inactive)`}` : ""}`
    : value
      ? t`Unknown gauge`
      : t`None`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "chip" ? (
          <button
            type="button"
            aria-label={t`Gauge for characteristic ${characteristicLabel}: ${currentGauge}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              chipClassName,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {chipContent}
            {value && <LuChevronDown className="size-3 shrink-0 opacity-60" />}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t`Gauge for characteristic ${characteristicLabel}: ${currentGauge}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full min-h-10 w-full min-w-[120px] items-center justify-between gap-2 px-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {cellContent}
            <LuChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput
            placeholder={
              gaugeTypeName
                ? t`Search ${gaugeTypeName}...`
                : t`Search gauges...`
            }
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>{t`No gauges found.`}</CommandEmpty>
            {recent.length > 0 && (
              <CommandGroup heading={t`Recently used`}>
                {recent.map(renderItem)}
              </CommandGroup>
            )}
            {rest.length > 0 && (
              <CommandGroup
                heading={recent.length > 0 ? t`All gauges` : undefined}
              >
                {rest.map(renderItem)}
              </CommandGroup>
            )}
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <LuX className="mr-2 size-4 shrink-0" />
                  {t`Clear gauge`}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default InspectionGaugePicker;
