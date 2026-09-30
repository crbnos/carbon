import {
  Badge,
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
import { LuCheck, LuChevronDown, LuTriangleAlert, LuX } from "react-icons/lu";

// A row of the `gauges` view (every column is nullable on a view).
export type GaugeOption = {
  id: string | null;
  gaugeId: string | null;
  description: string | null;
  gaugeTypeId: string | null;
  gaugeCalibrationStatusWithDueDate: string | null;
};

type InspectionGaugePickerProps = {
  gauges: GaugeOption[];
  // Gauge ids most recently recorded at this lot's work center, newest first.
  recentGaugeIds: string[];
  // The feature's required gauge type — when set, only gauges of that type
  // are offered.
  gaugeTypeId: string | null;
  gaugeTypeName: string | null;
  value: string | null;
  isReadOnly: boolean;
  onChange: (gaugeId: string | null) => void;
};

const isOutOfCalibration = (gauge: GaugeOption) =>
  gauge.gaugeCalibrationStatusWithDueDate === "Out-of-Calibration";

// The gauge cell of an inspection grid: a button filling the whole cell that
// opens a searchable list, with the gauges recently used at this work center
// on top and the rest below.
const InspectionGaugePicker = ({
  gauges,
  recentGaugeIds,
  gaugeTypeId,
  gaugeTypeName,
  value,
  isReadOnly,
  onChange
}: InspectionGaugePickerProps) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const selected = value ? gauges.find((g) => g.id === value) : undefined;

  const { recent, rest } = useMemo(() => {
    const eligible = gauges.filter(
      (g) => g.id && (!gaugeTypeId || g.gaugeTypeId === gaugeTypeId)
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

  const placeholder = gaugeTypeName ?? t`Select gauge`;

  const label = selected ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {isOutOfCalibration(selected) && (
        <LuTriangleAlert
          className="size-3.5 shrink-0 text-amber-500"
          aria-label={t`Out of calibration`}
        />
      )}
      <span className="truncate font-mono text-xs">{selected.gaugeId}</span>
    </span>
  ) : value ? (
    <span className="truncate text-xs text-muted-foreground">
      {t`Inactive gauge`}
    </span>
  ) : (
    <span className="truncate text-xs text-muted-foreground">
      {placeholder}
    </span>
  );

  if (isReadOnly) {
    return (
      <div className="flex h-full min-w-[120px] items-center px-3">
        {selected || value ? label : "—"}
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
        <span className="truncate font-mono text-xs">{gauge.gaugeId}</span>
        {gauge.description && (
          <span className="truncate text-xs text-muted-foreground">
            {gauge.description}
          </span>
        )}
      </div>
      {isOutOfCalibration(gauge) && (
        <Badge variant="yellow" className="shrink-0 text-[10px]">
          {t`Out of calibration`}
        </Badge>
      )}
      <LuCheck
        className={cn(
          "ml-2 size-4 shrink-0",
          gauge.id === value ? "opacity-100" : "opacity-0"
        )}
      />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex h-full min-h-10 w-full min-w-[120px] items-center justify-between gap-2 px-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {label}
          <LuChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
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
