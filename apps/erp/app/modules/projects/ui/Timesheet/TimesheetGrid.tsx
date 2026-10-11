// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  NumberField,
  NumberInput,
  Table as TableBase,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, isEntryDateAllowed } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPencil,
  LuPlus,
  LuSend,
  LuTimer,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  ChargeNumber,
  Hidden,
  Number as NumberFormField,
  Select,
  Submit,
  TextArea,
  useChargeNumbers
} from "~/components/Form";
import { useCellSave } from "~/components/Setup";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { path } from "~/utils/path";
import type {
  TimesheetCell,
  TimesheetEntryStatus as TimesheetEntryStatusType
} from "../../projects.models";
import {
  timesheetCorrectionValidator,
  timesheetRowKey,
  timesheetRowValidator
} from "../../projects.models";
import { TimesheetEntryStatus } from "../Element/TimesheetEntryStatus";
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
    };
  }[];
  timecardHours: Record<string, number>;
  laborCategories: { id: string; name: string }[];
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
  revert: () => void;
};

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

/**
 * The signed-in user's week: one row per charge number and labor category,
 * one cell per day. A cell saves on blur. Submit week submits the Draft
 * cells; a posted cell changes only through a correction. A service order's
 * row is read-only: its visit page posts the time.
 *
 * DCAA mode (`controls`): a day after today is read-only except on a leave
 * element; a change to a saved entry, and a new value on a late date, ask
 * for their reasons first (`TimesheetChangeModal`); Submit week certifies
 * the week (`CertificationModal`); the changes another user made wait in
 * `TimesheetReviewBanner`; a cell with a correction trail shows its history.
 */
