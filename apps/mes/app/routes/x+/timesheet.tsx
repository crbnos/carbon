// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  Button,
  cn,
  Input,
  Status,
  toast
} from "@carbon/react";
import {
  datetime,
  equals,
  formatDate,
  INPUT_FORMAT,
  TIMESHEET_ENTRY_STATUS_COLOR_MAP,
  timesheetWeek,
  weekStartOf
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
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
  const { weekStart, weekEnd, days } = timesheetWeek(timeZone, weekOffset);

  const [entries, chargeNumbers, laborCategories, employeeJob, approval] =
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
        .maybeSingle(),
      getTimesheetApprovalRequired(client, companyId)
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
    jobLocationId: employeeJob.data?.locationId ?? null,
    // The submit button says what submitting does, as in the ERP.
    approvalRequired: approval.data?.timesheetApprovalRequired ?? true,
    // DCAA mode keeps a date after today (company calendar) read-only,
    // except on a leave element, as the ERP grid and the server do.
    dcaaToday:
      approval.data?.timekeepingControls === "DCAA"
        ? datetime.today(timeZone).toString()
        : null
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
    jobLocationId,
    approvalRequired,
    dcaaToday
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
          isLeave: chargeNumber?.isLeave ?? false,
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
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            <Trans>My Time</Trans>
          </h1>
          <Button
            size="lg"
            variant="ghost"
            asChild
            aria-label={t`Previous week`}
          >
            <Link to={`${path.to.timesheet}?week=${weekOffset - 1}`}>
              <LuChevronLeft />
            </Link>
          </Button>
          <span className="whitespace-nowrap text-base tabular-nums">
            {formatDate(weekStart, { dateStyle: "medium" }, locale)} –{" "}
            {formatDate(weekEnd, { dateStyle: "medium" }, locale)}
          </span>
          <Button size="lg" variant="ghost" asChild aria-label={t`Next week`}>
            <Link to={`${path.to.timesheet}?week=${weekOffset + 1}`}>
              <LuChevronRight />
            </Link>
          </Button>
          {weekOffset !== 0 && (
            <Button size="lg" variant="ghost" asChild>
              <Link to={path.to.timesheet}>
                <Trans>This week</Trans>
              </Link>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
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
              {approvalRequired ? (
                <Trans>Submit week</Trans>
              ) : (
                <Trans>Post</Trans>
              )}
            </Button>
          </submitFetcher.Form>
        </div>
      </div>

      {gridRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <LuTimer className="size-8 text-muted-foreground" />
          <p className="text-base font-medium">
            <Trans>No time this week</Trans>
          </p>
          <p className="text-sm text-muted-foreground">
            <Trans>Add a row for each job or task you worked on.</Trans>
          </p>
        </div>
      ) : (
        // No flex-1: the border ends under the totals; a long week scrolls
        // inside it with the header and the totals sticky.
        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-card max-md:scroll-fade-x">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[220px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground max-md:w-[150px] max-md:min-w-[150px] max-md:max-w-[150px]">
                  <Trans>Charge Number</Trans>
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    className="min-w-[88px] border-b border-r border-border bg-card px-2 py-2 text-center font-medium"
                  >
                    {dayLabel(day)}
                  </th>
                ))}
                <th className="min-w-[88px] border-b border-border bg-card px-3 py-2 text-right font-medium">
                  <Trans>Total</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((row) => (
                <tr key={row.key}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 align-middle max-md:max-w-[150px] max-md:px-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2 text-base">
                        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {row.readableId}
                        </span>
                        <span className="truncate font-medium">{row.name}</span>
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {row.laborCategory}
                        {row.workLocation &&
                          row.workLocationId !== jobLocationId &&
                          ` · ${row.workLocation}`}
                        {row.rdActivityRole &&
                          ` · ${roleLabels[row.rdActivityRole]}`}
                      </span>
                    </div>
                  </td>
                  {days.map((day) => (
                    <td
                      key={day}
                      className="border-b border-r border-border p-0"
                    >
                      <DayCell
                        row={row}
                        day={day}
                        label={dayLabel(day)}
                        isFuture={
                          dcaaToday !== null && day > dcaaToday && !row.isLeave
                        }
                      />
                    </td>
                  ))}
                  <td className="border-b border-border px-3 text-right text-base font-semibold tabular-nums">
                    {formatHours(row.total, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr>
                <td className="sticky left-0 z-30 border-r border-border bg-muted px-3 py-3 font-medium">
                  <Trans>Total</Trans>
                </td>
                {days.map((day, index) => (
                  <td
                    key={day}
                    className="border-r border-border bg-muted px-2 py-3 text-center text-base font-semibold tabular-nums"
                  >
                    {formatHours(dayTotals[index] ?? 0, locale)}
                  </td>
                ))}
                <td className="bg-muted px-3 py-3 text-right text-base font-semibold tabular-nums">
                  {formatHours(weekTotal, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

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

/** Hours as typed: blank is 0; anything else must be a number. */
function parseHours(text: string) {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return 0;
  const hours = Number(trimmed);
  return Number.isFinite(hours) ? hours : null;
}

/**
 * One day of a row: a borderless touch cell that saves on blur and on
 * Enter, or the locked hours with their status. A refused save puts the
 * stored hours back. A future day in DCAA mode (`isFuture`) is read-only,
 * as in the ERP grid.
 */
function DayCell({
  row,
  day,
  label,
  isFuture
}: {
  row: TimesheetRow;
  day: string;
  label: string;
  isFuture: boolean;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const cell = row.cells[day];
  const serverHours = cell?.hours;
  const shownHours =
    serverHours === undefined ? "" : formatHours(serverHours, locale);
  // The user's typing; the stored hours show while it is null.
  const [draft, setDraft] = useState<string | null>(null);
  const fetcher = useAction<typeof action>({
    onSuccess: (data) => {
      setDraft(null);
      // A budget overrun never refuses the hours; it only warns.
      if (data.message) toast.warning(data.message);
    },
    onError: (data) => {
      toast.error(data.message ?? t`Failed to save the hours`);
      setDraft(null);
    }
  });

  const isLocked =
    cell !== undefined && cell.status !== "Draft" && cell.status !== "Rejected";

  if (isFuture && !isLocked) {
    return (
      <div className="flex h-full min-h-12 w-full items-center justify-center text-base tabular-nums text-muted-foreground">
        {shownHours}
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="flex h-full min-h-12 w-full items-center justify-center gap-1.5 bg-muted/40 text-base tabular-nums">
        <Status
          color={TIMESHEET_ENTRY_STATUS_COLOR_MAP[cell.status] ?? "gray"}
          iconOnly
        >
          {cell.status}
        </Status>
        {formatHours(cell.hours, locale)}
      </div>
    );
  }

  const commit = () => {
    if (draft === null) return;
    const hours = parseHours(draft);
    if (hours === null || hours < 0 || hours > 24) {
      toast.error(t`Enter hours from 0 to 24`);
      setDraft(null);
      return;
    }
    if (equals(hours, serverHours ?? 0)) {
      setDraft(null);
      return;
    }
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
    <input
      type="text"
      inputMode="decimal"
      // A text input is 20 characters wide by default, which widened its
      // column in the table's auto layout; the cell sets the width.
      size={1}
      aria-label={t`Hours on ${label}`}
      value={draft ?? shownHours}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "block h-full min-h-12 w-full min-w-[88px] bg-transparent text-center text-base tabular-nums outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring",
        cell?.status === "Rejected" && "text-red-500"
      )}
    />
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
