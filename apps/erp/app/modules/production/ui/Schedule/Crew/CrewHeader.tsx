import {
  Button,
  Calendar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuBuilding2,
  LuCalendarDays,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuClock,
  LuCopy,
  LuEllipsisVertical,
  LuMapPin,
  LuTimer,
  LuUserX
} from "react-icons/lu";
import { useNavigate, useSearchParams, useSubmit } from "react-router";
import { useLocations } from "~/components/Form/Location";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { ScheduleNavigation } from "../Kanban/ScheuleNavigation";
import { CrewFilter } from "./CrewFilter";

export type WeekOption = {
  start: string;
  label: string;
  isSelected: boolean;
  isCurrent: boolean;
};

type CrewHeaderProps = {
  view: "board" | "matrix" | "capacity";
  range: "day" | "week";
  date: string;
  dateLabel: string;
  weekDates: string[];
  weekOptions: WeekOption[];
  locationId: string;
  departmentId: string | null;
  shiftId: string | null;
  departments: { value: string; label: string }[];
  shifts: { id: string; name: string }[];
  onOpenOvertime: () => void;
  onOpenTimeOff: () => void;
};

/**
 * The crew page's header row: schedule navigation, location/department/shift
 * filters, the view + horizon tabs, copy day/week actions, date navigation
 * with the calendar / week-list popover, and the overtime / time-off menu.
 */
