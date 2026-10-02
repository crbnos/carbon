// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner-native";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { commandMessage, useFinishOperation } from "./commands";
import {
  type EventIds,
  eventIdsFrom,
  type OpenEvents,
  WORK_TYPES,
  type WorkType
} from "./logic";
import { elapsedSince, formatElapsed } from "./useTimer";

/**
 * Finishing an operation closes every open timer and takes the operation off
 * the floor, so the confirmation names what that means for THIS operation:
 * each running timer with its elapsed time, and the quantity still outstanding
 * if there is one.
 *
 * The outstanding quantity is the part worth reading twice. Finishing with 12
 * of 40 made is legitimate — a short run, a cancelled remainder — but it is
 * also what a mis-tap looks like, and the operator is the only one who can
 * tell the difference.
 */
export function FinishDialog({
  open,
  detail,
  openEvents,
  onClose
}: {
  open: boolean;
  detail: OperationDetail;
  openEvents: OpenEvents;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const finish = useFinishOperation(detail.operation.id);
  const eventIds: EventIds = eventIdsFrom(openEvents);

  const labels: Record<WorkType, string> = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  };

  const affected: string[] = [];
  for (const type of WORK_TYPES) {
    const event = openEvents[type];
    if (event?.startTime) {
      affected.push(
        `${labels[type]} — ${formatElapsed(elapsedSince(event.startTime))}`
      );
    }
  }

  const target = detail.operation.operationQuantity ?? 0;
  const done = detail.operation.quantityComplete ?? 0;
  if (target > done) {
    affected.push(
      t`${formatQuantity(target - done, locale)} of ${formatQuantity(target, locale)} will not be made`
    );
  }

  const submit = async () => {
    try {
      await finish.mutateAsync(eventIds);
      onClose();
      toast.success(t`Operation finished`);
    } catch (error) {
      // A 409 here is a real rule refusing it — an unissued material, an
      // inspection still open. The server's own words are what the operator
      // needs, so they are shown verbatim rather than summarised.
      toast.error(commandMessage(error, t`Could not finish the operation`));
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={t`Finish this operation?`}
      description={
        affected.length
          ? t`This takes it off the floor.`
          : t`This takes it off the floor. Nothing is running.`
      }
      affected={affected}
      confirmLabel={t`Finish`}
      cancelLabel={t`Cancel`}
      pending={finish.isPending}
      onConfirm={submit}
      onCancel={onClose}
    />
  );
}
