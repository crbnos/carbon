// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Textarea
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";

export type TimesheetReasons = {
  reason?: string;
  lateReason?: string;
};

/**
 * DCAA mode: the reasons a timesheet cell needs before it saves, as the
 * ERP's `TimesheetChangeModal` asks for them. A change to a saved entry
 * needs a reason; a date before the entry window needs a late reason. Save
 * stays disabled until each one is given. A refused save keeps the modal
 * open (the page toasts the server's message); Cancel reverts the cell.
 */
export function TimesheetReasonModal({
  label,
  before,
  after,
  requiresReason,
  requiresLateReason,
  isSaving,
  onConfirm,
  onCancel
}: {
  /** The charge number and date of the cell. */
  label: string;
  /** The saved hours, formatted, or "—" for a new entry. */
  before: string;
  /** The new hours, formatted. */
  after: string;
  requiresReason: boolean;
  requiresLateReason: boolean;
  isSaving: boolean;
  onConfirm: (reasons: TimesheetReasons) => void;
  onCancel: () => void;
}) {
  const reasonId = useId();
  const lateReasonId = useId();
  const [reason, setReason] = useState("");
  const [lateReason, setLateReason] = useState("");
  const isComplete =
    (!requiresReason || reason.trim() !== "") &&
    (!requiresLateReason || lateReason.trim() !== "");

  return (
    <Modal open onOpenChange={(open) => !open && !isSaving && onCancel()}>
      <ModalOverlay />
      <ModalContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!isComplete || isSaving) return;
            onConfirm({
              reason: requiresReason ? reason.trim() : undefined,
              lateReason: requiresLateReason ? lateReason.trim() : undefined
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
            <div className="flex flex-col gap-4">
              <p className="text-base text-muted-foreground">
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
                <div className="flex flex-col gap-2">
                  <Label htmlFor={reasonId} className="text-base">
                    <Trans>Reason for change</Trans>
                  </Label>
                  <Textarea
                    id={reasonId}
                    size="lg"
                    autoFocus
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
              )}
              {requiresLateReason && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={lateReasonId} className="text-base">
                    <Trans>Reason for late entry</Trans>
                  </Label>
                  <Textarea
                    id={lateReasonId}
                    size="lg"
                    autoFocus={!requiresReason}
                    required
                    value={lateReason}
                    onChange={(event) => setLateReason(event.target.value)}
                  />
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              size="lg"
              variant="secondary"
              isDisabled={isSaving}
              onClick={onCancel}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              size="lg"
              type="submit"
              isDisabled={!isComplete || isSaving}
              isLoading={isSaving}
            >
              <Trans>Save</Trans>
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
