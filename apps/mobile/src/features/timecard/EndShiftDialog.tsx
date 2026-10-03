// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TimeCardEntry } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner-native";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { elapsedSince } from "~/features/operations/useTimer";
import { commandMessage, useEndShift } from "./commands";
import { useDurationLabel } from "./TimecardSummary";

/**
 * End shift does three things at once, so the confirmation lists all three.
 *
 * It closes every open production event — WITHOUT completing or finishing the
 * operations, which is the part web MES spells out and the part an operator
 * most needs to know — then clocks them out if the company runs time cards,
 * and on a shared tablet pins them out.
 *
 * It cannot name the individual operations: `/api/v1` has no "my running
 * operations" read, and the operations list is scoped to a location and work
 * centers rather than to a person. Rather than invent an endpoint or imply a
 * list it does not have, the dialog says plainly that every running timer
 * stops, and the operation screens are where an operator sees which.
 *
 * The sign-out line only appears when there IS a pinned operator, because that
 * is the only case the server reports `endedConsole: true` — the token drop
 * itself lives in `useEndShift`, so every future caller gets it too.
 */
export function EndShiftDialog({
  open,
  openEntry,
  operatorPinnedIn,
  onClose
}: {
  open: boolean;
  openEntry: TimeCardEntry | null;
  /** A shared terminal with somebody pinned in. */
  operatorPinnedIn: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const endShift = useEndShift();
  const durationLabel = useDurationLabel();

  const affected: string[] = [t`Every timer you have running stops`];
  if (openEntry && !openEntry.clockOut) {
    const worked = durationLabel(elapsedSince(openEntry.clockIn));
    affected.push(t`You are clocked out — ${worked} on this entry`);
  }
  if (operatorPinnedIn) {
    affected.push(t`You are signed out of this tablet`);
  }

  const submit = async () => {
    try {
      await endShift.mutateAsync();
      onClose();
      toast.success(
        operatorPinnedIn
          ? t`Shift ended. You are signed out of this tablet.`
          : t`Shift ended`
      );
    } catch (error) {
      toast.error(commandMessage(error, t`Could not end the shift`));
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={t`End shift?`}
      description={t`Your operations are left as they are — nothing is completed or finished.`}
      affected={affected}
      confirmLabel={t`End shift`}
      cancelLabel={t`Cancel`}
      tone="destructive"
      pending={endShift.isPending}
      onConfirm={submit}
      onCancel={onClose}
    />
  );
}
