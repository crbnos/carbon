// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { Hidden, Submit, TextArea } from "~/components/Form";
import { useQuantityFormatter } from "~/hooks";
import { timesheetChangeValidator } from "../../projects.models";

export type TimesheetChangeReasons = {
  reason?: string;
  lateReason?: string;
};

/**
 * The reasons DCAA mode needs before a timesheet cell saves: a reason for a
 * change to a saved entry, and a reason for a date before the entry window.
 * `onConfirm` saves the cell and resolves true when the save succeeded; a
 * refusal keeps the modal open (the save toasts the server's message).
 */
export function TimesheetChangeModal({
  label,
  previousHours,
  hours,
  requiresReason,
  requiresLateReason,
  onConfirm,
  onCancel
}: {
  /** The charge number and date of the cell. */
  label: string;
  /** The saved hours, or null for a new entry. */
  previousHours: number | null;
  hours: number;
  requiresReason: boolean;
  requiresLateReason: boolean;
  onConfirm: (reasons: TimesheetChangeReasons) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const before = previousHours === null ? "—" : formatQuantity(previousHours);
  const after = formatQuantity(hours);

  return (
    <Modal open onOpenChange={(open) => !open && onCancel()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetChangeValidator}
          defaultValues={{ reason: "", lateReason: "" }}
          onSubmit={async (values, event) => {
            event.preventDefault();
            await onConfirm({
              reason: values.reason || undefined,
              lateReason: values.lateReason || undefined
            });
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {requiresReason ? (
                <Trans>Change Time</Trans>
              ) : (
                <Trans>Late Entry</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              {label} ·{" "}
              <span className="tabular-nums">
                {before} → {after}
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            {requiresReason && <Hidden name="requiresReason" value="on" />}
            {requiresLateReason && (
              <Hidden name="requiresLateReason" value="on" />
            )}
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                {requiresLateReason ? (
                  <Trans>
                    The date is before the entry window. The reason is kept with
                    the entry.
                  </Trans>
                ) : (
                  <Trans>
                    The change and its reason are kept in the timesheet's
                    history.
                  </Trans>
                )}
              </p>
              {requiresReason && (
                <TextArea
                  name="reason"
                  label={t`Reason for change`}
                  isRequired
                />
              )}
              {requiresLateReason && (
                <TextArea
                  name="lateReason"
                  label={t`Reason for late entry`}
                  isRequired
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
