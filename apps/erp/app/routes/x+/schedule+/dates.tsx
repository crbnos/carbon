import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  ClientOnly,
  Combobox,
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
  Separator,
  Spinner,
  Switch,
  useLocalStorage,
  VStack
} from "@carbon/react";
import {
  endOfMonth,
  endOfWeek,
  getLocalTimeZone,
  now,
  parseDate,
  startOfMonth,
  startOfWeek,
  toCalendarDate
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuChevronLeft, LuChevronRight, LuSettings2 } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";
import { SearchFilter } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import { getJobsByDateRange, getUnscheduledJobs } from "~/modules/production";
import type { Column, JobItem } from "~/modules/production/ui/Schedule";
import type { DisplaySettings } from "~/modules/production/ui/Schedule/Kanban";
import { DateKanban } from "~/modules/production/ui/Schedule/Kanban/DateKanban";
import { ScheduleNavigation } from "~/modules/production/ui/Schedule/Kanban/ScheuleNavigation";
import { getLocationsList } from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import { getUserDefaults } from "~/modules/users/users.server";
import { usePeople } from "~/stores";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Schedule`,
  to: path.to.scheduleDates,
  module: "production"
};

type ViewType = "week" | "month";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter");
  const view = (searchParams.get("view") as ViewType) ?? "week";
  const dateParam = searchParams.get("date");

  const timezone = getLocalTimeZone();
  const currentDate = dateParam
    ? parseDate(dateParam)
    : toCalendarDate(now(timezone));

  let selectedSalesOrderIds: string[] = [];
  let selectedTags: string[] = [];
  let selectedAssignee: string[] = [];

  if (filterParam) {
    for (const filter of filterParam) {
      const [key, operator, value] = filter.split(":");
      if (key === "salesOrderId") {
        if (operator === "in") {
          selectedSalesOrderIds = value.split(",");
        } else if (operator === "eq") {
          selectedSalesOrderIds = [value];
        }
      } else if (key === "tag") {
        if (operator === "in") {
          selectedTags = value.split(",");
        } else if (operator === "eq") {
          selectedTags = [value];
        }
      } else if (key === "assignee") {
        if (operator === "in") {
          selectedAssignee = value.split(",");
        } else if (operator === "eq") {
          selectedAssignee = [value];
        }
      }
    }
  }

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  // Calculate date range based on view
  let startDate: string;
  let endDate: string;

  if (view === "week") {
    const weekStart = startOfWeek(currentDate, "en-GB"); // en-GB uses Monday as first day
    const weekEnd = endOfWeek(currentDate, "en-GB");
    startDate = weekStart.toString();
    endDate = weekEnd.toString();
  } else {
    // Month view - start from first of month, include full weeks (may extend into next month)
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    // Calculate the last week's end date
    let lastWeekStart = monthStart;
    while (lastWeekStart.compare(monthEnd) <= 0) {
      lastWeekStart = lastWeekStart.add({ weeks: 1 });
    }
    // Go back one week to get the last week that starts within the month
    lastWeekStart = lastWeekStart.add({ weeks: -1 });
    const lastWeekEnd = lastWeekStart.add({ days: 6 });

    startDate = monthStart.toString();
    endDate = lastWeekEnd.toString();
  }

  const [jobs, unscheduledJobs, tags] = await Promise.all([
    getJobsByDateRange(client, locationId ?? "", startDate, endDate),
    getUnscheduledJobs(client, locationId ?? ""),
    getTagsList(client, companyId, "job")
  ]);

  if (jobs.error) {
    console.error(jobs.error);
    throw redirect(
      path.to.scheduleOperation,
      await flash(request, error(jobs.error, "Failed to fetch jobs"))
    );
  }

  if (unscheduledJobs.error) {
    console.error(unscheduledJobs.error);
    throw redirect(
      path.to.scheduleOperation,
      await flash(
        request,
        error(unscheduledJobs.error, "Failed to fetch unscheduled jobs")
      )
    );
  }

  // Filter jobs
  let filteredJobs = jobs.data ?? [];
  let filteredUnscheduledJobs = unscheduledJobs.data ?? [];

  if (selectedSalesOrderIds.length) {
    filteredJobs = filteredJobs.filter((job) =>
      selectedSalesOrderIds.includes(job.salesOrderId)
    );
    filteredUnscheduledJobs = filteredUnscheduledJobs.filter((job) =>
      selectedSalesOrderIds.includes(job.salesOrderId)
    );
  }

  if (selectedTags.length) {
    filteredJobs = filteredJobs.filter((job) => {
      if (job.tags) {
        return selectedTags.some((tag) => job.tags.includes(tag));
      }
      return false;
    });
    filteredUnscheduledJobs = filteredUnscheduledJobs.filter((job) => {
      if (job.tags) {
        return selectedTags.some((tag) => job.tags.includes(tag));
      }
      return false;
    });
  }

  if (selectedAssignee.length) {
    filteredJobs = filteredJobs.filter((job) =>
      selectedAssignee.includes(job.assignee)
    );
    filteredUnscheduledJobs = filteredUnscheduledJobs.filter((job) =>
      selectedAssignee.includes(job.assignee)
    );
  }

  if (search) {
    filteredJobs = filteredJobs.filter(
      (job) =>
        job.jobId.toLowerCase().includes(search.toLowerCase()) ||
        job.itemReadableId?.toLowerCase().includes(search.toLowerCase()) ||
        job.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        job.itemDescription?.toLowerCase().includes(search.toLowerCase())
    );
    filteredUnscheduledJobs = filteredUnscheduledJobs.filter(
      (job) =>
        job.jobId.toLowerCase().includes(search.toLowerCase()) ||
        job.itemReadableId?.toLowerCase().includes(search.toLowerCase()) ||
        job.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        job.itemDescription?.toLowerCase().includes(search.toLowerCase())
    );
  }

  // Jobs are already sorted by due date and priority from the SQL function

  // Create columns based on view type
  let columns: Column[] = [];
  const todayDate = toCalendarDate(now(timezone));

  // Always add Unscheduled column first
  columns.push({
    id: "unscheduled",
    title: "Unscheduled",
    type: [],
    active: false
  });

  if (view === "week") {
    const weekStart = startOfWeek(currentDate, "en-GB"); // en-GB uses Monday as first day

    // Create 7 columns for days of the week (Mon-Sun) + 1 for "Next Week"
    for (let i = 0; i < 7; i++) {
      const day = weekStart.add({ days: i });
      const isToday = day.compare(todayDate) === 0;

      columns.push({
        id: day.toString(),
        title: day.toDate(timezone).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric"
        }),
        type: [],
        active: isToday
      });
    }

    // Add "Next Week" column
    columns.push({
      id: "next-week",
      title: "Next Week",
      type: [],
      active: false
    });
  } else {
    // Month view - create full 7-day week columns starting from the 1st of the month
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    // Start from the first day of the month
    let currentWeekStart = monthStart;

    // Continue while we're still in the month
    while (currentWeekStart.compare(monthEnd) <= 0) {
      // Each week is exactly 7 days
      const currentWeekEnd = currentWeekStart.add({ days: 6 });

      // Check if this week contains today
      const isTodayInWeek =
        todayDate.compare(currentWeekStart) >= 0 &&
        todayDate.compare(currentWeekEnd) <= 0;

      const weekStartDate = currentWeekStart.toDate(timezone);
      const weekEndDate = currentWeekEnd.toDate(timezone);

      columns.push({
        id: currentWeekStart.toString(),
        title: `${weekStartDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        })} - ${weekEndDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        })}`,
        type: [],
        active: isTodayInWeek
      });

      // Move to the next week (7 days later)
      currentWeekStart = currentWeekStart.add({ weeks: 1 });
    }

    // Add next month column with the month name
    const nextMonth = monthEnd.add({ days: 1 });
    const nextMonthName = nextMonth
      .toDate(timezone)
      .toLocaleDateString("en-US", {
        month: "long"
      });
    columns.push({
      id: "next-month",
      title: nextMonthName,
      type: [],
      active: false
    });
  }

  // Map scheduled jobs to items
  const scheduledItems = filteredJobs.map((job) => {
    // Determine which column this item belongs to
    let columnId = view === "week" ? "next-week" : "next-month";

    if (job.dueDate) {
      const dueDate = parseDate(job.dueDate.split("T")[0]);

      if (view === "week") {
        const weekStart = startOfWeek(currentDate, "en-GB"); // en-GB uses Monday as first day
        const weekEnd = endOfWeek(currentDate, "en-GB");

        if (dueDate.compare(weekStart) >= 0 && dueDate.compare(weekEnd) <= 0) {
          columnId = dueDate.toString();
        }
      } else {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);

        if (
          dueDate.compare(monthStart) >= 0 &&
          dueDate.compare(monthEnd) <= 0
        ) {
          // Find which week column this date belongs to
          // Weeks start on the 1st, 8th, 15th, 22nd, etc.
          let weekStart = monthStart;
          while (weekStart.compare(monthEnd) <= 0) {
            const weekEnd = weekStart.add({ days: 6 });
            if (
              dueDate.compare(weekStart) >= 0 &&
              dueDate.compare(weekEnd) <= 0
            ) {
              columnId = weekStart.toString();
              break;
            }
            weekStart = weekStart.add({ weeks: 1 });
          }
        }
      }
    }

    return {
      id: job.id,
      columnId,
      columnType: "", // Jobs don't have a specific process type
      priority: job.priority ?? 0,
      title: job.jobId,
      link: path.to.jobMethod(job.id, job.jobMakeMethodId),
      subtitle: job.itemReadableId ?? "",
      assignee: job.assignee,
      tags: job.tags,
      description: job.itemDescription,
      dueDate: job.dueDate,
      completedDate: job.completedDate,
      duration: 0, // Jobs don't have duration, only operations do
      jobId: job.id,
      jobMakeMethodId: job.jobMakeMethodId,
      jobReadableId: job.jobId,
      itemReadableId: job.itemReadableId ?? "",
      itemDescription: job.itemDescription,
      progress: job.completedOperationCount / Math.max(job.operationCount, 1),
      deadlineType: job.deadlineType,
      customerId: job.customerId,
      quantity: job.quantity,
      quantityCompleted: job.quantityComplete,
      quantityScrapped: 0,
      salesOrderReadableId: job.salesOrderReadableId,
      salesOrderId: job.salesOrderId,
      salesOrderLineId: job.salesOrderLineId,
      status: job.status,
      setupDuration: 0,
      laborDuration: 0,
      machineDuration: 0,
      thumbnailPath: job.thumbnailPath,
      hasConflict: job.hasConflict
    };
  });

  // Map unscheduled jobs to items
  const unscheduledItems = filteredUnscheduledJobs.map((job) => ({
    id: job.id,
    columnId: "unscheduled",
    columnType: "",
    priority: job.priority ?? 0,
    title: job.jobId,
    link: path.to.jobMethod(job.id, job.jobMakeMethodId),
    subtitle: job.itemReadableId ?? "",
    assignee: job.assignee,
    tags: job.tags,
    description: job.itemDescription,
    dueDate: job.dueDate,
    completedDate: job.completedDate,
    duration: 0,
    jobId: job.id,
    jobReadableId: job.jobId,
    jobMakeMethodId: job.jobMakeMethodId,
    itemReadableId: job.itemReadableId ?? "",
    itemDescription: job.itemDescription,
    progress: job.completedOperationCount / Math.max(job.operationCount, 1),
    deadlineType: job.deadlineType,
    customerId: job.customerId,
    quantity: job.quantity,
    quantityCompleted: job.quantityComplete,
    quantityScrapped: 0,
    salesOrderReadableId: job.salesOrderReadableId,
    salesOrderId: job.salesOrderId,
    salesOrderLineId: job.salesOrderLineId,
    status: job.status,
    setupDuration: 0,
    laborDuration: 0,
    machineDuration: 0,
    thumbnailPath: job.thumbnailPath,
    hasConflict: job.hasConflict
  }));

  // Combine all jobs for sales orders and tags
  const allJobs = [...filteredJobs, ...filteredUnscheduledJobs];

  return {
    columns,
    items: [...unscheduledItems, ...scheduledItems] satisfies JobItem[],
    salesOrders: Object.entries(
      allJobs.reduce(
        (acc, job) => {
          if (job.salesOrderId) {
            acc[job.salesOrderId] = job.salesOrderReadableId;
          }
          return acc;
        },
        {} as Record<string, string>
      )
    ).map(([id, readableId]) => ({ id, readableId })),
    availableTags: Object.entries(
      allJobs.reduce(
        (acc, job) => {
          if (job.tags) {
            // biome-ignore lint/suspicious/useIterableCallbackReturn: suppressed due to migration
            job.tags.forEach((tag: string) => (acc[tag] = true));
          }
          return acc;
        },
        {} as Record<string, boolean>
      )
    ).map(([tag]) => tag),
    tags: tags.data ?? [],
    locationId,
    view,
    currentDate: currentDate.toString()
  };
}

const defaultDisplaySettings: DisplaySettings = {
  showDuration: true,
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showEmployee: true,
  showProgress: true,
  showQuantity: true,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: true
};

const DISPLAY_SETTINGS_KEY = "kanban-schedule-dates-display-settings";

function DateKanbanSchedule() {
  const { t } = useLingui();
  const { locale } = useLocale();
  const {
    columns: loaderColumns,
    items: initialItems,
    salesOrders,
    availableTags,
    tags,
    locationId,
    view,
    currentDate
  } = useLoaderData<typeof loader>();

  const timezone = getLocalTimeZone();

  // Reformat column titles using user locale
  const columns = useMemo(() => {
    return loaderColumns.map((col) => {
      // Skip non-date columns
      if (["unscheduled", "next-week", "next-month"].includes(col.id)) {
        if (col.id === "next-month") {
          // Reformat the month name with locale
          const monthStart = startOfMonth(parseDate(currentDate));
          const nextMonth = endOfMonth(monthStart).add({ days: 1 });
          return {
            ...col,
            title: nextMonth
              .toDate(timezone)
              .toLocaleDateString(locale, { month: "long" })
          };
        }
        return col;
      }

      // Try to parse the column ID as a date
      try {
        const date = parseDate(col.id);
        if (view === "week") {
          return {
            ...col,
            title: date.toDate(timezone).toLocaleDateString(locale, {
              weekday: "short",
              month: "short",
              day: "numeric"
            })
          };
        } else {
          // Month view - columns represent week ranges
          const weekEnd = date.add({ days: 6 });
          return {
            ...col,
            title: `${date.toDate(timezone).toLocaleDateString(locale, {
              month: "short",
              day: "numeric"
            })} - ${weekEnd.toDate(timezone).toLocaleDateString(locale, {
              month: "short",
              day: "numeric"
            })}`
          };
        }
      } catch {
        return col;
      }
    });
  }, [loaderColumns, locale, view, currentDate, timezone]);

  const locations = useLocations();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [items, setItems] = useState<JobItem[]>(initialItems);
  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const sortItems = useCallback((items: JobItem[]) => {
    return [...items].sort((a, b) => a.priority - b.priority);
  }, []);

  useEffect(() => {
    setItems((prevItems) => sortItems(prevItems));
  }, [sortItems]);

  const [people] = usePeople();
  const [params] = useUrlParams();

  const currentFilters = params.getAll("filter").filter(Boolean);

  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "salesOrderId",
        header: "Sales Order",
        filter: {
          type: "static",
          options: salesOrders.map((so) => ({
            label: so.readableId,
            value: so.id
          }))
        }
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        filter: {
          type: "static",
          options: people.map((p) => ({
            label: p.name,
            value: p.id
          }))
        }
      },
      {
        accessorKey: "tag",
        header: "Tag",
        filter: {
          type: "static",
          options: availableTags.map((tag) => ({
            label: tag,
            value: tag
          }))
        }
      }
    ];
  }, [salesOrders, people, availableTags]);

  const parsedDate = parseDate(currentDate);
  const todayDate = toCalendarDate(now(timezone));

  const getDateSpanLabel = useCallback(
    (date: typeof parsedDate, viewType: ViewType) => {
      const tz = getLocalTimeZone();
      if (viewType === "week") {
        const weekStart = startOfWeek(date, "en-GB");
        const weekEnd = endOfWeek(date, "en-GB");
        return `${weekStart.toDate(tz).toLocaleDateString(locale, {
          month: "short",
          day: "numeric"
        })} - ${weekEnd.toDate(tz).toLocaleDateString(locale, {
          month: "short",
          day: "numeric"
        })}`;
      } else {
        return date.toDate(tz).toLocaleDateString(locale, {
          month: "short",
          year: "numeric"
        });
      }
    },
    [locale]
  );

  const getSpanStartDate = useCallback(
    (date: typeof parsedDate, viewType: ViewType) => {
      if (viewType === "week") {
        return startOfWeek(date, "en-GB");
      } else {
        return startOfMonth(date);
      }
    },
    []
  );

  const currentDateSpanLabel = useMemo(
    () => getDateSpanLabel(parsedDate, view),
    [parsedDate, view, getDateSpanLabel]
  );

  const dateSpanOptions = useMemo(() => {
    const spans: { date: string; label: string }[] = [];
    const todaySpanStart = getSpanStartDate(todayDate, view);

    // Add up to 4 previous spans (only if they are not in the past)
    for (let i = 4; i >= 1; i--) {
      const prevDate =
        view === "week"
          ? parsedDate.add({ weeks: -i })
          : parsedDate.add({ months: -i });
      const prevSpanStart = getSpanStartDate(prevDate, view);

      // Only add if the span start is not before today's span start
      if (prevSpanStart.compare(todaySpanStart) >= 0) {
        spans.push({
          date: prevDate.toString(),
          label: getDateSpanLabel(prevDate, view)
        });
      }
    }

    // Add current span
    spans.push({
      date: parsedDate.toString(),
      label: currentDateSpanLabel
    });

    // Add next 4 spans
    for (let i = 1; i <= 4; i++) {
      const nextDate =
        view === "week"
          ? parsedDate.add({ weeks: i })
          : parsedDate.add({ months: i });
      spans.push({
        date: nextDate.toString(),
        label: getDateSpanLabel(nextDate, view)
      });
    }

    return spans;
  }, [
    parsedDate,
    view,
    todayDate,
    getDateSpanLabel,
    getSpanStartDate,
    currentDateSpanLabel
  ]);

  const navigateToDate = (dateStr: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("date", dateStr);
    navigate(`?${newParams.toString()}`);
  };

  const navigateDate = (direction: "prev" | "next") => {
    const newDate =
      view === "week"
        ? parsedDate.add({ weeks: direction === "next" ? 1 : -1 })
        : parsedDate.add({ months: direction === "next" ? 1 : -1 });

    const newParams = new URLSearchParams(searchParams);
    newParams.set("date", newDate.toString());
    navigate(`?${newParams.toString()}`);
  };

  const goToToday = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("date"); // Removing date param will default to today
    navigate(`?${newParams.toString()}`);
  };

  return (
    <div className="flex flex-col h-full max-h-full overflow-auto relative">
      <HStack className="px-4 py-2 flex justify-between bg-card border-b border-border">
        <HStack>
          <ScheduleNavigation />
          <SearchFilter param="search" size="sm" placeholder="Search" />
          <Filter filters={filters} />
        </HStack>

        <HStack>
          <HStack>
            <Button variant="secondary" onClick={goToToday}>
              <Trans>Today</Trans>
            </Button>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate("prev")}
              icon={<LuChevronLeft />}
              aria-label={t`Previous Date`}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className="min-w-[140px]">
                  {currentDateSpanLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={parsedDate.toString()}
                  onValueChange={navigateToDate}
                >
                  {dateSpanOptions.map((span) => (
                    <DropdownMenuRadioItem key={span.date} value={span.date}>
                      {span.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              variant="secondary"
              onClick={() => navigateDate("next")}
              icon={<LuChevronRight />}
              aria-label={t`Next Date`}
            />
          </HStack>

          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Settings`}
                icon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border"
              />
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <VStack spacing={3}>
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Location</Trans>
                </span>
                <div className="w-full">
                  <Combobox
                    asButton
                    size="sm"
                    value={locationId ?? undefined}
                    options={locations}
                    onChange={(selected) => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("location", selected);
                      window.location.href = `${
                        path.to.scheduleDates
                      }?${newParams.toString()}`;
                    }}
                  />
                </div>
                <Separator />
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Display Settings</Trans>
                </span>
                <VStack>
                  {[
                    { key: "showCustomer", label: t`Customer` },
                    { key: "showDueDate", label: t`Due Date` },
                    { key: "showDuration", label: t`Duration` },
                    { key: "showProgress", label: t`Progress` },
                    { key: "showQuantity", label: t`Quantity` },
                    { key: "showStatus", label: t`Status` },
                    { key: "showSalesOrder", label: t`Sales Order` },
                    { key: "showThumbnail", label: t`Thumbnail` }
                  ].map(({ key, label }) => (
                    <Switch
                      key={key}
                      variant="small"
                      label={label}
                      checked={
                        displaySettings[key as keyof typeof displaySettings]
                      }
                      onCheckedChange={(checked) =>
                        setDisplaySettings((prev) => ({
                          ...prev,
                          [key]: checked
                        }))
                      }
                    />
                  ))}
                </VStack>
              </VStack>
            </PopoverContent>
          </Popover>
        </HStack>
      </HStack>
      {currentFilters.length > 0 && (
        <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
          <HStack>
            <ActiveFilters filters={filters} />
          </HStack>
        </HStack>
      )}
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-1 min-h-0 w-full relative">
          <DateKanban
            columns={columns}
            items={items}
            progressByItemId={{}}
            tags={tags}
            showCustomer={displaySettings.showCustomer}
            showDescription={displaySettings.showDescription}
            showDueDate={displaySettings.showDueDate}
            showDuration={displaySettings.showDuration}
            showEmployee={displaySettings.showEmployee}
            showProgress={displaySettings.showProgress}
            showQuantity={displaySettings.showQuantity}
            showStatus={displaySettings.showStatus}
            showSalesOrder={displaySettings.showSalesOrder}
            showThumbnail={displaySettings.showThumbnail}
          />
        </div>
      </div>
    </div>
  );
}

export default function ScheduleRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      {() => <DateKanbanSchedule />}
    </ClientOnly>
  );
}
