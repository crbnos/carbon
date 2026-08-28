import {
  Button,
  Combobox,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { useSubmit } from "react-router";
import { DateTime } from "~/components";
import { path } from "~/utils/path";
import type { WeekOption } from "./PeopleHeader";
import { assignmentMatchesShift } from "./peopleShared";

type OvertimeAssignment = {
  employeeId: string;
  date: string;
  shiftId: string | null;
};

type OvertimeDialogProps = {
  onClose: () => void;
  range: "day" | "week";
  /** the board's selected day (day range) / the visible week's Monday */
  date: string;
  weekDates: string[];
  weekOptions: WeekOption[];
  locationId: string;
  locationTimeZone?: string;
  departmentId: string | null;
  shiftId: string | null;
  /** each person's own shift — the shift filter's fallback for shift-less rows */
  employeeShiftId: Record<string, string>;
  /** day range: the selected day's (department-filtered) assignments */
  dayAssignments: OvertimeAssignment[];
  /** week range: the visible week's (department-filtered) assignments */
  weekAssignments: OvertimeAssignment[];
};

/**
 * Bulk overtime: everyone working the selected day (or any day of the
 * selected week) stays on past their shift by the entered hours, scoped by
 * the active department/shift filters (`overtime-bulk` intent).
 */
export function OvertimeDialog({
  onClose,
  range,
  date,
  weekDates,
  weekOptions,
  locationId,
  locationTimeZone,
  departmentId,
  shiftId,
  employeeShiftId,
  dayAssignments,
  weekAssignments
}: OvertimeDialogProps) {
  const { t } = useLingui();
  const submit = useSubmit();

  const [overtimeDate, setOvertimeDate] = useState(
    range === "day" ? date : weekDates[0]
  );
  const [hoursInput, setHoursInput] = useState("2");

  // overtime is per PERSON per day, so preview distinct people — not rows
  // (a split person has several assignment rows for the same day)
  // only the week on screen is loaded, so a count for any other week would be
  // invented — the dialog says so instead of showing a wrong number
  const weekIsLoaded = overtimeDate === weekDates[0];
  const previewCount = useMemo(() => {
    // day mode has no date picker — `overtimeDate` is always the loaded day,
    // so the day rows apply as-is
    const source =
      range === "day"
        ? dayAssignments
        : weekAssignments.filter((assignment) =>
            weekDates.includes(assignment.date)
          );
    // one day = distinct people; a whole week = person-DAYS, since the same
    // person assigned Mon–Fri is five separate authorizations
    return new Set(
      source
        .filter((assignment) =>
          assignmentMatchesShift(assignment, shiftId, employeeShiftId)
        )
        .map((assignment) =>
          range === "day"
            ? assignment.employeeId
            : `${assignment.employeeId}:${assignment.date}`
        )
    ).size;
  }, [
    range,
    dayAssignments,
    weekAssignments,
    weekDates,
    shiftId,
    employeeShiftId
  ]);

  const apply = () => {
    const hours = Number(hoursInput);
    if (!Number.isFinite(hours) || hours < 0) return;
    submit(
      {
        intent: "overtime-bulk",
        locationId,
        date: overtimeDate,
        ...(range === "day"
          ? {}
          : {
              toDate: parseDate(overtimeDate).add({ days: 6 }).toString()
            }),
        hours: String(hours),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {})
      },
      {
        method: "post",
        action: path.to.priorityPeopleUpdate,
        navigate: false,
        fetcherKey: "people:overtime-bulk"
      }
    );
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Add overtime</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground text-pretty">
              {range === "day" ? (
                <Trans>
                  Everyone working this day stays on past their shift by the
                  hours you set. Only the departments and shifts you're
                  filtering by are affected.
                </Trans>
              ) : (
                <Trans>
                  Everyone working any day of the week you pick stays on past
                  their shift by the hours you set. Only the departments and
                  shifts you're filtering by are affected.
                </Trans>
              )}
            </p>
            {/* the horizon sets the unit: one visible day needs no picker, a
                week horizon picks a WEEK — the same list the header uses */}
            {range === "day" ? (
              <DateTime
                value={overtimeDate}
                variant="date"
                dateOptions={{
                  day: "2-digit",
                  month: "short",
                  year: "numeric"
                }}
                locationTimeZone={locationTimeZone}
                className="text-sm font-medium"
              />
            ) : (
              <div className="w-full">
                <Combobox
                  asButton
                  size="sm"
                  value={overtimeDate}
                  options={weekOptions.map((week) => ({
                    value: week.start,
                    label: week.isCurrent
                      ? `${week.label} · ${t`This week`}`
                      : week.label
                  }))}
                  onChange={(value) => setOvertimeDate(value || weekDates[0])}
                />
              </div>
            )}
            <Input
              type="number"
              min={0}
              max={16}
              step={0.5}
              value={hoursInput}
              onChange={(event) => setHoursInput(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {range === "day" ? (
                <Trans>
                  This will set +{hoursInput}h of overtime for {previewCount}{" "}
                  people.
                </Trans>
              ) : weekIsLoaded ? (
                // person-days, not people — the same person assigned Mon–Fri is
                // five separate authorizations
                <Trans>
                  This will set +{hoursInput}h of overtime on {previewCount}{" "}
                  person-days.
                </Trans>
              ) : (
                // that week's people isn't loaded, so any number here would be
                // invented
                <Trans>
                  This will set +{hoursInput}h of overtime for everyone assigned
                  that week.
                </Trans>
              )}
            </p>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={apply}>
              <Trans>Apply</Trans>
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
