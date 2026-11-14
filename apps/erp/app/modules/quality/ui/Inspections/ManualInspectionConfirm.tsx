// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";

export type ManualInspectionAction = "cancel" | "delete";

type ManualInspectionLot = {
  id: string;
  inspectionId: string | null;
  sourceDocument: string;
  status: string;
};

const CLOSED_STATUSES = ["Passed", "Failed", "Partial", "Cancelled"];

/** A manual lot that is still open can be cancelled. */
export function canCancelInspection(lot: ManualInspectionLot) {
  return (
    lot.sourceDocument === "Manual" && !CLOSED_STATUSES.includes(lot.status)
  );
}

/**
 * A manual lot that recorded no verdict can be deleted. The server also
 * refuses a lot with a reading, a gauge or a linked issue.
 */
export function canDeleteInspection(
  lot: ManualInspectionLot,
  samples: { status: string }[]
) {
  return (
    canCancelInspection(lot) && samples.every((s) => s.status === "Pending")
  );
}

// The confirmation for a manual inspection's Cancel or Delete.
export function ManualInspectionConfirm({
  action,
  lot,
  onClose
}: {
  action: ManualInspectionAction;
  lot: ManualInspectionLot;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const name = lot.inspectionId ?? t`this inspection`;

  if (action === "delete") {
    return (
      <ConfirmDelete
        isOpen
        action={path.to.inspectionDelete(lot.id)}
        name={name}
        text={t`The inspection is deleted and its tracked entities return to the status they had before it.`}
        onCancel={onClose}
        onSubmit={onClose}
      />
    );
  }

  return (
    <Confirm
      action={path.to.inspectionCancel(lot.id)}
      title={t`Cancel ${name}?`}
      text={t`The inspection leaves the shop floor with no verdict. What it recorded is kept, and its held tracked entities return to the status they had before it.`}
      confirmText={t`Cancel Inspection`}
      confirmVariant="destructive"
      onCancel={onClose}
      onSubmit={onClose}
    />
  );
}
