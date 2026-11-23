// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Combobox,
  cn,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCalendarDays, LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router";
import { useLocations } from "~/components/Form/Location";
import type { WeekOption } from "~/modules/production/ui/Schedule/People/PeopleHeader";
import { path } from "~/utils/path";

type ServiceScheduleHeaderProps = {
  date: string;
  dateLabel: string;
  weekOptions: WeekOption[];
  locationId: string;
  departmentId: string | null;
  departments: { value: string; label: string }[];
};

/**
 * The dispatch grid's header row, copied from the People board's: the
 * location and department filters, and week navigation with the week-list
 * popover.
 */
export function ServiceScheduleHeader({
  date,
  dateLabel,
  weekOptions,
  locationId,
  departmentId,
  departments
}: ServiceScheduleHeaderProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const locations = useLocations();

  const [dateOpen, setDateOpen] = useState(false);
  const parsedDate = parseDate(date);

  const setParam = (mutate: (params: URLSearchParams) => void) => {
    const newParams = new URLSearchParams(searchParams);
    mutate(newParams);
    navigate(`?${newParams.toString()}`);
  };

  const goToToday = () => setParam((params) => params.delete("date"));

  const setDepartment = (value: string) => {
    const next = value === "all" ? "" : value;
    document.cookie = `serviceScheduleDepartment=${encodeURIComponent(
      next
    )}; path=/; max-age=31536000; samesite=lax`;
    setParam((params) => {
      if (next) params.set("department", next);
      else params.delete("department");
    });
  };

  const navigateWeek = (direction: number) =>
    setParam((params) => {
      params.set("date", parsedDate.add({ days: direction * 7 }).toString());
    });

  return (
    <HStack className="pl-2 pr-4 py-2 flex flex-wrap gap-y-2 justify-between bg-card border-b border-border max-md:pl-4">
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
            window.location.href = `${path.to.serviceSchedule}?${newParams.toString()}`;
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
      </HStack>

      <HStack>
        <Button variant="secondary" onClick={goToToday}>
          <Trans>Today</Trans>
        </Button>
        <IconButton
          variant="secondary"
          onClick={() => navigateWeek(-1)}
          icon={<LuChevronLeft />}
          aria-label={t`Previous Week`}
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
          <PopoverContent className="w-64 p-2">
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
          </PopoverContent>
        </Popover>
        <IconButton
          variant="secondary"
          onClick={() => navigateWeek(1)}
          icon={<LuChevronRight />}
          aria-label={t`Next Week`}
        />
      </HStack>
    </HStack>
  );
}
