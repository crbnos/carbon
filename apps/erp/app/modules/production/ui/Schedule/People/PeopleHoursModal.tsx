import {
  Button,
  Combobox,
  cn,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Switch,
  Textarea
} from "@carbon/react";
import { formatTimeOfDay } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { LuMinus, LuPlus, LuX } from "react-icons/lu";
import { useSubmit } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { path } from "~/utils/path";
import { formatHours } from "./peopleShared";

export type PeopleDayRowInput = {
  workCenterId: string;
  /** null = the whole shift */
  hours: number | null;
};

type DraftRow = {
  workCenterId: string;
  hours: number;
  /** original row followed the shift (hours null) and wasn't touched */
  wholeShift: boolean;
};

// Overtime lengthens the DAY, so it's one value per person per day — never
// per station. Steppers beat a number pad on a shop-floor tablet.
const OVERTIME_STEP = 0.5;
const OVERTIME_MAX = 16;

type PeopleHoursModalProps = {
  /** the chip/cell that opens the editor (uncontrolled mode) */
  trigger?: ReactElement;
  /** controlled mode — the board renders one instance for the selected card */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  employeeId: string;
  employeeName: string | null;
  date: string;
  shiftId: string | null;
  locationId: string;
  locationTimeZone?: string;
  workCenters: { id: string; name: string }[];
  /** the person's assignments for this date (empty = nothing scheduled) */
  rows: PeopleDayRowInput[];
  /** day-scoped note (stored on every row of the day) */
  note: string | null;
  /** day-scoped overtime hours (stored on every row of the day) */
  overtimeHours: number;
  /** shift-ladder hours for this person/day */
  baseHours: number;
  /** "HH:MM" start of the person's day, for the derived time echo */
  dayStartTime: string | null;
  /** "HH:MM" end of the person's shift, for the read-only shift line */
  dayEndTime: string | null;
  isAbsent: boolean;
  absenceId: string | null;
  disabled?: boolean;
};

/**
 * The person's-day editor: read-only shift line, "Not working today" toggle,
 * one row per station with hours, a derived clock-time echo (exactly the order
 * the engine deals the day out), a live allocation pill with under/over states,
 * a single day-scoped overtime stepper, the day note, and an atomic Save (one
 * `day-hours` transaction carrying rows + note + overtime).
 */
