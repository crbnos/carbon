// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { WeekHoursChart, weekHoursTones } from "@carbon/react/WeekHours";
import {
  equals,
  formatDurationHours,
  timesheetCellReasons
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCircleAlert,
  LuEllipsis,
  LuPencil,
  LuPlus,
  LuSend,
  LuTreePalm
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { useCellSave } from "~/components/Setup";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { TimesheetEntryStatus as TimesheetEntryStatusType } from "../../projects.models";
import { timesheetRowKey } from "../../projects.models";
import { TimesheetEntryStatus } from "../Element/TimesheetEntryStatus";
import { CertificationModal } from "./CertificationModal";
import {
  TimesheetChangeModal,
  type TimesheetChangeReasons
} from "./TimesheetChangeModal";
import { type AddedRow, AddRowModal, CorrectionModal } from "./TimesheetModals";
import { TimesheetReviewBanner } from "./TimesheetReviewBanner";
import { TimesheetRevisionsPopover } from "./TimesheetRevisionsPopover";
import {
  type GridRow,
  type TimesheetGridProps,
  useTimesheetRows
} from "./useTimesheetRows";

/** The height of one hour on the chart. */
const _HOUR_PX = 40;

/** Hours in a Draft or Rejected entry can change; the others are locked. */
const EDITABLE_STATUSES: TimesheetEntryStatusType[] = ["Draft", "Rejected"];
/** DCAA mode: the employee can also change an entry another user changed. */
const DCAA_EDITABLE_STATUSES: TimesheetEntryStatusType[] = [
  ...EDITABLE_STATUSES,
  "Pending Employee Review"
];

/** A cell value that waits for its reasons before it saves (DCAA mode). */
type PendingChange = {
  label: string;
  fields: Record<string, string>;
  hours: number;
  previousHours: number | null;
  requiresReason: boolean;
  requiresLateReason: boolean;
  resolve: (result: PostgrestSingleResponse<unknown>) => void;
};

const cellKey = (rowKey: string, day: string) => `${rowKey}|${day}`;

/** Clock time as hours and minutes ("8h, 32m"), never a long decimal. */
const formatClocked = (hours: number) =>
  formatDurationHours(hours, { style: "short", units: ["h", "m"] });

/**
 * My Time as a week of bars: the charge numbers of the week on the left,
 * one column per day on the right, and in each column one bar per charge
 * number, stacked, as tall as its hours. Select a charge number, then click
 * a day to give it time up to that point; drag a bar's lower edge to change
 * its hours (half-hour steps), or press the arrow keys on it. A bar at 0 is
 * deleted. Every change saves at once through `save-timesheet-entry`, as a
 * grid cell did. **Submit week** lists what the week still needs.
 *
 * A Submitted, Approved or Posted bar is locked; a Posted one is corrected
 * from its menu. A service order's time is read-only here: its visit page
 * posts it. DCAA mode keeps a day after today locked except on a leave
 * element, asks for the change and late reasons first
 * (`TimesheetChangeModal`), certifies the week (`CertificationModal`) and
 * shows the changes another user made (`TimesheetReviewBanner`).
 *
 * The manager's view of another employee's week keeps the grid
 * (`TimesheetGrid`): every change there needs a reason.
 */
export default function TimesheetWeek({
  weekOffset,
  weekStart,
  weekEnd,
  days,
  rows,
  timecardHours,
  laborCategories,
  jobLocationId = null,
  controls,
  today: currentDay
}: Omit<TimesheetGridProps, "employee"> & {
  /** Today on the company calendar. */
  today: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const navigate = useNavigate();
  const save = useCellSave();
  const submitFetcher = useFetcher();

  const [addedRows, setAddedRows] = useState<AddedRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState<"row" | "pto" | null>(null);
  const [removing, setRemoving] = useState<GridRow | null>(null);
  const [correcting, setCorrecting] = useState<{
    entryId: string;
    hours: number;
    label: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
  } | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(
    null
  );
  const [certifying, setCertifying] = useState(false);
  // The hours the user just set, shown until the saved value comes back.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [savingCount, setSavingCount] = useState(0);

  const editableStatuses = controls
    ? DCAA_EDITABLE_STATUSES
    : EDITABLE_STATUSES;
  const today = controls?.today ?? null;
  const revisedEntryIds = useMemo(
    () => new Set(controls?.revisedEntryIds ?? []),
    [controls?.revisedEntryIds]
  );

  const weekRows = useTimesheetRows({ rows, addedRows, laborCategories });

  // An override leaves once the loader returns the same hours.
  useEffect(() => {
    const settled = Object.entries(overrides).filter(([key, hours]) => {
      const split = key.lastIndexOf("|");
      const row = weekRows.find((r) => r.key === key.slice(0, split));
      return equals(row?.cells[key.slice(split + 1)]?.hours ?? 0, hours);
    });
    if (settled.length === 0) return;
    setOverrides((previous) => {
      const next = { ...previous };
      for (const [key] of settled) delete next[key];
      return next;
    });
  }, [overrides, weekRows]);

  const hoursOf = useCallback(
    (row: GridRow, day: string) =>
      overrides[cellKey(row.key, day)] ?? row.cells[day]?.hours ?? 0,
    [overrides]
  );

  const tones = useMemo(
    () =>
      weekHoursTones(
        weekRows.map((row) => ({
          key: row.key,
          isLeave: row.isLeave
        }))
      ),
    [weekRows]
  );
  const rowsByKey = useMemo(
    () => new Map(weekRows.map((row) => [row.key, row])),
    [weekRows]
  );

  const selected =
    weekRows.find((row) => row.key === selectedKey) ?? weekRows[0] ?? null;

  const isCellEditable = useCallback(
    (row: GridRow, day: string) => {
      const cell = row.cells[day];
      if (cell && !editableStatuses.includes(cell.status)) return false;
      if (today && day > today && !row.isLeave) return false;
      return true;
    },
    [editableStatuses, today]
  );

  const dayTotals = days.map((day) =>
    weekRows.reduce((sum, row) => sum + hoursOf(row, day), 0)
  );
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);
  const rowTotal = (row: GridRow) =>
    days.reduce((sum, day) => sum + hoursOf(row, day), 0);
  const timecardTotal = days.reduce(
    (sum, day) => sum + (timecardHours[day] ?? 0),
    0
  );
  const hasTimecards = timecardTotal > 0;
  const draftHours = weekRows.reduce(
    (sum, row) =>
      sum +
      days.reduce(
        (daySum, day) =>
          row.cells[day]?.status === "Draft"
            ? daySum + row.cells[day]!.hours
            : daySum,
        0
      ),
    0
  );
  const pendingReviewCount = controls?.pendingReview.length ?? 0;
  const isSubmitting = submitFetcher.state !== "idle";
  const canSubmit = draftHours > 0 && pendingReviewCount === 0;

  // Saves a day's hours for a row. In DCAA mode a value that needs a reason
  // waits for the change modal; cancelling it puts the bar back.
  const commit = useCallback(
    async (row: GridRow, day: string, hours: number) => {
      const key = cellKey(row.key, day);
      const cell = row.cells[day];
      if (equals(cell?.hours ?? 0, hours) && overrides[key] === undefined) {
        return;
      }
      setOverrides((previous) => ({ ...previous, [key]: hours }));
      const fields = {
        entryDate: day,
        projectId: row.projectId,
        projectElementId: row.projectElementId ?? "",
        laborCategoryId: row.laborCategoryId,
        workLocationId: row.workLocationId ?? "",
        rdActivityRole: row.rdActivityRole ?? "",
        // Shop time: the row's job and operation; an empty one is none.
        jobId: row.jobId ?? "",
        jobOperationId: row.jobOperationId ?? "",
        hours: String(hours)
      };

      let result: PostgrestSingleResponse<unknown>;
      const reasons = controls
        ? timesheetCellReasons({
            entryDate: day,
            today: controls.today,
            windowDays: controls.windowDays,
            isLeave: row.isLeave,
            hasEntry: Boolean(cell),
            actorIsOwner: true
          })
        : null;
      if (reasons?.requiresReason || reasons?.requiresLateReason) {
        result = await new Promise((resolve) =>
          setPendingChange({
            label: `${row.readableId} · ${formatDate(day)}`,
            fields,
            hours,
            previousHours: cell?.hours ?? null,
            requiresReason: reasons.requiresReason,
            requiresLateReason: reasons.requiresLateReason,
            resolve
          })
        );
      } else {
        setSavingCount((count) => count + 1);
        result = await save(path.to.timesheetUpdate, fields);
        setSavingCount((count) => count - 1);
      }
      // A refusal or a cancelled reason puts the bar back.
      if (result.error) {
        setOverrides((previous) => {
          const { [key]: _gone, ...rest } = previous;
          return rest;
        });
      }
    },
    [controls, formatDate, overrides, save]
  );

  const removeRow = async (row: GridRow) => {
    setRemoving(null);
    for (const day of days) {
      if (row.cells[day]) await commit(row, day, 0);
    }
    setAddedRows((previous) =>
      previous.filter(
        (added) =>
          !(
            added.projectId === row.projectId &&
            (added.projectElementId ?? null) === row.projectElementId &&
            added.laborCategoryId === row.laborCategoryId
          )
      )
    );
  };

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(weekEnd)}`;

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <IconButton
            aria-label={t`Previous week`}
            icon={<LuChevronLeft />}
            variant="ghost"
            onClick={() =>
              navigate(`${path.to.timesheet}?week=${weekOffset - 1}`)
            }
          />
          <span className="whitespace-nowrap text-sm font-medium tabular-nums">
            {weekLabel}
          </span>
          <IconButton
            aria-label={t`Next week`}
            icon={<LuChevronRight />}
            variant="ghost"
            onClick={() =>
              navigate(`${path.to.timesheet}?week=${weekOffset + 1}`)
            }
          />
          {weekOffset !== 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(path.to.timesheet)}
            >
              <Trans>This week</Trans>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SaveState saving={savingCount > 0} />
          <SubmitWeek
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            checks={
              <SubmitChecks
                draftHours={draftHours}
                pendingReviewCount={pendingReviewCount}
                weekTotal={weekTotal}
                timecardTotal={controls && hasTimecards ? timecardTotal : null}
              />
            }
            onSubmit={() => {
              if (controls) {
                setCertifying(true);
                return;
              }
              submitFetcher.submit(
                {
                  from: weekStart,
                  to: weekEnd,
                  week: String(weekOffset)
                },
                { method: "post", action: path.to.timesheetSubmit }
              );
            }}
          />
        </div>
      </div>

      {controls && pendingReviewCount > 0 && (
        <div className="shrink-0 px-4 pt-3">
          <TimesheetReviewBanner entries={controls.pendingReview} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm font-medium">
              <Trans>Charge numbers</Trans>
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LuTreePalm />}
                onClick={() => setAdding("pto")}
              >
                <Trans>PTO</Trans>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LuPlus />}
                onClick={() => setAdding("row")}
              >
                <Trans>Add</Trans>
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {weekRows.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                <Trans>
                  Add the charge numbers you worked on this week, then click a
                  day to log time.
                </Trans>
              </p>
            )}
            {weekRows.map((row) => {
              const isSelected = row.key === selected?.key;
              const locked = Object.values(row.cells).some(
                (cell) => !editableStatuses.includes(cell.status)
              );
              const hasEntries = Object.keys(row.cells).length > 0;
              const canRemove = !locked && (!controls || !hasEntries);
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
                    "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    "cursor-pointer hover:bg-accent/50",
                    isSelected && "border-primary bg-accent/50"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        tones.get(row.key)?.dot
                      )}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {row.readableId}
                        </span>
                        <span className="truncate font-medium">{row.name}</span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.jobLabel
                          ? `${row.jobLabel} · ${row.laborCategory}`
                          : row.laborCategory}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-4 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {t`${formatQuantity(rowTotal(row))} h`}
                    </span>
                    {canRemove && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (hasEntries) setRemoving(row);
                          else void removeRow(row);
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
            {hasTimecards && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t`${formatClocked(timecardTotal)} on your timecards`}
              </span>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-auto">
          <WeekHoursChart
            days={days}
            today={currentDay}
            isDayLocked={(day) =>
              today !== null && day > today && !selected?.isLeave
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
            clockedHours={timecardHours}
            formatHours={formatQuantity}
            renderBarAccessory={(rowKey, day) => {
              const row = rowsByKey.get(rowKey);
              const cell = row?.cells[day];
              if (!row || !cell) return null;
              return (
                <BarAccessory
                  status={cell.status}
                  entryId={cell.entryId}
                  isRevised={revisedEntryIds.has(cell.entryId)}
                  canCorrect={cell.status === "Posted"}
                  onCorrect={() =>
                    setCorrecting({
                      entryId: cell.entryId,
                      hours: cell.hours,
                      label: `${row.readableId} · ${formatDate(day)}`,
                      projectId: row.projectId,
                      projectElementId: row.projectElementId,
                      laborCategoryId: row.laborCategoryId
                    })
                  }
                />
              );
            }}
            onSelect={(rowKey) => setSelectedKey(rowKey)}
            onCommit={(rowKey, day, hours) => {
              const row = rowsByKey.get(rowKey);
              if (row) void commit(row, day, hours);
            }}
          />
          <p className="shrink-0 px-4 py-3 text-xs text-muted-foreground">
            {selected ? (
              <Trans>
                Click a day to add time to {selected.readableId}. Drag the lower
                edge of a bar to change its hours.
              </Trans>
            ) : (
              <Trans>Add a charge number to start logging time.</Trans>
            )}
          </p>
        </section>
      </div>

      {adding && (
        <AddRowModal
          pto={adding === "pto"}
          laborCategories={laborCategories}
          jobLocationId={jobLocationId}
          onAdd={(row) => {
            setAddedRows((previous) => [...previous, row]);
            // The new charge number is the one the next click gives time to.
            setSelectedKey(timesheetRowKey(row));
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {removing && (
        <Modal open onOpenChange={(open) => !open && setRemoving(null)}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Remove {removing.readableId}?</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>
                  Its {formatQuantity(rowTotal(removing))} h of draft time this
                  week are deleted.
                </Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody />
            <ModalFooter>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="destructive"
                onClick={() => void removeRow(removing)}
              >
                <Trans>Remove</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {correcting && (
        <CorrectionModal
          entryId={correcting.entryId}
          hours={correcting.hours}
          label={correcting.label}
          original={correcting}
          laborCategories={laborCategories}
          onClose={() => setCorrecting(null)}
        />
      )}

      {pendingChange && (
        <TimesheetChangeModal
          label={pendingChange.label}
          previousHours={pendingChange.previousHours}
          hours={pendingChange.hours}
          requiresReason={pendingChange.requiresReason}
          requiresLateReason={pendingChange.requiresLateReason}
          onConfirm={async (reasons: TimesheetChangeReasons) => {
            const result = await save(path.to.timesheetUpdate, {
              ...pendingChange.fields,
              ...(reasons.reason ? { reason: reasons.reason } : {}),
              ...(reasons.lateReason ? { lateReason: reasons.lateReason } : {})
            });
            // A refusal toasts and keeps the modal open.
            if (result.error) return false;
            pendingChange.resolve(result);
            setPendingChange(null);
            return true;
          }}
          onCancel={() => {
            pendingChange.resolve({
              data: null,
              error: { message: t`Change cancelled` }
            } as unknown as PostgrestSingleResponse<unknown>);
            setPendingChange(null);
          }}
        />
      )}

      {certifying && controls && (
        <CertificationModal
          certificationText={controls.certificationText}
          weekStart={weekStart}
          weekEnd={weekEnd}
          weekOffset={weekOffset}
          weekLabel={weekLabel}
          onClose={() => setCertifying(false)}
        />
      )}
    </div>
  );
}

/** A bar's status, its correction trail and, once posted, **Correct**. */
function BarAccessory({
  status,
  entryId,
  isRevised,
  canCorrect,
  onCorrect
}: {
  status: TimesheetEntryStatusType;
  entryId: string;
  isRevised: boolean;
  canCorrect: boolean;
  onCorrect: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {isRevised && <TimesheetRevisionsPopover entryId={entryId} />}
      {status !== "Draft" && <TimesheetEntryStatus status={status} iconOnly />}
      {canCorrect && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t`More options`}
              className="rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <LuEllipsis className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onCorrect}>
              <DropdownMenuIcon icon={<LuPencil />} />
              <Trans>Correct</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

/** "Saving…" while a change is on its way, "Saved" after. */
function SaveState({ saving }: { saving: boolean }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {saving ? (
        <Trans>Saving…</Trans>
      ) : (
        <>
          <LuCheck className="size-3.5" />
          <Trans>Saved</Trans>
        </>
      )}
    </span>
  );
}

/** Submit week, with what the week still needs in its tooltip. */
function SubmitWeek({
  canSubmit,
  isSubmitting,
  checks,
  onSubmit
}: {
  canSubmit: boolean;
  isSubmitting: boolean;
  checks: ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events: the span does. */}
        <span tabIndex={0}>
          <Button
            leftIcon={<LuSend />}
            isDisabled={!canSubmit || isSubmitting}
            isLoading={isSubmitting}
            onClick={onSubmit}
          >
            <Trans>Submit week</Trans>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-80">
        {checks}
      </TooltipContent>
    </Tooltip>
  );
}

/** The checks Submit week makes, each met or not. */
function SubmitChecks({
  draftHours,
  pendingReviewCount,
  weekTotal,
  timecardTotal
}: {
  draftHours: number;
  pendingReviewCount: number;
  weekTotal: number;
  /** DCAA mode with timecards: the hours clocked this week. */
  timecardTotal: number | null;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const checks: { met: boolean; label: string }[] = [
    {
      met: draftHours > 0,
      label:
        draftHours > 0
          ? t`${formatQuantity(draftHours)} h of draft time to submit`
          : t`No draft time this week`
    }
  ];
  if (pendingReviewCount > 0) {
    checks.push({
      met: false,
      label: t`Review the changes to your timesheet first`
    });
  }
  if (timecardTotal !== null) {
    checks.push({
      met: weekTotal >= timecardTotal || equals(weekTotal, timecardTotal),
      label: t`${formatQuantity(weekTotal)} h of ${formatQuantity(timecardTotal)} h on your timecards`
    });
  }
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <span className="text-xs font-medium">
        <Trans>Before you submit</Trans>
      </span>
      {checks.map((check) => (
        <span key={check.label} className="flex items-center gap-1.5 text-xs">
          {check.met ? (
            <LuCheck className="size-3.5 shrink-0 text-emerald-500" />
          ) : (
            <LuCircleAlert className="size-3.5 shrink-0 text-orange-500" />
          )}
          {check.label}
        </span>
      ))}
    </div>
  );
}
