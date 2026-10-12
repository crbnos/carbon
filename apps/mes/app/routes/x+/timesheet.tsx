// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Badge,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Input,
  NumberField,
  NumberInput,
  Status,
  toast
} from "@carbon/react";
import {
  datetime,
  formatDate,
  INPUT_FORMAT,
  INPUT_STEP,
  TIMESHEET_ENTRY_STATUS_COLOR_MAP,
  weekStartOf
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useRef, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPlus,
  LuSearch,
  LuSend,
  LuTimer
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { timesheetCellValidator } from "~/services/models";
import { timesheetBudgetWarning } from "~/services/project-budget.server";
import type {
  ChargeNumber,
  RdActivityRole,
  TimesheetRow
} from "~/services/projects.service";
import {
  getChargeNumbers,
  getLaborCategoriesList,
  getTimesheetApprovalRequired,
  getTimesheetWeek,
  groupTimesheetRows,
  postTimesheetEntries,
  saveTimesheetEntry,
  submitTimesheetWeek,
  timesheetRowKey
} from "~/services/projects.service";
import { path } from "~/utils/path";

const logger = getLogger("mes", "timesheet");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get("week") ?? "0", 10);
  const weekOffset = Number.isFinite(parsed) ? parsed : 0;

  // The week runs Monday to Sunday on the company calendar, as My Hours does.
  const timeZone = await getCompanyTimeZone(client, companyId);
  const { from, to } = datetime.weekBounds(timeZone, weekOffset);
  const weekStart = datetime.businessDay(from, timeZone).toString();
  const weekEnd = datetime.businessDay(to, timeZone).toString();
  const monday = parseDate(weekStart);
  const days = Array.from({ length: 7 }, (_, index) =>
    monday.add({ days: index }).toString()
  );

  const [entries, chargeNumbers, laborCategories, employeeJob] =
    await Promise.all([
      getTimesheetWeek(client, {
        companyId,
        employeeId: userId,
        from: weekStart,
        to: weekEnd
      }),
      getChargeNumbers(client, companyId),
      getLaborCategoriesList(client, companyId),
      client
        .from("employeeJob")
        .select("laborCategoryId, locationId")
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);

  if (entries.error) {
    logger.error("Failed to load the timesheet", {
      companyId,
      error: entries.error
    });
  }
  if (chargeNumbers.error) {
    logger.error("Failed to load charge numbers", {
      companyId,
      error: chargeNumbers.error
    });
  }
  if (laborCategories.error) {
    logger.error("Failed to load labor categories", {
      companyId,
      error: laborCategories.error
    });
  }

  return {
    weekOffset,
    weekStart,
    weekEnd,
    days,
    rows: groupTimesheetRows(entries.data ?? []),
    chargeNumbers: chargeNumbers.data ?? [],
    laborCategories: laborCategories.data ?? [],
    defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null,
    jobLocationId: employeeJob.data?.locationId ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "cell") {
    const validation = await validator(timesheetCellValidator).validate(
      formData
    );
    if (validation.error) {
      return {
        success: false,
        message:
          Object.values(validation.error.fieldErrors)[0] ??
          "The hours are invalid"
      };
    }
    const result = await saveTimesheetEntry(getDatabaseClient(), {
      ...validation.data,
      companyId,
      employeeId: userId,
      userId
    });
    if (result.error) {
      logger.error("Failed to save a timesheet cell", {
        companyId,
        error: result.error
      });
      return {
        success: false,
        message: result.error.message || "Failed to save the hours"
      };
    }
    // Budget control (Government Contracting 5c): a timesheet only warns.
    // The cell toasts the warning; the entry is already saved.
    const warning = await timesheetBudgetWarning(getDatabaseClient(), client, {
      ...validation.data,
      companyId
    });
    return { success: true, message: warning };
  }

  if (intent === "submit") {
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "");
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
      return { success: false, message: "No week was given" };
    }

    const db = getDatabaseClient();
    const submitted = await submitTimesheetWeek(db, {
      companyId,
      employeeId: userId,
      weekStart: weekStartOf(from),
      userId
    });
    if (submitted.error || !submitted.data) {
      logger.error("Failed to submit the timesheet", {
        companyId,
        error: submitted.error
      });
      return {
        success: false,
        message: submitted.error?.message || "Failed to submit the week"
      };
    }
    const ids = submitted.data.entryIds;
    // A warning (the DCAA timecard check) does not stop the week.
    const withWarnings = (message: string) =>
      submitted.data.warnings.length > 0
        ? `${message}. ${submitted.data.warnings.join(". ")}`
        : message;
    if (ids.length === 0) {
      return {
        success: false,
        message: "This week has no draft hours to submit"
      };
    }

    const settings = await getTimesheetApprovalRequired(client, companyId);
    if (settings.error) {
      logger.error("Failed to load company settings", {
        companyId,
        error: settings.error
      });
    }
    // With the setting unreadable, nothing posts: the time waits for approval.
    if (settings.data?.timesheetApprovalRequired ?? true) {
      return {
        success: true,
        message: withWarnings("Week submitted for approval")
      };
    }

    const posting = await postTimesheetEntries(db, {
      timesheetEntryIds: ids,
      companyId,
      userId
    });
    if (posting.error) {
      logger.error("Failed to post timesheet entries", {
        companyId,
        error: posting.error
      });
      return {
        success: false,
        message: `The week is submitted but did not post: ${
          posting.error.message || "the posting failed"
        }`
      };
    }
    return {
      success: true,
      message: withWarnings("Week submitted and posted")
    };
  }

  return { success: false, message: "Unknown action" };
}