export function CrewHeader({
  view,
  range,
  date,
  dateLabel,
  weekDates,
  weekOptions,
  locationId,
  departmentId,
  shiftId,
  departments,
  shifts,
  onOpenOvertime,
  onOpenTimeOff
}: CrewHeaderProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const locations = useLocations();

  const [dateOpen, setDateOpen] = useState(false);
  const parsedDate = parseDate(date);

  const setParam = (mutate: (params: URLSearchParams) => void) => {
    const newParams = new URLSearchParams(searchParams);
    mutate(newParams);
    navigate(`?${newParams.toString()}`);
  };

  // Day | Week horizon on the board (assign per day or per whole week)
  const setPeriod = (value: string) =>
    setParam((params) => {
      if (value === "week") params.set("range", "week");
      else params.delete("range");
    });

  const setView = (value: string) =>
    setParam((params) => {
      if (value === "board") params.delete("view");
      else params.set("view", value);
    });

  const goToToday = () => setParam((params) => params.delete("date"));

  const setShift = (value: string) =>
    setParam((params) => {
      if (value === "all") params.delete("shift");
      else params.set("shift", value);
    });

  const setDepartment = (value: string) => {
    const next = value === "all" ? "" : value;
    document.cookie = `crewDepartment=${encodeURIComponent(
      next
    )}; path=/; max-age=31536000; samesite=lax`;
    setParam((params) => {
      if (next) params.set("department", next);
      else params.delete("department");
    });
  };

  const navigateDate = (direction: number) =>
    setParam((params) => {
      params.set(
        "date",
        parsedDate
          .add({ days: range === "day" ? direction : direction * 7 })
          .toString()
      );
    });

  const submitIntent = (payload: Record<string, string>, fetcherKey: string) =>
    submit(payload, {
      method: "post",
      action: path.to.scheduleCrewUpdate,
      navigate: false,
      fetcherKey
    });

  const copyPreviousDay = () =>
    submitIntent(
      {
        intent: "copy",
        locationId,
        fromDate: parsedDate.add({ days: -1 }).toString(),
        toDate: date,
        ...(shiftId ? { shiftId } : {})
      },
      "crew:copy"
    );

  const copyPreviousWeek = () =>
    submitIntent(
      {
        intent: "copy-week",
        locationId,
        fromWeekStart: parseDate(weekDates[0]).subtract({ days: 7 }).toString(),
        toWeekStart: weekDates[0],
        ...(shiftId ? { shiftId } : {})
      },
      "crew:copy-week"
    );

  // same crews next week: push this week forward, then follow it
  const copyToNextWeek = () => {
    const nextWeekStart = parseDate(weekDates[0]).add({ days: 7 }).toString();
    submitIntent(
      {
        intent: "copy-week",
        locationId,
        fromWeekStart: weekDates[0],
        toWeekStart: nextWeekStart,
        ...(shiftId ? { shiftId } : {})
      },
      "crew:copy-week"
    );
    setParam((params) => params.set("date", nextWeekStart));
  };

  return (
    <HStack className="px-4 py-2 flex flex-wrap gap-y-2 justify-between bg-card border-b border-border">
      <HStack className="flex-wrap gap-y-2">
        <ScheduleNavigation />
        <CrewFilter
          categories={[
            {
              key: "location",
              header: t`Location`,
              icon: <LuMapPin />,
              options: locations,
              value: locationId,
              clearable: false
            },
            ...(departments.length > 0
              ? [
                  {
                    key: "department",
                    header: t`Department`,
                    icon: <LuBuilding2 />,
                    options: departments,
                    value: departmentId,
                    clearable: true
                  }
                ]
              : []),
            ...(view !== "capacity" && shifts.length > 1
              ? [
                  {
                    key: "shift",
                    header: t`Shift`,
                    icon: <LuClock />,
                    options: shifts.map((shift) => ({
                      value: shift.id,
                      label: shift.name
                    })),
                    value: shiftId,
                    clearable: true
                  }
                ]
              : [])
          ]}
          onChange={(key, value) => {
            if (key === "location") {
              if (!value) return;
              const newParams = new URLSearchParams(searchParams);
              newParams.set("location", value);
              window.location.href = `${
                path.to.scheduleCrew
              }?${newParams.toString()}`;
            } else if (key === "department") {
              setDepartment(value ?? "all");
            } else if (key === "shift") {
              setShift(value ?? "all");
            }
          }}
        />
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="board">
              <Trans>Board</Trans>
            </TabsTrigger>
            <TabsTrigger value="matrix">
              <Trans>Matrix</Trans>
            </TabsTrigger>
            <TabsTrigger value="capacity">
              <Trans>Capacity</Trans>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "board" && (
          <Tabs value={range} onValueChange={setPeriod}>
            <TabsList>
              <TabsTrigger value="day">
                <Trans>Day</Trans>
              </TabsTrigger>
              <TabsTrigger value="week">
                <Trans>Week</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </HStack>

      <HStack className="flex-wrap gap-y-2">
        {range === "day" && permissions.can("update", "production") && (
          <Button
            variant="secondary"
            leftIcon={<LuCopy />}
            onClick={copyPreviousDay}
          >
            <Trans>Copy previous day</Trans>
          </Button>
        )}
        {range === "week" && permissions.can("update", "production") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                leftIcon={<LuCopy />}
                rightIcon={<LuChevronDown />}
              >
                <Trans>Copy week</Trans>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyPreviousWeek}>
                <Trans>From previous week</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyToNextWeek}>
                <Trans>To next week</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <HStack>
          <Button variant="secondary" onClick={goToToday}>
            <Trans>Today</Trans>
          </Button>
          <IconButton
            variant="secondary"
            onClick={() => navigateDate(-1)}
            icon={<LuChevronLeft />}
            aria-label={range === "day" ? t`Previous Day` : t`Previous Week`}
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
              className={range === "day" ? "w-auto p-4" : "w-64 p-2"}
            >
              {range === "day" ? (
                <Calendar
                  value={parsedDate}
                  onChange={(value) => {
                    if (!value) return;
                    setDateOpen(false);
                    setParam((params) => params.set("date", value.toString()));
                  }}
                />
              ) : (
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
              )}
            </PopoverContent>
          </Popover>
          <IconButton
            variant="secondary"
            onClick={() => navigateDate(1)}
            icon={<LuChevronRight />}
            aria-label={range === "day" ? t`Next Day` : t`Next Week`}
          />
          {permissions.can("update", "production") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  icon={<LuEllipsisVertical />}
                  aria-label={t`More options`}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onOpenOvertime}>
                  <DropdownMenuIcon icon={<LuTimer />} />
                  <Trans>Overtime</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenTimeOff}>
                  <DropdownMenuIcon icon={<LuUserX />} />
                  <Trans>Time off</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </HStack>
      </HStack>
    </HStack>
  );
}
