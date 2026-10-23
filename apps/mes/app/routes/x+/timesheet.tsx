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
import { WeekHoursChart, weekHoursTones } from "@carbon/react/WeekHours";
import {
  certificationTextFor,
  equals,
  formatDate,
  INPUT_FORMAT,
  TIMESHEET_ENTRY_STATUS_COLOR_MAP,
  timesheetCellReasons,
  timesheetWeek,
  weekStartOf
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPlus,
  LuSearch,
  LuSend,
  LuTreePalm
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  TimesheetReasonModal,
  type TimesheetReasons
} from "~/components/Timesheet/TimesheetReasonModal";
import { WeekCertificationModal } from "~/components/Timesheet/WeekCertificationModal";
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
  getTimesheetSettings,
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
  const { weekStart, weekEnd, days, today } = timesheetWeek(
    timeZone,
    weekOffset
  );

  const [entries, chargeNumbers, laborCategories, employeeJob, settings] =
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
        .select("laborCategoryId, locationId, flsaStatus")
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle(),
      getTimesheetSettings(client, companyId)
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
  if (settings.error) {
    logger.error("Failed to load the timesheet settings", {
      companyId,
      error: settings.error
    });
  }

  return {
    weekOffset,
    weekStart,
    weekEnd,
    days,
    today,
    rows: groupTimesheetRows(entries.data ?? []),
    chargeNumbers: chargeNumbers.data ?? [],
    laborCategories: laborCategories.data ?? [],
    defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null,
    jobLocationId: employeeJob.data?.locationId ?? null,
    // DCAA mode (5a), as the ERP's My Time: today on the company calendar
    // (a later date is read-only, except on a leave element), the entry
    // window (an older date needs a late reason) and the certification text
    // for the employee's FLSA status. Null in Standard mode.
    controls:
      settings.data?.timekeepingControls === "DCAA"
        ? {
            today,
            windowDays: settings.data.timesheetEntryWindowDays ?? 0,
            certificationText: certificationTextFor(
              employeeJob.data?.flsaStatus,
              settings.data
            )
          }
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
    const result = await saveTimesheetEntry({
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

    // DCAA mode: the text the employee certified; the server refuses a
    // week without it, or with a text that is no longer the current one.
    const certificationText = formData.get("certificationText");

    const submitted = await submitTimesheetWeek({
      companyId,
      employeeId: userId,
      weekStart: weekStartOf(from),
      certificationText:
        typeof certificationText === "string" && certificationText
          ? certificationText
          : undefined,
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

    const settings = await getTimesheetSettings(client, companyId);
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

    const posting = await postTimesheetEntries({
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

/** A cell value that waits for its reasons before it saves (DCAA mode). */
type PendingChange = {
  label: string;
  fields: Record<string, string>;
  hours: number;
  previousHours: number | null;
  requiresReason: boolean;
  requiresLateReason: boolean;
  /** Drops the bar's unsaved hours, so it shows the stored ones. */
  settle: () => void;
};

type LocalRow = {
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
};

const cellKey = (rowKey: string, day: string) => `${rowKey}|${day}`;

/**
 * My Time on the shop floor, as the ERP's: the week's charge numbers as
 * cards on the left, and a week of bars on the right (`WeekHoursChart`,
 * shared with the ERP). Tap a card, then tap a day below its bars to give
 * it time up to that point; drag a bar's lower edge to change its hours, or
 * tap × to delete it. Every change saves at once (the `cell` intent, the
 * `save-timesheet-entry` server function). **PTO** adds a leave element.
 *
 * DCAA mode (`controls`): a future day is read-only except on a leave
 * element, a change to a saved entry or a date before the entry window asks
 * for its reasons first (`TimesheetReasonModal`), and **Submit week**
 * certifies the week (`WeekCertificationModal`). An entry another user
 * changed (Pending Employee Review) is locked here, as before.
 */
export default function MESTimesheetPage() {
  const {
    weekOffset,
    weekStart,
    weekEnd,
    days,
    today,
    rows,
    chargeNumbers,
    laborCategories,
    defaultLaborCategoryId,
    jobLocationId,
    controls
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = (hours: number) => formatHours(hours, locale);
  const [certifying, setCertifying] = useState(false);
  const submitFetcher = useAction<typeof action>({
    // The certification modal closes whatever the outcome, as in the ERP.
    onSettled: () => setCertifying(false),
    onSuccess: (data) => {
      if (data.message) toast.success(data.message);
    },
    onError: (data) => toast.error(data.message ?? t`Failed to submit the week`)
  });
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(
    null
  );
  const reasonFetcher = useAction<typeof action>({
    onSuccess: (data) => {
      // A budget overrun never refuses the hours; it only warns.
      if (data.message) toast.warning(data.message);
      setPendingChange(null);
    },
    // A refusal keeps the modal open, so the reason can be fixed.
    onError: (data) => toast.error(data.message ?? t`Failed to save the hours`)
  });
  // The hours the user just set, shown until the saved value comes back.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const forgetOverride = (key: string) =>
    setOverrides((previous) => {
      const { [key]: _gone, ...rest } = previous;
      return rest;
    });
  // The cell a save is on its way for: a refusal puts that bar back.
  const savingKey = useRef<string | null>(null);
  const cellFetcher = useAction<typeof action>({
    onSuccess: (data) => {
      if (data.message) toast.warning(data.message);
    },
    onError: (data) => {
      toast.error(data.message ?? t`Failed to save the hours`);
      if (savingKey.current) forgetOverride(savingKey.current);
    }
  });
  const [adding, setAdding] = useState<"row" | "pto" | null>(null);
  const [addedRows, setAddedRows] = useState<LocalRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const weekRows = useMemo<TimesheetRow[]>(() => {
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
          jobId: null,
          jobOperationId: null,
          job: "",
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
  const rowsByKey = useMemo(
    () => new Map(weekRows.map((row) => [row.key, row])),
    [weekRows]
  );

  // An override leaves once the loader returns the same hours.
  useEffect(() => {
    const settled = Object.keys(overrides).filter((key) => {
      const split = key.lastIndexOf("|");
      const row = rowsByKey.get(key.slice(0, split));
      return equals(
        row?.cells[key.slice(split + 1)]?.hours ?? 0,
        overrides[key] ?? 0
      );
    });
    if (settled.length === 0) return;
    setOverrides((previous) => {
      const next = { ...previous };
      for (const key of settled) delete next[key];
      return next;
    });
  }, [overrides, rowsByKey]);

  const tones = useMemo(
    () =>
      weekHoursTones(
        weekRows.map((row) => ({ key: row.key, isLeave: row.isLeave }))
      ),
    [weekRows]
  );
  const selected =
    weekRows.find((row) => row.key === selectedKey) ?? weekRows[0] ?? null;

  const hoursOf = (row: TimesheetRow, day: string) =>
    overrides[cellKey(row.key, day)] ?? row.cells[day]?.hours ?? 0;
  const isCellEditable = (row: TimesheetRow, day: string) => {
    const cell = row.cells[day];
    if (cell && cell.status !== "Draft" && cell.status !== "Rejected") {
      return false;
    }
    if (controls && day > controls.today && !row.isLeave) return false;
    return true;
  };

  const dayTotals = days.map((day) =>
    weekRows.reduce((sum, row) => sum + hoursOf(row, day), 0)
  );
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);
  const rowTotal = (row: TimesheetRow) =>
    days.reduce((sum, day) => sum + hoursOf(row, day), 0);
  const hasDraft = weekRows.some((row) =>
    Object.values(row.cells).some((cell) => cell.status === "Draft")
  );
  const isSubmitting = submitFetcher.state !== "idle";

  // Saves a day's hours for a row. In DCAA mode a value that needs a reason
  // waits for the reason modal; cancelling it puts the bar back.
  const commit = (row: TimesheetRow, day: string, hours: number) => {
    const key = cellKey(row.key, day);
    const cell = row.cells[day];
    if (equals(hoursOf(row, day), hours)) return;
    setOverrides((previous) => ({ ...previous, [key]: hours }));
    const fields = {
      entryDate: day,
      projectId: row.projectId,
      projectElementId: row.projectElementId ?? "",
      laborCategoryId: row.laborCategoryId,
      // The row's own location and role, so the save edits the row's
      // entry. "" is none.
      workLocationId: row.workLocationId ?? "",
      rdActivityRole: row.rdActivityRole ?? "",
      // Shop time: the row's job and operation; "" is none.
      jobId: row.jobId ?? "",
      jobOperationId: row.jobOperationId ?? "",
      hours: String(hours)
    };
    if (controls) {
      const reasons = timesheetCellReasons({
        entryDate: day,
        today: controls.today,
        windowDays: controls.windowDays,
        isLeave: row.isLeave,
        hasEntry: cell !== undefined,
        actorIsOwner: true
      });
      if (reasons.requiresReason || reasons.requiresLateReason) {
        setPendingChange({
          label: `${row.readableId} · ${formatDate(day, { dateStyle: "medium" }, locale)}`,
          fields,
          hours,
          previousHours: cell?.hours ?? null,
          ...reasons,
          settle: () => forgetOverride(key)
        });
        return;
      }
    }
    savingKey.current = key;
    cellFetcher.submit({ intent: "cell", ...fields }, { method: "post" });
  };

  const weekLabel = `${formatDate(weekStart, { dateStyle: "medium" }, locale)} – ${formatDate(weekEnd, { dateStyle: "medium" }, locale)}`;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
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
            {weekLabel}
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
          {controls ? (
            // DCAA mode: the week is certified before it is submitted.
            <Button
              size="lg"
              leftIcon={<LuSend />}
              isDisabled={!hasDraft || isSubmitting}
              isLoading={isSubmitting}
              onClick={() => setCertifying(true)}
            >
              <Trans>Submit week</Trans>
            </Button>
          ) : (
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
                {/* With approval off the week posts too; the toast says so. */}
                <Trans>Submit week</Trans>
              </Button>
            </submitFetcher.Form>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border max-md:w-56">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-base font-medium">
              <Trans>Charge numbers</Trans>
            </span>
          </div>
          <div className="flex gap-2 px-3 pb-3">
            <Button
              size="lg"
              variant="secondary"
              leftIcon={<LuTreePalm />}
              className="flex-1"
              onClick={() => setAdding("pto")}
            >
              <Trans>PTO</Trans>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              leftIcon={<LuPlus />}
              className="flex-1"
              onClick={() => setAdding("row")}
            >
              <Trans>Add</Trans>
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {weekRows.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                <Trans>
                  Add what you worked on this week, then tap a day to log time.
                </Trans>
              </p>
            )}
            {weekRows.map((row) => {
              const isSelected = row.key === selected?.key;
              const canRemove = Object.keys(row.cells).length === 0;
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedKey(row.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedKey(row.key);
                    }
                  }}
                  className={cn(
                    "flex min-h-16 cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected && "border-primary bg-accent/50"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={cn(
                        "mt-2 size-2 shrink-0 rounded-full",
                        tones.get(row.key)?.dot
                      )}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5 text-base">
                        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                          {row.readableId}
                        </span>
                        <span className="truncate font-medium">{row.name}</span>
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {/* Shop time: the job and operation it was worked on. */}
                        {row.job && `${row.job} · `}
                        {row.laborCategory}
                        {row.workLocation &&
                          row.workLocationId !== jobLocationId &&
                          ` · ${row.workLocation}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-4 text-sm">
                    <span className="tabular-nums text-muted-foreground">
                      {t`${formatQuantity(rowTotal(row))} h`}
                    </span>
                    {canRemove && (
                      <button
                        type="button"
                        className="min-h-8 px-1 text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAddedRows((previous) =>
                            previous.filter(
                              (added) => timesheetRowKey(added) !== row.key
                            )
                          );
                        }}
                      >
                        <Trans>Remove</Trans>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border py-6">
            <span className="text-5xl font-semibold tracking-tight tabular-nums">
              {formatQuantity(weekTotal)}
            </span>
            <span className="text-sm text-muted-foreground">
              <Trans>Total hours</Trans>
            </span>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-auto">
          <WeekHoursChart
            size="lg"
            days={days}
            today={today}
            isDayLocked={(day) =>
              controls !== null && day > controls.today && !selected?.isLeave
            }
            rows={weekRows.map((row) => ({
              key: row.key,
              label: row.readableId,
              title: row.name,
              tone: tones.get(row.key)!
            }))}
            selectedKey={selected?.key ?? null}
            hoursOf={(rowKey, day) => {
              const row = rowsByKey.get(rowKey);
              return row ? hoursOf(row, day) : 0;
            }}
            enteredAt={(rowKey, day) =>
              rowsByKey.get(rowKey)?.cells[day]?.createdAt ?? null
            }
            isEditable={(rowKey, day) => {
              const row = rowsByKey.get(rowKey);
              return row ? isCellEditable(row, day) : false;
            }}
            formatHours={formatQuantity}
            renderBarAccessory={(rowKey, day) => {
              const cell = rowsByKey.get(rowKey)?.cells[day];
              if (!cell || cell.status === "Draft") return null;
              return (
                <Status
                  color={
                    TIMESHEET_ENTRY_STATUS_COLOR_MAP[cell.status] ?? "gray"
                  }
                  iconOnly
                >
                  {cell.status}
                </Status>
              );
            }}
            onSelect={setSelectedKey}
            onCommit={(rowKey, day, hours) => {
              const row = rowsByKey.get(rowKey);
              if (row) commit(row, day, hours);
            }}
          />
          <p className="shrink-0 px-4 py-3 text-sm text-muted-foreground">
            {selected ? (
              <Trans>
                Tap a day to add time to {selected.readableId}. Drag the lower
                edge of a bar to change its hours.
              </Trans>
            ) : (
              <Trans>Add what you worked on to start logging time.</Trans>
            )}
          </p>
        </section>
      </div>

      {pendingChange && (
        <TimesheetReasonModal
          label={pendingChange.label}
          before={
            pendingChange.previousHours === null
              ? "—"
              : formatHours(pendingChange.previousHours, locale)
          }
          after={formatHours(pendingChange.hours, locale)}
          requiresReason={pendingChange.requiresReason}
          requiresLateReason={pendingChange.requiresLateReason}
          isSaving={reasonFetcher.state !== "idle"}
          onConfirm={(reasons: TimesheetReasons) =>
            reasonFetcher.submit(
              {
                intent: "cell",
                ...pendingChange.fields,
                ...(reasons.reason ? { reason: reasons.reason } : {}),
                ...(reasons.lateReason
                  ? { lateReason: reasons.lateReason }
                  : {})
              },
              { method: "post" }
            )
          }
          onCancel={() => {
            // The bar goes back to its stored hours.
            pendingChange.settle();
            setPendingChange(null);
          }}
        />
      )}

      {certifying && controls && (
        <WeekCertificationModal
          certificationText={controls.certificationText}
          weekLabel={weekLabel}
          isSubmitting={isSubmitting}
          onSubmit={(certificationText) =>
            submitFetcher.submit(
              {
                intent: "submit",
                from: weekStart,
                to: weekEnd,
                certificationText
              },
              { method: "post" }
            )
          }
          onClose={() => setCertifying(false)}
        />
      )}

      {adding && (
        <AddRowSheet
          pto={adding === "pto"}
          chargeNumbers={chargeNumbers}
          laborCategories={laborCategories}
          defaultLaborCategoryId={defaultLaborCategoryId}
          jobLocationId={jobLocationId}
          onAdd={(row) => {
            setAddedRows((previous) => [...previous, row]);
            // The new charge number is the one the next tap gives time to.
            setSelectedKey(timesheetRowKey(row));
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function formatHours(hours: number, locale: string) {
  return new Intl.NumberFormat(locale, INPUT_FORMAT.quantity).format(hours);
}

function AddRowSheet({
  pto = false,
  chargeNumbers: allChargeNumbers,
  laborCategories,
  defaultLaborCategoryId,
  jobLocationId,
  onAdd,
  onClose
}: {
  /** Time off: only the leave elements. */
  pto?: boolean;
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
  const chargeNumbers = pto
    ? allChargeNumbers.filter((row) => row.isLeave)
    : allChargeNumbers;
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
            {pto ? <Trans>Add PTO</Trans> : <Trans>Add</Trans>}
          </BottomSheetTitle>
          <BottomSheetDescription>
            {pto ? (
              <Trans>Pick the leave for your time off.</Trans>
            ) : (
              <Trans>Pick what you worked on, then the labor category.</Trans>
            )}
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
                  {pto && allChargeNumbers.every((row) => !row.isLeave) ? (
                    <Trans>
                      No leave is set up yet. Ask your manager to set one up in
                      the ERP.
                    </Trans>
                  ) : (
                    <Trans>Nothing matches your search.</Trans>
                  )}
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