type LocalRow = {
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
};

export default function MESTimesheetPage() {
  const {
    weekOffset,
    weekStart,
    weekEnd,
    days,
    rows,
    chargeNumbers,
    laborCategories,
    defaultLaborCategoryId,
    jobLocationId
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const roleLabels = useMemo<Record<RdActivityRole, string>>(
    () => ({
      "Direct Research": t`Direct Research`,
      "Direct Supervision": t`Direct Supervision`,
      "Direct Support": t`Direct Support`,
      "Not Qualified": t`Not Qualified`
    }),
    [t]
  );
  const { locale } = useLocale();
  const submitFetcher = useAction<typeof action>({
    onSuccess: (data) => {
      if (data.message) toast.success(data.message);
    },
    onError: (data) => toast.error(data.message ?? t`Failed to submit the week`)
  });
  const [addingRow, setAddingRow] = useState(false);
  const [addedRows, setAddedRows] = useState<LocalRow[]>([]);

  const gridRows = useMemo<TimesheetRow[]>(() => {
    const keys = new Set(rows.map((row) => row.key));
    const localRows = addedRows
      .map((row) => ({ ...row, key: timesheetRowKey(row) }))
      .filter((row) => !keys.has(row.key))
      .map((row) => {
        const chargeNumber = chargeNumbers.find(
          (option) =>
            option.projectId === row.projectId &&
            (option.projectElementId ?? null) === row.projectElementId
        );
        return {
          ...row,
          readableId: chargeNumber?.readableId ?? "",
          name: chargeNumber?.name ?? "",
          laborCategory:
            laborCategories.find((c) => c.id === row.laborCategoryId)?.name ??
            "",
          // A new row is at the job location, so its name is not shown.
          workLocation: "",
          cells: {},
          total: 0
        };
      });
    return [...rows, ...localRows];
  }, [rows, addedRows, chargeNumbers, laborCategories]);

  const dayTotals = days.map((day) =>
    gridRows.reduce((sum, row) => sum + (row.cells[day]?.hours ?? 0), 0)
  );
  const hasDraft = gridRows.some((row) =>
    Object.values(row.cells).some((cell) => cell.status === "Draft")
  );
  const isSubmitting = submitFetcher.state !== "idle";

  const dayLabel = (day: string) =>
    formatDate(day, { weekday: "short", day: "numeric" }, locale);

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-[60rem] mx-auto w-full flex flex-col gap-4">
        <Card className="overflow-hidden">
          <CardHeader>
            <HStack className="justify-between items-center flex-wrap gap-2">
              <CardTitle>
                <Trans>My Time</Trans>
              </CardTitle>
              <HStack className="gap-2">
                <Button
                  size="lg"
                  variant="secondary"
                  leftIcon={<LuPlus />}
                  onClick={() => setAddingRow(true)}
                >
                  <Trans>Add row</Trans>
                </Button>
                <submitFetcher.Form method="post">
                  <input type="hidden" name="intent" value="submit" />
                  <input type="hidden" name="from" value={weekStart} />
                  <input type="hidden" name="to" value={weekEnd} />
                  <Button
                    size="lg"
                    type="submit"
                    leftIcon={<LuSend />}
                    isDisabled={!hasDraft || isSubmitting}
                    isLoading={isSubmitting}
                  >
                    <Trans>Submit week</Trans>
                  </Button>
                </submitFetcher.Form>
              </HStack>
            </HStack>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <Button
                size="lg"
                variant="outline"
                asChild
                leftIcon={<LuChevronLeft />}
              >
                <Link to={`${path.to.timesheet}?week=${weekOffset - 1}`}>
                  <Trans>Prev</Trans>
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatDate(weekStart, { dateStyle: "medium" }, locale)} —{" "}
                {formatDate(weekEnd, { dateStyle: "medium" }, locale)}
              </span>
              <Button
                size="lg"
                variant="outline"
                asChild
                rightIcon={<LuChevronRight />}
              >
                <Link to={`${path.to.timesheet}?week=${weekOffset + 1}`}>
                  <Trans>Next</Trans>
                </Link>
              </Button>
            </HStack>
          </CardContent>
        </Card>

        {gridRows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <LuTimer className="size-8 text-muted-foreground" />
              <p className="text-base text-muted-foreground">
                <Trans>
                  No time this week. Add a row for each job or task you worked
                  on.
                </Trans>
              </p>
              <Button
                size="lg"
                leftIcon={<LuPlus />}
                onClick={() => setAddingRow(true)}
              >
                <Trans>Add row</Trans>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {gridRows.map((row) => (
              <Card key={row.key}>
                <CardContent className="flex flex-col gap-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2 text-base">
                        <span className="shrink-0 whitespace-nowrap font-mono text-sm text-muted-foreground">
                          {row.readableId}
                        </span>
                        <span className="truncate font-medium">{row.name}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                        <span className="truncate">
                          {row.laborCategory}
                          {row.workLocation &&
                            row.workLocationId !== jobLocationId &&
                            ` · ${row.workLocation}`}
                        </span>
                        {row.rdActivityRole && (
                          <Badge variant="secondary" className="shrink-0">
                            {roleLabels[row.rdActivityRole]}
                          </Badge>
                        )}
                      </span>
                    </div>
                    <span className="shrink-0 text-lg font-semibold tabular-nums">
                      {formatHours(row.total, locale)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {days.map((day) => (
                      <DayCell
                        key={day}
                        row={row}
                        day={day}
                        label={dayLabel(day)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardContent className="grid grid-cols-4 gap-2 pt-4 sm:grid-cols-7">
                {days.map((day, index) => (
                  <div key={day} className="flex flex-col items-center">
                    <span className="text-xs text-muted-foreground">
                      {dayLabel(day)}
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {formatHours(dayTotals[index] ?? 0, locale)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {addingRow && (
        <AddRowSheet
          chargeNumbers={chargeNumbers}
          laborCategories={laborCategories}
          defaultLaborCategoryId={defaultLaborCategoryId}
          jobLocationId={jobLocationId}
          onAdd={(row) => {
            setAddedRows((previous) => [...previous, row]);
            setAddingRow(false);
          }}
          onClose={() => setAddingRow(false)}
        />
      )}
    </div>
  );
}

function formatHours(hours: number, locale: string) {
  return new Intl.NumberFormat(locale, INPUT_FORMAT.quantity).format(hours);
}

/** One day of a row: a large input, or the locked hours with their status. */
function DayCell({
  row,
  day,
  label
}: {
  row: TimesheetRow;
  day: string;
  label: string;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const cell = row.cells[day];
  const serverHours = cell?.hours;
  const latest = useRef<number | undefined>(serverHours);
  // A refused save remounts the input with the stored hours.
  const [resets, setResets] = useState(0);
  const fetcher = useAction<typeof action>({
    onSuccess: (data) => {
      // A budget overrun never refuses the hours; it only warns.
      if (data.message) toast.warning(data.message);
    },
    onError: (data) => {
      toast.error(data.message ?? t`Failed to save the hours`);
      latest.current = serverHours;
      setResets((count) => count + 1);
    }
  });

  const isLocked =
    cell !== undefined && cell.status !== "Draft" && cell.status !== "Rejected";

  if (isLocked) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 tabular-nums">
          <Status
            color={TIMESHEET_ENTRY_STATUS_COLOR_MAP[cell.status] ?? "gray"}
            iconOnly
          >
            {cell.status}
          </Status>
          {formatHours(cell.hours, locale)}
        </div>
      </div>
    );
  }

  const commit = () => {
    const next = latest.current;
    const hours = next === undefined || !Number.isFinite(next) ? 0 : next;
    if (hours === (serverHours ?? 0)) return;
    fetcher.submit(
      {
        intent: "cell",
        entryDate: day,
        projectId: row.projectId,
        projectElementId: row.projectElementId ?? "",
        laborCategoryId: row.laborCategoryId,
        // The row's own location and role, so the save edits the row's
        // entry. "" is none.
        workLocationId: row.workLocationId ?? "",
        rdActivityRole: row.rdActivityRole ?? "",
        hours: String(hours)
      },
      { method: "post" }
    );
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={cn(
          "text-xs text-muted-foreground",
          cell?.status === "Rejected" && "text-red-500"
        )}
      >
        {label}
      </span>
      <NumberField
        key={`${serverHours ?? ""}:${resets}`}
        aria-label={t`Hours on ${label}`}
        defaultValue={serverHours}
        minValue={0}
        maxValue={24}
        step={INPUT_STEP.quantity}
        formatOptions={INPUT_FORMAT.quantity}
        onChange={(value) => {
          latest.current = Number.isNaN(value) ? undefined : value;
        }}
      >
        <NumberInput
          size="lg"
          className="text-center text-lg tabular-nums"
          inputMode="decimal"
          onBlur={commit}
        />
      </NumberField>
    </div>
  );
}

function AddRowSheet({
  chargeNumbers,
  laborCategories,
  defaultLaborCategoryId,
  jobLocationId,
  onAdd,
  onClose
}: {
  chargeNumbers: ChargeNumber[];
  laborCategories: {
    id: string;
    name: string;
    rdActivityRole: RdActivityRole | null;
  }[];
  defaultLaborCategoryId: string | null;
  jobLocationId: string | null;
  onAdd: (row: LocalRow) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ChargeNumber | null>(null);
  // Only the user's pick is state; the fallback follows the current categories.
  const [pickedCategoryId, setLaborCategoryId] = useState<string | null>(null);
  const isCategory = (id: string | null) =>
    !!id && laborCategories.some((c) => c.id === id);
  const laborCategoryId = isCategory(pickedCategoryId)
    ? pickedCategoryId
    : isCategory(defaultLaborCategoryId)
      ? defaultLaborCategoryId
      : (laborCategories[0]?.id ?? null);

  const term = search.trim().toLowerCase();
  const matches = term
    ? chargeNumbers.filter((row) =>
        [row.readableId, row.name, row.projectName]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
    : chargeNumbers;

  return (
    <BottomSheet open onOpenChange={(open) => !open && onClose()}>
      <BottomSheetContent className="mx-auto max-w-xl">
        <BottomSheetHeader>
          <BottomSheetTitle>
            <Trans>Add row</Trans>
          </BottomSheetTitle>
          <BottomSheetDescription>
            <Trans>Pick what you worked on, then the labor category.</Trans>
          </BottomSheetDescription>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className="flex flex-col gap-4 pb-2">
            <div className="relative">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                size="lg"
                className="pl-9"
                placeholder={t`Search projects and tasks`}
                aria-label={t`Search projects and tasks`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  <Trans>Nothing matches your search.</Trans>
                </p>
              ) : (
                matches.map((row) => (
                  <button
                    key={row.value}
                    type="button"
                    onClick={() => setSelected(row)}
                    className={cn(
                      "flex min-h-12 w-full flex-col items-start rounded-lg border border-border px-4 py-2 text-left",
                      selected?.value === row.value
                        ? "border-primary bg-primary/10"
                        : "hover:bg-accent"
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap font-mono text-sm text-muted-foreground">
                        {row.readableId}
                      </span>
                      <span className="truncate font-medium">{row.name}</span>
                    </span>
                    {row.projectElementId && (
                      <span className="w-full truncate text-xs text-muted-foreground">
                        {row.projectName}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                <Trans>Labor category</Trans>
              </span>
              <div className="flex flex-wrap gap-2">
                {laborCategories.map((category) => (
                  <Button
                    key={category.id}
                    size="lg"
                    variant={
                      laborCategoryId === category.id ? "primary" : "secondary"
                    }
                    onClick={() => setLaborCategoryId(category.id)}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              size="lg"
              isDisabled={!selected || !laborCategoryId}
              onClick={() => {
                if (!selected || !laborCategoryId) return;
                // The defaults of save-timesheet-entry: the job location and
                // the category's role.
                onAdd({
                  projectId: selected.projectId,
                  projectElementId: selected.projectElementId,
                  laborCategoryId,
                  workLocationId: jobLocationId,
                  rdActivityRole:
                    laborCategories.find((c) => c.id === laborCategoryId)
                      ?.rdActivityRole ?? null
                });
              }}
            >
              <Trans>Add</Trans>
            </Button>
          </div>
        </BottomSheetBody>
      </BottomSheetContent>
    </BottomSheet>
  );
}