export default function TimesheetGrid({
  weekOffset,
  weekStart,
  weekEnd,
  days,
  rows,
  timecardHours,
  laborCategories,
  controls,
  employee = null
}: TimesheetGridProps) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const navigate = useNavigate();
  const settings = useSettings();
  const chargeNumbers = useChargeNumbers();
  const submitFetcher = useFetcher();
  const [addingRow, setAddingRow] = useState(false);
  const [addedRows, setAddedRows] = useState<
    {
      projectId: string;
      projectElementId: string | null;
      laborCategoryId: string;
    }[]
  >([]);
  const [correcting, setCorrecting] = useState<{
    entryId: string;
    hours: number;
    label: string;
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
  const absenceDays = useMemo(
    () => new Set(employee?.absenceDays ?? []),
    [employee?.absenceDays]
  );
  const revisedEntryIds = useMemo(
    () => new Set(controls?.revisedEntryIds ?? []),
    [controls?.revisedEntryIds]
  );

  const gridRows = useMemo<GridRow[]>(() => {
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
    return [...serverRows, ...localRows];
  }, [rows, addedRows, chargeNumbers, laborCategories]);

  const dayTotals = days.map((day) =>
    gridRows.reduce((sum, row) => sum + (row.cells[day]?.hours ?? 0), 0)
  );
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);
  const timecardTotal = days.reduce(
    (sum, day) => sum + (timecardHours[day] ?? 0),
    0
  );
  const hasDraft = gridRows.some(
    (row) =>
      !row.isService &&
      Object.values(row.cells).some((cell) => cell.status === "Draft")
  );
  const isSubmitting = submitFetcher.state !== "idle";

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HStack spacing={2}>
          <h2 className="text-base font-medium">
            {employee ? employee.name : <Trans>My Timesheet</Trans>}
          </h2>
          <HStack spacing={1}>
            <IconButton
              aria-label={t`Previous week`}
              icon={<LuChevronLeft />}
              variant="ghost"
              size="sm"
              onClick={() => navigate(`${weekPath}?week=${weekOffset - 1}`)}
            />
            <span className="whitespace-nowrap text-sm tabular-nums">
              {formatDate(weekStart)} – {formatDate(weekEnd)}
            </span>
            <IconButton
              aria-label={t`Next week`}
              icon={<LuChevronRight />}
              variant="ghost"
              size="sm"
              onClick={() => navigate(`${weekPath}?week=${weekOffset + 1}`)}
            />
            {weekOffset !== 0 && (
              <Button variant="ghost" size="sm" asChild>
                <Link to={weekPath}>
                  <Trans>This week</Trans>
                </Link>
              </Button>
            )}
          </HStack>
        </HStack>
        <HStack spacing={2}>
          {!isReadOnly && (
            <Button
              variant="secondary"
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
                {settings.timesheetApprovalRequired ? (
                  <Trans>Submit week</Trans>
                ) : (
                  <Trans>Submit and post week</Trans>
                )}
              </Button>
            </submitFetcher.Form>
          )}
        </HStack>
      </div>

      {controls && controls.pendingReview.length > 0 && (
        <TimesheetReviewBanner entries={controls.pendingReview} />
      )}

      {gridRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <LuTimer className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {employee ? (
              <Trans>No time this week.</Trans>
            ) : (
              <Trans>
                No time this week. Add a row for each charge number you worked
                on.
              </Trans>
            )}
          </p>
          {!isReadOnly && (
            <Button leftIcon={<LuPlus />} onClick={() => setAddingRow(true)}>
              <Trans>Add row</Trans>
            </Button>
          )}
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
          <TableBase full>
            <Thead>
              <Tr>
                <Th className="min-w-[16rem]">
                  <Trans>Charge Number</Trans>
                </Th>
                {days.map((day) => (
                  <Th key={day} className="w-24 text-right">
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap">
                        {formatDate(day, { weekday: "short", day: "numeric" })}
                      </span>
                      {absenceDays.has(day) && (
                        <Badge variant="secondary">
                          <Trans>Absence</Trans>
                        </Badge>
                      )}
                    </span>
                  </Th>
                ))}
                <Th className="w-24 text-right">
                  <Trans>Total</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {gridRows.map((row) => (
                <Tr key={row.key}>
                  <Td>
                    <div className="flex min-w-0 max-w-[24rem] flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {row.readableId}
                        </span>
                        {row.to ? (
                          <Link
                            to={row.to}
                            className="truncate hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="truncate">{row.name}</span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.laborCategory}
                      </span>
                    </div>
                  </Td>
                  {days.map((day) => {
                    const cell = row.cells[day];
                    const cellLabel = `${row.readableId} · ${formatDate(day)}`;
                    const history =
                      cell && revisedEntryIds.has(cell.entryId) ? (
                        <TimesheetRevisionsPopover entryId={cell.entryId} />
                      ) : null;
                    if (row.isService || isReadOnly) {
                      return (
                        <Td key={day} className="p-0">
                          {cell && <ReadOnlyCell cell={cell} />}
                        </Td>
                      );
                    }
                    if (cell && !editableStatuses.includes(cell.status)) {
                      return (
                        <Td key={day} className="p-0">
                          <CellWithHistory history={history}>
                            <LockedCell
                              cell={cell}
                              onCorrect={
                                // Only the employee corrects their posted time.
                                employee
                                  ? undefined
                                  : () =>
                                      setCorrecting({
                                        entryId: cell.entryId,
                                        hours: cell.hours,
                                        label: cellLabel
                                      })
                              }
                            />
                          </CellWithHistory>
                        </Td>
                      );
                    }
                    // DCAA mode: no time for a future date, except leave.
                    if (controls && day > controls.today && !row.isLeave) {
                      return (
                        <Td key={day} className="p-0">
                          {cell ? (
                            <CellWithHistory history={history}>
                              <ReadOnlyCell cell={cell} />
                            </CellWithHistory>
                          ) : (
                            <span className="block h-9" />
                          )}
                        </Td>
                      );
                    }
                    return (
                      <Td key={day} className="p-0">
                        <CellWithHistory history={history}>
                          <HoursCell
                            action={saveAction}
                            row={row}
                            day={day}
                            cell={cell}
                            label={t`Hours on ${formatDate(day)} for ${row.readableId}`}
                            onRequestReasons={
                              controls
                                ? (change) => {
                                    const entryWindow = isEntryDateAllowed({
                                      entryDate: day,
                                      today: controls.today,
                                      windowDays: controls.windowDays,
                                      isLeave: row.isLeave
                                    });
                                    const requiresLateReason =
                                      entryWindow.allowed && entryWindow.late;
                                    // A manager's every change needs a reason.
                                    const requiresReason =
                                      Boolean(cell) || Boolean(employee);
                                    if (
                                      !requiresReason &&
                                      !requiresLateReason
                                    ) {
                                      return false;
                                    }
                                    setPendingChange({
                                      ...change,
                                      label: cellLabel,
                                      requiresReason,
                                      requiresLateReason
                                    });
                                    return true;
                                  }
                                : undefined
                            }
                          />
                        </CellWithHistory>
                      </Td>
                    );
                  })}
                  <Td className="text-right tabular-nums font-medium">
                    {formatQuantity(row.total)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
            <Tfoot>
              <Tr>
                <Td className="text-xs font-medium text-muted-foreground">
                  <Trans>Total</Trans>
                </Td>
                {dayTotals.map((hours, index) => (
                  <Td
                    key={days[index]}
                    className="text-right tabular-nums font-medium"
                  >
                    {formatQuantity(hours)}
                  </Td>
                ))}
                <Td className="text-right tabular-nums font-medium">
                  {formatQuantity(weekTotal)}
                </Td>
              </Tr>
              <Tr>
                <Td className="text-xs font-medium text-muted-foreground">
                  <Trans>Timecard</Trans>
                </Td>
                {days.map((day, index) => {
                  const clocked = timecardHours[day] ?? 0;
                  const differs =
                    clocked > 0 &&
                    Math.abs(clocked - dayTotals[index]!) >= 0.01;
                  return (
                    <Td
                      key={day}
                      className={cn(
                        "text-right tabular-nums text-muted-foreground",
                        differs && "text-orange-500"
                      )}
                    >
                      {clocked > 0 ? formatQuantity(clocked) : "—"}
                    </Td>
                  );
                })}
                <Td className="text-right tabular-nums text-muted-foreground">
                  {timecardTotal > 0 ? formatQuantity(timecardTotal) : "—"}
                </Td>
              </Tr>
            </Tfoot>
          </TableBase>
        </div>
      )}

      {addingRow && (
        <AddRowModal
          laborCategories={laborCategories}
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
            setPendingChange(null);
            return true;
          }}
          onCancel={() => {
            pendingChange.revert();
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

/** A cell's content with its history button in front, when it has one. */
function CellWithHistory({
  history,
  children
}: {
  history: ReactNode;
  children: ReactNode;
}) {
  if (!history) return <>{children}</>;
  return (
    <div className="flex items-center">
      {history}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A day cell that saves its hours on blur. In DCAA mode
 * `onRequestReasons` decides first: when the value needs a reason it opens
 * the change modal, which saves the value or reverts the cell.
 */
function HoursCell({
  action,
  row,
  day,
  cell,
  label,
  onRequestReasons
}: {
  /** The route that saves the cell. */
  action: string;
  row: GridRow;
  day: string;
  cell?: TimesheetCell;
  label: string;
  /** Returns true when it took the value to ask for its reasons. */
  onRequestReasons?: (
    change: Pick<PendingChange, "fields" | "hours" | "previousHours" | "revert">
  ) => boolean;
}) {
  const save = useCellSave();
  const serverHours = cell?.hours;
  const latest = useRef<number | undefined>(serverHours);
  // A refused save remounts the input with the stored hours.
  const [resets, setResets] = useState(0);

  const revert = () => {
    latest.current = serverHours;
    setResets((count) => count + 1);
  };

  const commit = async () => {
    const next = latest.current;
    const hours = next === undefined || !Number.isFinite(next) ? 0 : next;
    if (hours === (serverHours ?? 0)) return;
    const fields = {
      entryDate: day,
      projectId: row.projectId,
      projectElementId: row.projectElementId ?? "",
      laborCategoryId: row.laborCategoryId,
      hours: String(hours)
    };
    if (
      onRequestReasons?.({
        fields,
        hours,
        previousHours: serverHours ?? null,
        revert
      })
    ) {
      return;
    }
    const result = await save(action, fields);
    if (result.error) revert();
  };

  return (
    <div className="flex items-center justify-end gap-1 pr-1">
      {(cell?.status === "Rejected" ||
        cell?.status === "Pending Employee Review") && (
        <TimesheetEntryStatus status={cell.status} iconOnly />
      )}
      <NumberField
        key={`${serverHours ?? ""}:${resets}`}
        aria-label={label}
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
          size="sm"
          className="w-20 text-right tabular-nums"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
        />
      </NumberField>
    </div>
  );
}

/** A cell shown with its status and hours, with no action. */
function ReadOnlyCell({ cell }: { cell: TimesheetCell }) {
  const formatQuantity = useQuantityFormatter();
  return (
    <span className="flex h-9 items-center justify-end gap-1.5 px-3 tabular-nums">
      <TimesheetEntryStatus status={cell.status} iconOnly />
      {formatQuantity(cell.hours)}
    </span>
  );
}

/** A submitted, approved or posted cell. A posted one offers a correction. */
function LockedCell({
  cell,
  onCorrect
}: {
  cell: TimesheetCell;
  /** Absent when the viewer cannot correct the time. */
  onCorrect?: () => void;
}) {
  const { t } = useLingui();
  const content = <ReadOnlyCell cell={cell} />;

  if (cell.status !== "Posted" || !onCorrect) return content;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-full hover:bg-accent/50"
          aria-label={t`Posted hours, open the correction menu`}
        >
          {content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCorrect}>
          <DropdownMenuIcon icon={<LuPencil />} />
          <Trans>Correct</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddRowModal({
  laborCategories,
  onAdd,
  onClose
}: {
  laborCategories: { id: string; name: string }[];
  onAdd: (row: {
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetRowValidator}
          defaultValues={{
            projectId: "",
            projectElementId: "",
            laborCategoryId: laborCategories[0]?.id ?? ""
          }}
          onSubmit={(values, event) => {
            event.preventDefault();
            onAdd({
              projectId: values.projectId,
              projectElementId: values.projectElementId || null,
              laborCategoryId: values.laborCategoryId
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
              />
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

function CorrectionModal({
  entryId,
  hours,
  label,
  onClose
}: {
  entryId: string;
  hours: number;
  label: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
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
            correctionReason: ""
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
