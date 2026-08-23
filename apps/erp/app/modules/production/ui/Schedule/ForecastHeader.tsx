import {
  Button,
  Calendar,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  getLocalTimeZone,
  parseDate,
  startOfWeek,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useMemo, useState } from "react";
import {
  LuCalendarDays,
  LuCalendarRange,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuRefreshCw
} from "react-icons/lu";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { useLocations } from "~/components/Form/Location";
import { path } from "~/utils/path";

export type ForecastRange = "day" | "week" | "shift";

type ForecastHeaderProps = {
  range: ForecastRange;
  date: string;
  locationId: string;
  departmentId: string | null;
  shiftId: string | null;
  departments: { value: string; label: string }[];
  shifts: { id: string; name: string }[];
};

/**
 * The forecast page's header: location / department / shift filters, the
 * Day | Week | Shift window switcher, load counts, and date navigation with a
 * calendar / week-list popover — mirroring the people page's header pattern.
 */
export function ForecastHeader({
  range,
  date,
  locationId,
  departmentId,
  shiftId,
  departments,
  shifts
}: ForecastHeaderProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const locations = useLocations();
  const regenerateFetcher = useFetcher<{
    success: boolean;
    error: string | null;
  }>();

  // Surface the regen outcome — a failed regen is never silent, and a quick
  // success confirms the board it repaints is fresh rather than empty-because-
  // broken.
  useEffect(() => {
    if (regenerateFetcher.state !== "idle" || !regenerateFetcher.data) return;
    if (regenerateFetcher.data.success) {
      toast.success(t`Schedule regenerated`);
    } else {
      toast.error(
        regenerateFetcher.data.error ?? t`Failed to regenerate schedule`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenerateFetcher.state, regenerateFetcher.data]);

  const [dateOpen, setDateOpen] = useState(false);
  const parsedDate = parseDate(date);

  const setParam = (mutate: (params: URLSearchParams) => void) => {
    const newParams = new URLSearchParams(searchParams);
    mutate(newParams);
    navigate(`?${newParams.toString()}`);
  };

  const setRange = (value: string) =>
    setParam((params) => {
      if (value === "day") params.delete("range");
      else params.set("range", value);
    });

  const setDepartment = (value: string) =>
    setParam((params) => {
      if (value === "all") params.delete("department");
      else params.set("department", value);
    });

  const setShift = (value: string) =>
    setParam((params) => params.set("shift", value));

  const goToToday = () => setParam((params) => params.delete("date"));

  // A shift is a single calendar day, so it steps by a day like the day view;
  // the week view steps by a whole week.
  const navigateDate = (direction: number) =>
    setParam((params) =>
      params.set(
        "date",
        parsedDate
          .add({ days: range === "week" ? direction * 7 : direction })
          .toString()
      )
    );

  const weekStart = startOfWeek(parsedDate, "en-GB");

  const dateLabel =
    range === "week"
      ? `${formatDate(
          weekStart.toString(),
          { month: "short", day: "numeric" },
          locale
        )} – ${formatDate(
          weekStart.add({ days: 6 }).toString(),
          { month: "short", day: "numeric" },
          locale
        )}`
      : formatDate(
          date,
          { weekday: "short", month: "short", day: "numeric" },
          locale
        );

  // A window of selectable weeks centered on the current selection (4 back →
  // 11 ahead), mirroring the people page's week popover.
  const weekOptions = useMemo(() => {
    const currentWeekStart = startOfWeek(today(getLocalTimeZone()), "en-GB");
    return Array.from({ length: 16 }, (_, i) => {
      const start = weekStart.add({ days: (i - 4) * 7 });
      return {
        start: start.toString(),
        label: `${formatDate(
          start.toString(),
          { month: "short", day: "numeric" },
          locale
        )} – ${formatDate(
          start.add({ days: 6 }).toString(),
          { month: "short", day: "numeric" },
          locale
        )}`,
        isSelected: start.compare(weekStart) === 0,
        isCurrent: start.compare(currentWeekStart) === 0
      };
    });
  }, [weekStart, locale]);

  return (
    <HStack className="pl-2 pr-4 py-2 flex flex-wrap gap-y-2 justify-between bg-card border-b border-border">
      <HStack className="flex-wrap gap-y-2">
        <HStack spacing={2} className="flex-wrap gap-y-2">
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              if (!selected) return;
              const newParams = new URLSearchParams(searchParams);
              newParams.set("location", selected);
              window.location.href = `${path.to.scheduleForecast}?${newParams.toString()}`;
            }}
          />
          {departments.length > 0 && (
            <Combobox
              asButton
              size="sm"
              value={departmentId ?? "all"}
              options={[
                { value: "all", label: t`All departments` },
                ...departments
              ]}
              onChange={(selected) => setDepartment(selected || "all")}
            />
          )}
          {range === "shift" && shifts.length > 0 && (
            <Combobox
              asButton
              size="sm"
              value={shiftId ?? shifts[0]?.id}
              options={shifts.map((shift) => ({
                value: shift.id,
                label: shift.name
              }))}
              onChange={(selected) => selected && setShift(selected)}
            />
          )}
        </HStack>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="md"
              leftIcon={<LuCalendarRange />}
              rightIcon={<LuChevronDown />}
            >
              {range === "week"
                ? t`Week`
                : range === "shift"
                  ? t`Shift`
                  : t`Day`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={range} onValueChange={setRange}>
              <DropdownMenuRadioItem value="day">
                {t`Day`}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="week">
                {t`Week`}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="shift">
                {t`Shift`}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </HStack>

      <HStack className="flex-wrap gap-y-2">
        <HStack>
          <regenerateFetcher.Form
            method="post"
            action={path.to.api.schedule(locationId)}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  type="submit"
                  variant="secondary"
                  aria-label={t`Regenerate`}
                  icon={<LuRefreshCw />}
                  isDisabled={regenerateFetcher.state !== "idle"}
                  isLoading={regenerateFetcher.state !== "idle"}
                />
              </TooltipTrigger>
              <TooltipContent>
                <Trans>
                  Regenerate the schedule for this location now. It also runs
                  automatically about 30 seconds after the last scheduling
                  change (edits are batched, so several quick changes trigger a
                  single regeneration).
                </Trans>
              </TooltipContent>
            </Tooltip>
          </regenerateFetcher.Form>
          <Button variant="secondary" onClick={goToToday}>
            <Trans>Today</Trans>
          </Button>
          <IconButton
            variant="secondary"
            onClick={() => navigateDate(-1)}
            icon={<LuChevronLeft />}
            aria-label={range === "week" ? t`Previous week` : t`Previous day`}
          />
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                className="min-w-[150px]"
                leftIcon={<LuCalendarDays />}
              >
                {dateLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className={range === "week" ? "w-64 p-2" : "w-auto p-4"}
            >
              {range === "week" ? (
                <div className="flex max-h-80 flex-col gap-0.5 overflow-auto">
                  {weekOptions.map((week) => (
                    <button
                      key={week.start}
                      type="button"
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                        week.isSelected && "bg-muted font-medium"
                      )}
                      onClick={() => {
                        setDateOpen(false);
                        setParam((params) => params.set("date", week.start));
                      }}
                    >
                      <span className="tabular-nums">{week.label}</span>
                      {week.isCurrent && (
                        <span className="text-[11px] font-medium text-primary">
                          <Trans>This week</Trans>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <Calendar
                  value={parsedDate}
                  onChange={(value) => {
                    if (!value) return;
                    setDateOpen(false);
                    setParam((params) => params.set("date", value.toString()));
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          <IconButton
            variant="secondary"
            onClick={() => navigateDate(1)}
            icon={<LuChevronRight />}
            aria-label={range === "week" ? t`Next week` : t`Next day`}
          />
        </HStack>
      </HStack>
    </HStack>
  );
}
