import {
  Button,
  DatePicker,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import {
  endOfMonth,
  getLocalTimeZone,
  parseDate,
  startOfMonth,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCalendarDays, LuCheck, LuChevronLeft } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

type PeriodSelectorVariant = "range" | "asOf";

type PeriodPreset = {
  id: string;
  label: string;
  startDate?: string;
  endDate?: string;
};

type PeriodSelectorProps = {
  /**
   * "range" writes startDate + endDate (trial balance, income statement,
   * chart of accounts); "asOf" writes endDate only (balance sheet).
   */
  variant?: PeriodSelectorVariant;
  /** Fiscal year start month (1-12) from fiscalYearSettings; defaults to January */
  fiscalStartMonth?: number;
};

function quarterStart(date: CalendarDate): CalendarDate {
  const month = Math.floor((date.month - 1) / 3) * 3 + 1;
  return date.set({ month, day: 1 });
}

function fiscalYearStart(date: CalendarDate, startMonth: number): CalendarDate {
  const year = date.month >= startMonth ? date.year : date.year - 1;
  return date.set({ year, month: startMonth, day: 1 });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateRange(start: string, end: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).formatRange(new Date(`${start}T00:00:00`), new Date(`${end}T00:00:00`));
}

function presetDates(preset: PeriodPreset): string | null {
  if (preset.startDate && preset.endDate)
    return formatDateRange(preset.startDate, preset.endDate);
  if (preset.endDate) return formatDate(preset.endDate);
  return null;
}

const PeriodSelector = ({
  variant = "range",
  fiscalStartMonth = 1
}: PeriodSelectorProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"presets" | "custom">("presets");

  const startDate = params.get("startDate") ?? undefined;
  const endDate = params.get("endDate") ?? undefined;

  const [draftStart, setDraftStart] = useState<string | undefined>(startDate);
  const [draftEnd, setDraftEnd] = useState<string | undefined>(endDate);

  const presets = useMemo<PeriodPreset[]>(() => {
    const now = today(getLocalTimeZone());
    const fyStart = fiscalYearStart(now, fiscalStartMonth);
    const thisQuarterStart = quarterStart(now);

    if (variant === "asOf") {
      return [
        {
          id: "today",
          label: t`Today`,
          endDate: now.toString()
        },
        {
          id: "end-of-last-month",
          label: t`End of Last Month`,
          endDate: endOfMonth(now.subtract({ months: 1 })).toString()
        },
        {
          id: "end-of-last-quarter",
          label: t`End of Last Quarter`,
          endDate: thisQuarterStart.subtract({ days: 1 }).toString()
        },
        {
          id: "end-of-last-year",
          label: t`End of Last Fiscal Year`,
          endDate: fyStart.subtract({ days: 1 }).toString()
        }
      ];
    }

    const lastMonth = now.subtract({ months: 1 });
    const lastQuarterStart = thisQuarterStart.subtract({ months: 3 });
    const lastFyStart = fyStart.subtract({ years: 1 });

    return [
      {
        id: "this-month",
        label: t`This Month`,
        startDate: startOfMonth(now).toString(),
        endDate: endOfMonth(now).toString()
      },
      {
        id: "last-month",
        label: t`Last Month`,
        startDate: startOfMonth(lastMonth).toString(),
        endDate: endOfMonth(lastMonth).toString()
      },
      {
        id: "this-quarter",
        label: t`This Quarter`,
        startDate: thisQuarterStart.toString(),
        endDate: endOfMonth(thisQuarterStart.add({ months: 2 })).toString()
      },
      {
        id: "last-quarter",
        label: t`Last Quarter`,
        startDate: lastQuarterStart.toString(),
        endDate: thisQuarterStart.subtract({ days: 1 }).toString()
      },
      {
        id: "this-year",
        label: t`This Fiscal Year`,
        startDate: fyStart.toString(),
        endDate: fyStart.add({ years: 1 }).subtract({ days: 1 }).toString()
      },
      {
        id: "last-year",
        label: t`Last Fiscal Year`,
        startDate: lastFyStart.toString(),
        endDate: fyStart.subtract({ days: 1 }).toString()
      },
      {
        id: "year-to-date",
        label: t`Fiscal Year to Date`,
        startDate: fyStart.toString(),
        endDate: now.toString()
      },
      {
        id: "all-time",
        label: t`All Time`
      }
    ];
  }, [variant, fiscalStartMonth, t]);

  const activePreset = presets.find((preset) =>
    variant === "asOf"
      ? preset.endDate === endDate
      : preset.startDate === startDate && preset.endDate === endDate
  );

  const triggerLabel = activePreset
    ? activePreset.label
    : variant === "asOf"
      ? endDate
        ? t`As of ${formatDate(endDate)}`
        : t`Today`
      : startDate && endDate
        ? `${formatDate(startDate)} – ${formatDate(endDate)}`
        : startDate
          ? t`From ${formatDate(startDate)}`
          : endDate
            ? t`Through ${formatDate(endDate)}`
            : t`All Time`;

  const onSelectPreset = (preset: PeriodPreset) => {
    if (variant === "asOf") {
      setParams({ endDate: preset.endDate });
    } else {
      setParams({ startDate: preset.startDate, endDate: preset.endDate });
    }
    setOpen(false);
  };

  const onApplyCustom = () => {
    if (variant === "asOf") {
      setParams({ endDate: draftEnd });
    } else {
      setParams({ startDate: draftStart, endDate: draftEnd });
    }
    setOpen(false);
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setView("presets");
      setDraftStart(startDate);
      setDraftEnd(endDate);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="secondary" leftIcon={<LuCalendarDays />}>
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={view === "presets" ? "w-[340px] p-1" : "w-[320px] p-3"}
      >
        {view === "presets" ? (
          <div className="flex flex-col">
            {presets.map((preset) => {
              const isActive = preset.id === activePreset?.id;
              const dates = presetDates(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="flex h-8 w-full items-center justify-between gap-3 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => onSelectPreset(preset)}
                >
                  <span className="whitespace-nowrap">{preset.label}</span>
                  <span className="flex items-center gap-2">
                    {dates && (
                      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {dates}
                      </span>
                    )}
                    {isActive && (
                      <LuCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </span>
                </button>
              );
            })}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex h-8 w-full items-center justify-between rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => setView("custom")}
            >
              <span>
                <Trans>Custom…</Trans>
              </span>
              {!activePreset && (startDate || endDate) && (
                <LuCheck className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_2fr] items-center gap-y-2">
              {variant === "range" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Start Date</Trans>
                  </p>
                  <DatePicker
                    value={draftStart ? parseDate(draftStart) : null}
                    onChange={(value) => setDraftStart(value?.toString())}
                  />
                </>
              )}
              <p className="text-sm text-muted-foreground">
                {variant === "asOf" ? (
                  <Trans>As of</Trans>
                ) : (
                  <Trans>End Date</Trans>
                )}
              </p>
              <DatePicker
                value={draftEnd ? parseDate(draftEnd) : null}
                onChange={(value) => setDraftEnd(value?.toString())}
              />
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LuChevronLeft />}
                onClick={() => setView("presets")}
              >
                <Trans>Back</Trans>
              </Button>
              <Button variant="primary" size="sm" onClick={onApplyCustom}>
                <Trans>Apply</Trans>
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default PeriodSelector;
