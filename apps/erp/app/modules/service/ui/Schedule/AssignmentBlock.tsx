// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { formatDate, INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { KeyboardEvent } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { Hidden, Number, Submit, TextArea } from "~/components/Form";
import { formatHours } from "~/modules/production/ui/Schedule/People/peopleShared";
import { path } from "~/utils/path";
import { serviceJobAssignmentValidator } from "../../service.models";
import type { ScheduleAssignment } from "./ServiceSchedule";

// A block sits inside a draggable chip, which starts a keyboard drag on Enter
// or Space. The block's own button opens the modal instead.
const keepKeysFromDrag = (event: KeyboardEvent) => event.stopPropagation();

type AssignmentBlockProps = {
  assignment: ScheduleAssignment;
  /** The job is Completed, Invoiced or Cancelled: shown, never moved. */
  isLocked?: boolean;
  /** Opens the block's modal; absent for the drag overlay. */
  onOpen?: () => void;
  className?: string;
};

/** One technician's day on one job: the job, its customer, the planned hours. */
export function AssignmentBlock({
  assignment,
  isLocked = false,
  onOpen,
  className
}: AssignmentBlockProps) {
  const content = (
    <>
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="whitespace-nowrap font-medium">
          {assignment.jobReadableId}
        </span>
        {assignment.plannedHours !== null && (
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {formatHours(assignment.plannedHours)}h
          </span>
        )}
      </span>
      {assignment.customerName && (
        <span className="w-full truncate text-muted-foreground">
          {assignment.customerName}
        </span>
      )}
    </>
  );
  const classes = cn(
    "flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md bg-card px-2 py-1 text-left text-xs ring-1 ring-inset ring-border",
    isLocked && "opacity-60",
    onOpen && "transition-colors hover:bg-muted/60",
    className
  );

  if (!onOpen) return <span className={classes}>{content}</span>;
  return (
    <button
      type="button"
      className={classes}
      onClick={onOpen}
      onKeyDown={keepKeysFromDrag}
    >
      {content}
    </button>
  );
}

type AssignmentModalProps = {
  assignment: ScheduleAssignment;
  employeeName: string | null;
  isDisabled: boolean;
  onClose: () => void;
};

/**
 * Edit a block's planned hours and note. Saves through the grid's `assign`
 * intent with the assignment's id.
 */
export function AssignmentModal({
  assignment,
  employeeName,
  isDisabled,
  onClose
}: AssignmentModalProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const fetcher = useAction({ onSuccess: onClose });
  const day = formatDate(
    assignment.date,
    { weekday: "long", month: "short", day: "numeric" },
    locale
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.serviceScheduleUpdate}
          validator={serviceJobAssignmentValidator}
          defaultValues={{
            id: assignment.id,
            serviceJobId: assignment.serviceJobId,
            employeeId: assignment.employeeId,
            scheduledDate: assignment.date,
            plannedHours: assignment.plannedHours ?? undefined,
            note: assignment.note ?? ""
          }}
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <ModalHeader>
            <ModalTitle>{assignment.jobReadableId}</ModalTitle>
            <ModalDescription>
              {[assignment.customerName, employeeName, day]
                .filter(Boolean)
                .join(" · ")}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="assign" />
            <Hidden name="id" />
            <Hidden name="serviceJobId" />
            <Hidden name="employeeId" />
            <Hidden name="scheduledDate" />
            <VStack spacing={4}>
              <Number
                name="plannedHours"
                label={t`Planned Hours`}
                minValue={0}
                maxValue={24}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <TextArea name="note" label={t`Note`} rows={3} />
              <Link
                to={path.to.serviceJob(assignment.serviceJobId)}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                <Trans>Open job</Trans>
                <LuExternalLink className="size-3.5" />
              </Link>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={isDisabled || fetcher.state !== "idle"}
              withBlocker={false}
            >
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
