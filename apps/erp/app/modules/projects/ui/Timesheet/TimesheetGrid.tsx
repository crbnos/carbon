// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Switch,
  VStack
} from "@carbon/react";
import {
  equals,
  INPUT_FORMAT,
  INPUT_STEP,
  timesheetCellReasons
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuPencil,
  LuPlus,
  LuSend,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import { Table } from "~/components";
import {
  EditableByRow,
  EditableNumber,
  useStableEditableComponents
} from "~/components/Editable";
import Empty from "~/components/Empty";
import {
  ChargeNumber,
  Hidden,
  Location,
  Number as NumberFormField,
  Select,
  SelectControlled,
  Submit,
  TextArea,
  useChargeNumbers
} from "~/components/Form";
import { useLocations } from "~/components/Form/Location";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type {
  RdActivityRole,
  TimesheetCell,
  TimesheetEntryStatus as TimesheetEntryStatusType
} from "../../projects.models";
import {
  rdActivityRoles,
  timesheetCorrectionValidator,
  timesheetRowKey,
  timesheetRowValidator
} from "../../projects.models";
import { TimesheetEntryStatus } from "../Element/TimesheetEntryStatus";
import { useRdActivityRoleLabels } from "../RdTax/useRdTaxLabels";
import { CertificationModal } from "./CertificationModal";
import {
  TimesheetChangeModal,
  type TimesheetChangeReasons
} from "./TimesheetChangeModal";
import {
  type PendingReviewEntry,
  TimesheetReviewBanner
} from "./TimesheetReviewBanner";
import { TimesheetRevisionsPopover } from "./TimesheetRevisionsPopover";

type GridRow = {
  key: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  /** R&D tax: where the work took place, and its research role. */
  workLocationId: string | null;
  workLocationName: string | null;
  rdActivityRole: RdActivityRole | null;
  /**
   * The project identifier, or the element's readable id; on a service
   * order, the order's readable id.
   */
  readableId: string;
  name: string;
  /** Where the charge number opens. */
  to: string | null;
  /** A service order's time: read-only here, its visit page posts it. */
  isService: boolean;
  /** A leave element (5a): DCAA mode takes time for a future date on it. */
  isLeave: boolean;
  laborCategory: string;
  cells: Record<string, TimesheetCell>;
  total: number;
};

type TimesheetGridProps = {
  weekOffset: number;
  weekStart: string;
  weekEnd: string;
  days: string[];
  rows: {
    key: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    workLocationId: string | null;
    rdActivityRole: RdActivityRole | null;
    cells: Record<string, TimesheetCell>;
    total: number;
    entry: {
      project: {
        identifier: string | null;
        name: string;
        projectType: "Standard" | "Service";
        serviceOrder: { id: string; serviceOrderId: string }[];
      } | null;
      element: { readableId: string; name: string; isLeave?: boolean } | null;
      laborCategory: { name: string } | null;
      workLocation?: { id: string; name: string } | null;
    };
  }[];
  timecardHours: Record<string, number>;
  laborCategories: {
    id: string;
    name: string;
    /** R&D tax: the default research role of the category's time. */
    rdActivityRole?: RdActivityRole | null;
  }[];
  /** R&D tax: the employee's job location, a new row's default. */
  jobLocationId?: string | null;
  /** DCAA mode's controls (5a); null in Standard mode. */
  controls: TimesheetControls | null;
  /**
   * A manager's view of another employee's week (5a). Every change needs a
   * reason and waits for the employee's review; only the employee submits.
   * Standard mode shows the week read-only: only the owner changes time.
   */
  employee?: { id: string; name: string; absenceDays: string[] } | null;
};

/** What DCAA mode adds to the grid (5a). */
export type TimesheetControls = {
  /** Today on the company calendar. */
  today: string;
  windowDays: number;
  /** The entries that have a correction trail. */
  revisedEntryIds: string[];
  /** The certification text for the employee's FLSA status. */
  certificationText: string | null;
  /** The entries another user changed, waiting for the employee. */
  pendingReview: PendingReviewEntry[];
};

/** A cell value that waits for its reasons before it saves (DCAA mode). */
type PendingChange = {
  label: string;
  fields: Record<string, string>;
  hours: number;
  previousHours: number | null;
  requiresReason: boolean;
  requiresLateReason: boolean;
  /** Settles the cell's save: an error reverts the cell. */
  resolve: (result: PostgrestSingleResponse<unknown>) => void;
};

/** A row's height: the charge number over its labor category. */
const GRID_ROW_HEIGHT = 53;
/** The footer's second line, the timecard hours. */
const TIMECARD_FOOTER_EXTRA = 16;

/** Hours in a Draft or Rejected cell can change; the others are locked. */
const EDITABLE_STATUSES: TimesheetEntryStatusType[] = ["Draft", "Rejected"];
/** DCAA mode: the employee can also change an entry another user changed. */
const DCAA_EDITABLE_STATUSES: TimesheetEntryStatusType[] = [
  ...EDITABLE_STATUSES,
  "Pending Employee Review"
];
/** DCAA mode: a manager changes any entry that is not posted. */
const MANAGER_EDITABLE_STATUSES: TimesheetEntryStatusType[] = [
  ...DCAA_EDITABLE_STATUSES,
  "Submitted",
  "Approved"
];

/** One grid row: the charge number's fields and each day's hours by date. */
type TableRow = GridRow & Record<string, unknown>;

/** The hours of a cell, as a save resolves it (an emptied cell is 0). */
function cellHours(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const hours = Number(value);
  return Number.isFinite(hours) ? hours : 0;
}

const CHARGE_NUMBER_COLUMN = "chargeNumber";

/**
 * The signed-in user's week as an inline-edit grid, like the inventory count
 * lines: one row per charge number and labor category, one hours column per
 * day, a Total column and a footer with the day totals (and the timecard
 * hours under them when the week has any). A cell edits in place and saves
 * on commit; Tab and the arrows move between cells. Submit week submits the
 * Draft cells; a posted cell changes only through a correction (row menu).
 * A service order's row is read-only: its visit page posts the time.
 *
 * DCAA mode (`controls`): a day after today is read-only except on a leave
 * element; a change to a saved entry, and a new value on a late date, ask
 * for their reasons first (`TimesheetChangeModal`) and revert when the
 * modal is cancelled; Submit week certifies the week (`CertificationModal`);
 * the changes another user made wait in `TimesheetReviewBanner`; a cell
 * with a correction trail shows its history.
 */
export default function TimesheetGrid({
  weekOffset,
  weekStart,
  weekEnd,
  days,
  rows,
  timecardHours,
  laborCategories,
  jobLocationId = null,
  controls,
  employee = null
}: TimesheetGridProps) {
  const { t } = useLingui();
  const roleLabels = useRdActivityRoleLabels();
  const locations = useLocations();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const navigate = useNavigate();
  const chargeNumbers = useChargeNumbers();
  const submitFetcher = useFetcher();
  const [addingRow, setAddingRow] = useState(false);
  const [addedRows, setAddedRows] = useState<AddedRow[]>([]);
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
  const save = useCellSave();
  const editableStatuses = employee
    ? MANAGER_EDITABLE_STATUSES
    : controls
      ? DCAA_EDITABLE_STATUSES
      : EDITABLE_STATUSES;
  const saveAction = employee
    ? path.to.employeeTimesheet(employee.id)
    : path.to.timesheetUpdate;
  const weekPath = employee
    ? path.to.employeeTimesheet(employee.id)
    : path.to.timesheet;
  // Standard mode: only the owner changes time, so a manager only reads it.
  const isReadOnly = Boolean(employee) && !controls;
  const today = controls?.today ?? null;
  const absenceDays = useMemo(
    () => new Set(employee?.absenceDays ?? []),
    [employee?.absenceDays]
  );
  const revisedEntryIds = useMemo(
    () => new Set(controls?.revisedEntryIds ?? []),
    [controls?.revisedEntryIds]
  );

  const gridRows = useMemo<TableRow[]>(() => {
    const serverRows: GridRow[] = rows.map((row) => {
      const project = row.entry.project;
      const serviceOrder =
        project?.projectType === "Service"
          ? (project.serviceOrder[0] ?? null)
          : null;
      const isService = project?.projectType === "Service";
      return {
        key: row.key,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        laborCategoryId: row.laborCategoryId,
        workLocationId: row.workLocationId,
        workLocationName: row.entry.workLocation?.name ?? null,
        rdActivityRole: row.rdActivityRole,
        readableId: isService
          ? (serviceOrder?.serviceOrderId ?? "")
          : (row.entry.element?.readableId ?? project?.identifier ?? ""),
        name: row.entry.element?.name ?? project?.name ?? "",
        to: isService
          ? serviceOrder
            ? path.to.serviceOrder(serviceOrder.id)
            : null
          : row.projectElementId
            ? path.to.projectElement(row.projectId, row.projectElementId)
            : path.to.project(row.projectId),
        isService,
        isLeave: row.entry.element?.isLeave ?? false,
        laborCategory: row.entry.laborCategory?.name ?? "",
        cells: row.cells,
        total: row.total
      };
    });
    const keys = new Set(serverRows.map((row) => row.key));
    const localRows: GridRow[] = addedRows
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
          workLocationName:
            locations.find((location) => location.value === row.workLocationId)
              ?.label ?? null,
          readableId: chargeNumber?.readableId ?? "",
          name: chargeNumber?.name ?? "",
          to: row.projectElementId
            ? path.to.projectElement(row.projectId, row.projectElementId)
            : path.to.project(row.projectId),
          isService: false,
          isLeave: chargeNumber?.isLeave ?? false,
          laborCategory:
            laborCategories.find((c) => c.id === row.laborCategoryId)?.name ??
            "",
          cells: {},
          total: 0
        };
      });
    return [...serverRows, ...localRows].map((row) => {
      const tableRow: TableRow = { ...row };
      for (const day of days) tableRow[day] = row.cells[day]?.hours ?? null;
      return tableRow;
    });
  }, [rows, addedRows, chargeNumbers, laborCategories, locations, days]);

  const dayTotals = days.map((day) =>
    gridRows.reduce((sum, row) => sum + (row.cells[day]?.hours ?? 0), 0)
  );
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);
  const timecardTotal = days.reduce(
    (sum, day) => sum + (timecardHours[day] ?? 0),
    0
  );
  const hasTimecards = timecardTotal > 0;
  const hasDraft = gridRows.some(
    (row) =>
      !row.isService &&
      Object.values(row.cells).some((cell) => cell.status === "Draft")
  );
  const isSubmitting = submitFetcher.state !== "idle";

  // A cell is editable while its entry is open to the viewer; DCAA mode
  // keeps a future date read-only except on a leave element.
  const isCellEditable = useCallback(
    (row: GridRow, day: string) => {
      if (row.isService || isReadOnly) return false;
      const cell = row.cells[day];
      if (cell && !editableStatuses.includes(cell.status)) return false;
      if (today && day > today && !row.isLeave) return false;
      return true;
    },
    [isReadOnly, editableStatuses, today]
  );

  // A save posts the cell's key fields. In DCAA mode a value that needs a
  // reason waits for the change modal; cancelling it reverts the cell.
  const onCellEdit = useCallback(
    (day: string, value: unknown, row: TableRow) => {
      const cell = row.cells[day];
      const hours = cellHours(value);
      const fields = {
        entryDate: day,
        projectId: row.projectId,
        projectElementId: row.projectElementId ?? "",
        laborCategoryId: row.laborCategoryId,
        // R&D tax: the row's own values; an empty one is none.
        workLocationId: row.workLocationId ?? "",
        rdActivityRole: row.rdActivityRole ?? "",
        hours: String(hours)
      };
      if (controls) {
        // A manager's every change needs a reason.
        const { requiresReason, requiresLateReason } = timesheetCellReasons({
          entryDate: day,
          today: controls.today,
          windowDays: controls.windowDays,
          isLeave: row.isLeave,
          hasEntry: Boolean(cell),
          actorIsOwner: !employee
        });
        if (requiresReason || requiresLateReason) {
          return new Promise<Awaited<ReturnType<typeof save>>>((resolve) => {
            setPendingChange({
              label: `${row.readableId} · ${formatDate(day)}`,
              fields,
              hours,
              previousHours: cell?.hours ?? null,
              requiresReason,
              requiresLateReason,
              resolve
            });
          });
        }
      }
      return save(saveAction, fields);
    },
    [controls, employee, formatDate, save, saveAction]
  );

  const stable = useStableEditableComponents(
    (latest) => ({
      hours: EditableNumber<TableRow>(
        (key, value, row) => latest.current.onCellEdit(key, value, row),
        {
          minValue: 0,
          maxValue: 24,
          formatOptions: INPUT_FORMAT.quantity,
          step: INPUT_STEP.quantity
        },
        { clearable: true, inputClassName: "text-right" }
      )
    }),
    { onCellEdit }
  );

  const renderDay = useCallback(
    (row: GridRow, day: string) => {
      const cell = row.cells[day];
      if (!cell) return null;
      return (
        <span className="flex w-full items-center justify-end gap-1.5 tabular-nums">
          {revisedEntryIds.has(cell.entryId) && (
            <TimesheetRevisionsPopover entryId={cell.entryId} />
          )}
          {cell.status !== "Draft" && (
            <TimesheetEntryStatus status={cell.status} iconOnly />
          )}
          {formatQuantity(cell.hours)}
        </span>
      );
    },
    [revisedEntryIds, formatQuantity]
  );

  const editableComponents = useMemo(
    () =>
      Object.fromEntries(
        days.map((day) => [
          day,
          EditableByRow<TableRow>(
            (row) => (isCellEditable(row, day) ? stable.hours : null),
            ({ row }) => renderDay(row, day)
          )
        ])
      ),
    [days, isCellEditable, stable, renderDay]
  );

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: CHARGE_NUMBER_COLUMN,
        header: t`Charge Number`,
        size: 280,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                {row.original.readableId}
              </span>
              {row.original.to ? (
                <Link
                  to={row.original.to}
                  className="truncate hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.original.name}
                </Link>
              ) : (
                <span className="truncate">{row.original.name}</span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">
                {row.original.laborCategory}
                {/* R&D tax: the place, when it is not the job's. */}
                {row.original.workLocationName &&
                  row.original.workLocationId !== jobLocationId &&
                  ` · ${row.original.workLocationName}`}
              </span>
              {row.original.rdActivityRole && (
                <span className="shrink-0">
                  · {roleLabels[row.original.rdActivityRole]}
                </span>
              )}
            </span>
          </div>
        ),
        footer: () => (
          <span className="flex flex-col">
            <span className="font-medium">
              <Trans>Total</Trans>
            </span>
            {hasTimecards && (
              <span className="text-xs text-muted-foreground">
                <Trans>Timecard</Trans>
              </span>
            )}
          </span>
        )
      },
      ...days.map<ColumnDef<TableRow>>((day, index) => ({
        accessorKey: day,
        size: 96,
        header: () => (
          <span className="flex w-full flex-col items-end gap-0.5">
            <span className="whitespace-nowrap">
              {formatDate(day, { weekday: "short", day: "numeric" })}
            </span>
            {absenceDays.has(day) && (
              <span className="text-xs text-muted-foreground">
                <Trans>Absence</Trans>
              </span>
            )}
          </span>
        ),
        cell: ({ row }) => renderDay(row.original, day),
        footer: () => {
          const clocked = timecardHours[day] ?? 0;
          const differs =
            clocked > 0 && !equals(clocked, dayTotals[index] ?? 0);
          return (
            <span className="flex w-full flex-col items-end tabular-nums">
              <span className="font-medium">
                {formatQuantity(dayTotals[index] ?? 0)}
              </span>
              {hasTimecards && (
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    differs && "text-orange-500"
                  )}
                >
                  {clocked > 0 ? formatQuantity(clocked) : "—"}
                </span>
              )}
            </span>
          );
        }
      })),
      {
        id: "total",
        size: 96,
        header: () => (
          <span className="block w-full text-right">
            <Trans>Total</Trans>
          </span>
        ),
        cell: ({ row }) => (
          <span className="block w-full text-right font-medium tabular-nums">
            {formatQuantity(row.original.total)}
          </span>
        ),
        footer: () => (
          <span className="flex w-full flex-col items-end tabular-nums">
            <span className="font-medium">{formatQuantity(weekTotal)}</span>
            {hasTimecards && (
              <span className="text-xs text-muted-foreground">
                {formatQuantity(timecardTotal)}
              </span>
            )}
          </span>
        )
      }
    ],
    [
      t,
      days,
      roleLabels,
      jobLocationId,
      formatDate,
      formatQuantity,
      absenceDays,
      renderDay,
      timecardHours,
      dayTotals,
      weekTotal,
      timecardTotal,
      hasTimecards
    ]
  );

  // The row menu corrects a posted cell; only the employee corrects their
  // posted time.
  const renderMenu = useCallback(
    (row: TableRow) => {
      if (employee || row.isService) return null;
      const posted = days.filter((day) => row.cells[day]?.status === "Posted");
      if (posted.length === 0) return null;
      return (
        <>
          {posted.map((day) => {
            const cell = row.cells[day]!;
            return (
              <MenuItem
                key={day}
                onClick={() =>
                  setCorrecting({
                    entryId: cell.entryId,
                    hours: cell.hours,
                    label: `${row.readableId} · ${formatDate(day)}`,
                    projectId: row.projectId,
                    projectElementId: row.projectElementId,
                    laborCategoryId: row.laborCategoryId
                  })
                }
              >
                <MenuIcon icon={<LuPencil />} />
                {t`Correct ${formatDate(day, { weekday: "short", day: "numeric" })}`}
              </MenuItem>
            );
          })}
        </>
      );
    },
    [employee, days, formatDate, t]
  );

  // The menu column shows only while a row has a posted cell to correct.
  const hasMenu = gridRows.some((row) => renderMenu(row) !== null);
  const gridColumns = useMemo(
    () =>
      hasMenu ? [...columns, rowMenuColumn(renderMenu, t`Actions`)] : columns,
    [columns, renderMenu, hasMenu, t]
  );

  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HStack spacing={2}>
          {/* My Time is named by the breadcrumb; another employee's week is not. */}
          {employee && (
            <h2 className="text-base font-medium">{employee.name}</h2>
          )}
          <span className="whitespace-nowrap text-sm tabular-nums">
            {formatDate(weekStart)} – {formatDate(weekEnd)}
          </span>
        </HStack>
        <HStack spacing={2}>
          <IconButton
            aria-label={t`Previous week`}
            icon={<LuChevronLeft />}
            variant="secondary"
            onClick={() => navigate(`${weekPath}?week=${weekOffset - 1}`)}
          />
          <Button variant="secondary" onClick={() => navigate(weekPath)}>
            <Trans>Today</Trans>
          </Button>
          <IconButton
            aria-label={t`Next week`}
            icon={<LuChevronRight />}
            variant="secondary"
            onClick={() => navigate(`${weekPath}?week=${weekOffset + 1}`)}
          />
          {!isReadOnly && (
            <Button
              variant="ghost"
              leftIcon={<LuPlus />}
              onClick={() => setAddingRow(true)}
            >
              <Trans>Add row</Trans>
            </Button>
          )}
          {employee ? null : controls ? (
            <Button
              leftIcon={<LuSend />}
              isDisabled={!hasDraft}
              onClick={() => setCertifying(true)}
            >
              <Trans>Submit week</Trans>
            </Button>
          ) : (
            <submitFetcher.Form method="post" action={path.to.timesheetSubmit}>
              <input type="hidden" name="from" value={weekStart} />
              <input type="hidden" name="to" value={weekEnd} />
              <input type="hidden" name="week" value={weekOffset} />
              <Button
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
        </HStack>
      </div>

      {controls && controls.pendingReview.length > 0 && (
        <TimesheetReviewBanner entries={controls.pendingReview} />
      )}

      {gridRows.length === 0 ? (
        <Empty
          className="flex-1"
          title={t`No time this week`}
          description={
            employee ? null : t`Add a row for each charge number you worked on.`
          }
        />
      ) : (
        <div
          className="w-full overflow-hidden rounded-lg border border-border"
          style={{
            height:
              setupGridHeight(gridRows.length, GRID_ROW_HEIGHT) +
              (hasTimecards ? TIMECARD_FOOTER_EXTRA : 0)
          }}
        >
          <Table<TableRow>
            compact
            columns={gridColumns}
            data={gridRows}
            count={gridRows.length}
            editableComponents={editableComponents}
            withInlineEditing={!isReadOnly}
            forceEditMode={!isReadOnly}
            defaultColumnPinning={{ left: [CHARGE_NUMBER_COLUMN] }}
            withPagination={false}
            withSearch={false}
            withSimpleSorting={false}
            withSidebarTrigger={false}
            withColumnOrdering={false}
            withCsvExport={false}
            sort={null}
          />
        </div>
      )}

      {addingRow && (
        <AddRowModal
          laborCategories={laborCategories}
          jobLocationId={jobLocationId}
          onAdd={(row) => {
            setAddedRows((previous) => [...previous, row]);
            setAddingRow(false);
          }}
          onClose={() => setAddingRow(false)}
        />
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
            const result = await save(saveAction, {
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
            // An error result reverts the cell to its saved hours.
            pendingChange.resolve({
              data: null,
              error: { message: t`Change cancelled` }
            } as unknown as Awaited<ReturnType<typeof save>>);
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
          weekLabel={`${formatDate(weekStart)} – ${formatDate(weekEnd)}`}
          onClose={() => setCertifying(false)}
        />
      )}
    </div>
  );
}

/** A row added in the grid, empty until hours are entered. */
type AddedRow = {
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
};

function AddRowModal({
  laborCategories,
  jobLocationId,
  onAdd,
  onClose
}: {
  laborCategories: TimesheetGridProps["laborCategories"];
  jobLocationId: string | null;
  onAdd: (row: AddedRow) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const roleLabels = useRdActivityRoleLabels();
  const [showMore, setShowMore] = useState(false);
  // The user's picks; the defaults follow the chosen labor category.
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [roleChoice, setRoleChoice] = useState<RdActivityRole | "" | null>(
    null
  );
  const categoryId = categoryChoice ?? laborCategories[0]?.id ?? "";
  const role =
    roleChoice ??
    laborCategories.find((category) => category.id === categoryId)
      ?.rdActivityRole ??
    "";

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetRowValidator}
          defaultValues={{
            projectId: "",
            projectElementId: "",
            laborCategoryId: laborCategories[0]?.id ?? "",
            workLocationId: jobLocationId ?? "",
            rdActivityRole: role
          }}
          onSubmit={(values, event) => {
            event.preventDefault();
            onAdd({
              projectId: values.projectId,
              projectElementId: values.projectElementId || null,
              laborCategoryId: values.laborCategoryId,
              workLocationId: values.workLocationId || null,
              rdActivityRole: values.rdActivityRole || null
            });
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Row</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>The row shows empty until you enter hours.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <ChargeNumber label={t`Charge Number`} />
              <Select
                name="laborCategoryId"
                label={t`Labor Category`}
                options={laborCategories.map((category) => ({
                  value: category.id,
                  label: category.name
                }))}
                onChange={(option) => {
                  setCategoryChoice(option?.value ?? null);
                  // A new category brings its own default role.
                  setRoleChoice(null);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                rightIcon={showMore ? <LuChevronDown /> : <LuChevronRight />}
                onClick={() => setShowMore((open) => !open)}
              >
                <Trans>More</Trans>
              </Button>
              {/* Hidden, not unmounted: the defaults still submit. */}
              <div
                className={cn(
                  "flex w-full flex-col gap-4",
                  !showMore && "hidden"
                )}
              >
                <Location
                  name="workLocationId"
                  label={t`Work location`}
                  helperText={t`Where the work took place. Decides domestic or foreign research for R&D tax.`}
                />
                <SelectControlled
                  name="rdActivityRole"
                  label={t`Research role`}
                  isOptional
                  value={role}
                  options={rdActivityRoles.map((value) => ({
                    value,
                    label: roleLabels[value]
                  }))}
                  onChange={(option) =>
                    setRoleChoice((option?.value as RdActivityRole) ?? "")
                  }
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Corrects posted time: a reversal and the new hours. **Move to another
 * charge number** makes it a labor transfer, with the new charge number and
 * labor category defaulted to the original's.
 */
function CorrectionModal({
  entryId,
  hours,
  label,
  original,
  laborCategories,
  onClose
}: {
  entryId: string;
  hours: number;
  label: string;
  original: {
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
  };
  laborCategories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [moving, setMoving] = useState(false);
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetCorrectionValidator}
          method="post"
          action={path.to.timesheetCorrect}
          fetcher={fetcher}
          defaultValues={{
            timesheetEntryId: entryId,
            hours,
            correctionReason: "",
            projectId: original.projectId,
            projectElementId: original.projectElementId ?? "",
            laborCategoryId: original.laborCategoryId
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Correct Posted Time</Trans>
            </ModalTitle>
            <ModalDescription>{label}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="timesheetEntryId" />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <NumberFormField
                name="hours"
                label={t`Correct hours`}
                minValue={0}
                maxValue={24}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
                helperText={t`The posted hours are reversed and these hours are charged instead`}
              />
              <Switch
                variant="small"
                label={t`Move to another charge number`}
                checked={moving}
                onCheckedChange={setMoving}
              />
              {/* Unrendered, the fields send nothing: the original's stay. */}
              {moving && (
                <>
                  <ChargeNumber label={t`Charge Number`} />
                  <Select
                    name="laborCategoryId"
                    label={t`Labor Category`}
                    options={laborCategories.map((category) => ({
                      value: category.id,
                      label: category.name
                    }))}
                  />
                </>
              )}
              <TextArea name="correctionReason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Submit Correction</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