export function PeopleHoursModal({
  trigger,
  open: controlledOpen,
  onOpenChange,
  employeeId,
  employeeName,
  date,
  shiftId,
  locationId,
  locationTimeZone,
  workCenters,
  rows,
  note,
  overtimeHours,
  baseHours,
  dayStartTime,
  dayEndTime,
  isAbsent,
  absenceId,
  disabled
}: PeopleHoursModalProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const submit = useSubmit();

  const toDraft = () =>
    rows.map((row) => ({
      workCenterId: row.workCenterId,
      hours: row.hours ?? baseHours,
      wholeShift: row.hours === null
    }));

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [offDay, setOffDay] = useState(isAbsent);
  const [draft, setDraft] = useState<DraftRow[]>(toDraft);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [overtimeDraft, setOvertimeDraft] = useState(overtimeHours);
  const [adding, setAdding] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const workCenterName = useMemo(() => {
    const map = new Map(workCenters.map((wc) => [wc.id, wc.name]));
    return (id: string) => map.get(id) ?? id;
  }, [workCenters]);

  const openEditor = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setOffDay(isAbsent);
      setAdding(false);
      setConfirmingRemoval(false);
      setNoteDraft(note ?? "");
      setOvertimeDraft(overtimeHours);
      setDraft(toDraft());
    }
  };

  const totalHours = draft.reduce((sum, row) => sum + row.hours, 0);
  const overCapacity = totalHours > baseHours + 0.01;
  const underCapacity = !overCapacity && totalHours < baseHours - 0.01;

  // derived clock echo: hours dealt sequentially from the day's start —
  // display-only, and honest (it's exactly what the scheduler does)
  const timeEcho = useMemo(() => {
    if (!dayStartTime) return () => null;
    const [startHour, startMinute] = dayStartTime.split(":").map(Number);
    const startMinutes = (startHour ?? 0) * 60 + (startMinute ?? 0);
    const format = (minutes: number) =>
      formatTimeOfDay(
        `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(
          Math.round(minutes % 60)
        ).padStart(2, "0")}`,
        locale
      );
    return (index: number) => {
      let cursor = startMinutes;
      for (let i = 0; i < index; i++) {
        cursor += (draft[i]?.hours ?? 0) * 60;
      }
      const end = cursor + (draft[index]?.hours ?? 0) * 60;
      return `${format(cursor)} – ${format(end)}`;
    };
  }, [dayStartTime, draft, locale]);

  const updateRow = (index: number, patch: Partial<DraftRow>) => {
    setConfirmingRemoval(false);
    setDraft((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const addStation = (workCenterId: string) => {
    const remainder = Math.max(
      0.5,
      Math.round((baseHours - totalHours) * 2) / 2
    );
    setConfirmingRemoval(false);
    setDraft((current) => [
      ...current,
      { workCenterId, hours: remainder, wholeShift: false }
    ]);
    setAdding(false);
  };

  const adjustOvertime = (delta: number) => {
    setOvertimeDraft((current) =>
      Math.min(OVERTIME_MAX, Math.max(0, Math.round((current + delta) * 2) / 2))
    );
  };

  const submitIntent = (payload: Record<string, string>) => {
    submit(payload, {
      method: "post",
      action: path.to.priorityPeopleUpdate,
      navigate: false,
      fetcherKey: `people:${employeeId}`
    });
  };

  const save = () => {
    if (offDay !== isAbsent) {
      if (offDay) {
        submitIntent({
          intent: "absent",
          employeeId,
          date,
          ...(shiftId ? { shiftId } : {})
        });
      } else if (absenceId) {
        submitIntent({ intent: "clear-absence", id: absenceId, date });
      }
    }
    if (!offDay) {
      const nextRows: PeopleDayRowInput[] = draft
        .filter((row) => row.hours > 0)
        .map((row) => ({
          workCenterId: row.workCenterId,
          hours: row.wholeShift ? null : row.hours
        }));
      const rowsChanged =
        nextRows.length !== rows.length ||
        nextRows.some(
          (row, i) =>
            rows[i]?.workCenterId !== row.workCenterId ||
            (rows[i]?.hours ?? null) !== row.hours
        );
      const noteValue = noteDraft.trim();
      const noteChanged = (noteValue || null) !== (note ?? null);
      const overtimeChanged = overtimeDraft !== overtimeHours;
      // removing the last row takes the person off the board — confirm first
      if (rows.length > 0 && nextRows.length === 0 && !confirmingRemoval) {
        setConfirmingRemoval(true);
        return;
      }
      if (rowsChanged || noteChanged || overtimeChanged) {
        submitIntent({
          intent: "day-hours",
          employeeId,
          locationId,
          date,
          note: noteValue,
          overtimeHours: String(overtimeDraft),
          ...(shiftId ? { shiftId } : {}),
          rows: JSON.stringify(nextRows)
        });
      }
    }
    setOpen(false);
  };

  const availableStations = workCenters.filter(
    (workCenter) => !draft.some((row) => row.workCenterId === workCenter.id)
  );

  const dayLabel = (
    <DateTime
      value={date}
      variant="date"
      dateOptions={{ weekday: "short", month: "short", day: "numeric" }}
      locationTimeZone={locationTimeZone}
    />
  );

  const shiftWindow =
    dayStartTime && dayEndTime
      ? `${formatTimeOfDay(dayStartTime, locale)} – ${formatTimeOfDay(dayEndTime, locale)}`
      : null;

  const removingLastRow =
    rows.length > 0 && draft.filter((row) => row.hours > 0).length === 0;

  if (disabled) return trigger ?? null;

  return (
    <Modal open={open} onOpenChange={openEditor}>
      {trigger && <ModalTrigger asChild>{trigger}</ModalTrigger>}
      <ModalContent size="small">
        <ModalHeader className="mb-0 pb-4">
          <div className="flex items-center gap-3">
            <EmployeeAvatar
              employeeId={employeeId}
              withName={false}
              size="sm"
            />
            <div className="min-w-0">
              <ModalTitle className="text-[15px] font-medium truncate">
                {employeeName}
              </ModalTitle>
              <p className="text-xs text-muted-foreground">{dayLabel}</p>
            </div>
          </div>
        </ModalHeader>
        <ModalBody className="px-0 mb-0">
          <div className="divide-y divide-border/60 border-t border-border/60">
            <section className="flex items-center justify-between px-6 py-3.5">
              <span className="text-[13px] text-muted-foreground">
                <Trans>Shift</Trans>
              </span>
              <span className="text-[15px] tabular-nums">
                {shiftWindow ? `${shiftWindow} · ` : ""}
                {formatHours(baseHours)}h
              </span>
            </section>

            <section>
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between px-6 py-2 text-left"
                onClick={() => setOffDay((value) => !value)}
              >
                <span className="text-[15px]">
                  <Trans>Not working today</Trans>
                </span>
                <Switch
                  checked={offDay}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={setOffDay}
                />
              </button>
            </section>

            <section
              className={cn(
                "flex flex-col gap-2 px-6 py-3.5",
                offDay && "pointer-events-none opacity-40"
              )}
            >
              {draft.length > 0 && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="flex-1">
                    <Trans>Station</Trans>
                  </span>
                  <span className="w-20 text-center">
                    <Trans>Hours</Trans>
                  </span>
                  <span className="w-9" />
                </div>
              )}
              {draft.map((row, index) => (
                <div key={row.workCenterId} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">
                      {workCenterName(row.workCenterId)}
                    </p>
                    {timeEcho(index) && (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {timeEcho(index)}
                      </p>
                    )}
                  </div>
                  <Input
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    aria-label={t`Hours`}
                    value={row.hours}
                    className="h-11 w-20 text-center tabular-nums"
                    onChange={(event) =>
                      updateRow(index, {
                        hours: Number(event.target.value) || 0,
                        wholeShift: false
                      })
                    }
                  />
                  <IconButton
                    aria-label={t`Remove station`}
                    variant="ghost"
                    className="h-11 w-9 text-red-600 hover:text-red-700 dark:text-red-400"
                    icon={<LuX />}
                    onClick={() => {
                      setConfirmingRemoval(false);
                      setDraft((current) =>
                        current.filter((_, i) => i !== index)
                      );
                    }}
                  />
                </div>
              ))}

              {draft.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  <Trans>Nothing scheduled — add a station below.</Trans>
                </p>
              )}

              {adding ? (
                <Combobox
                  asButton
                  value=""
                  placeholder={t`Select station`}
                  options={availableStations.map((workCenter) => ({
                    value: workCenter.id,
                    label: workCenter.name
                  }))}
                  onChange={(value) => value && addStation(value)}
                />
              ) : (
                availableStations.length > 0 && (
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setAdding(true)}
                  >
                    <LuPlus className="h-3.5 w-3.5" />
                    <Trans>Add station</Trans>
                  </button>
                )
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[13px] text-muted-foreground">
                  <Trans>Allocated</Trans>
                </span>
                {offDay ? (
                  <span className="inline-flex items-center rounded-xl bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Trans>Day off</Trans>
                  </span>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-xl px-2.5 py-1 text-xs font-medium tabular-nums",
                      overCapacity &&
                        "bg-red-500/15 text-red-700 dark:text-red-400",
                      underCapacity &&
                        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                      !overCapacity &&
                        !underCapacity &&
                        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {formatHours(totalHours)}h{" "}
                    <Trans>of {formatHours(baseHours)}h</Trans>
                  </span>
                )}
              </div>
              {overCapacity && !offDay && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  <Trans>More hours than the shift has.</Trans>
                </p>
              )}
            </section>

            {/* Overtime is per DAY, not per station — one control for the
                whole day, hidden until it's actually needed */}
            <section
              className={cn(
                "flex min-h-[52px] items-center justify-between gap-3 px-6 py-2.5",
                offDay && "pointer-events-none opacity-40"
              )}
            >
              <div className="min-w-0">
                <p className="text-[15px]">
                  <Trans>Overtime</Trans>
                </p>
                <p className="text-xs text-muted-foreground">
                  <Trans>Extra hours on the whole day</Trans>
                </p>
              </div>
              {overtimeDraft > 0 ? (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <IconButton
                    aria-label={t`Less overtime`}
                    variant="secondary"
                    className="h-11 w-11"
                    icon={<LuMinus />}
                    onClick={() => adjustOvertime(-OVERTIME_STEP)}
                  />
                  <span className="inline-flex min-w-[52px] justify-center rounded-xl bg-amber-500/15 px-2 py-1 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400">
                    +{formatHours(overtimeDraft)}h
                  </span>
                  <IconButton
                    aria-label={t`More overtime`}
                    variant="secondary"
                    className="h-11 w-11"
                    isDisabled={overtimeDraft >= OVERTIME_MAX}
                    icon={<LuPlus />}
                    onClick={() => adjustOvertime(OVERTIME_STEP)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => adjustOvertime(1)}
                >
                  <LuPlus className="h-3.5 w-3.5" />
                  <Trans>Add overtime</Trans>
                </button>
              )}
            </section>

            <section className="flex flex-col gap-1.5 px-6 py-3.5">
              <span className="text-[13px] text-muted-foreground">
                <Trans>Note</Trans>
              </span>
              <Textarea
                value={noteDraft}
                rows={2}
                placeholder={t`Anything the people should know`}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </section>

            {confirmingRemoval && (
              <section className="px-6 py-3">
                <p className="text-[13px] text-red-600 dark:text-red-400">
                  <Trans>
                    This takes {employeeName} off the board for the day. Save
                    again to confirm.
                  </Trans>
                </p>
              </section>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="sm:justify-stretch">
          <Button
            variant="secondary"
            className="h-11 flex-1"
            onClick={() => setOpen(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button className="h-11 flex-1" onClick={save}>
            {confirmingRemoval && removingLastRow && !offDay ? (
              <Trans>Remove from board</Trans>
            ) : (
              <Trans>Save</Trans>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
