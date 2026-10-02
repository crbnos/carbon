// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TimeCardEntry } from "@carbon/mes-core";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { toast } from "sonner-native";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Field } from "~/components/ui";
import { elapsedSince } from "~/features/operations/useTimer";
import { commandMessage, useClockOut } from "./commands";
import { formatClockMoment } from "./logic";
import { useDurationLabel } from "./TimecardSummary";

/**
 * Clocking out ends the day's hours, so the confirmation says what those hours
 * are: when the entry started and how long it has run. "Clock out?" on its own
 * is a question an operator cannot check.
 *
 * The note is the same optional `note` web MES's clock-out route accepts, and
 * it is here rather than behind another tap because this is the one moment
 * somebody has a reason to write one ("machine down from 2", "left early").
 * Leaving it blank sends no note at all rather than an empty string.
 *
 * The elapsed figure is read when the dialog renders and is on no timer, so it
 * does not count up under the confirm button — a number moving next to a
 * decision invites a second look at something that needs one glance.
 */
export function ClockOutDialog({
  open,
  entry,
  timeZone,
  onClose
}: {
  open: boolean;
  entry: TimeCardEntry;
  timeZone: string;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [note, setNote] = useState("");
  const clockOut = useClockOut();
  const durationLabel = useDurationLabel();

  // The DAY is shown too when the entry did not start today, so a forgotten
  // clock-out from yesterday cannot read as "Clocked in at 8:03 AM" on a
  // confirmation that is about to write eighteen hours.
  const since = formatClockMoment(
    entry.clockIn,
    timeZone,
    locale,
    today(timeZone || getLocalTimeZone()).toString()
  );
  const worked = durationLabel(elapsedSince(entry.clockIn));

  const submit = async () => {
    const trimmed = note.trim();
    try {
      await clockOut.mutateAsync(trimmed ? { note: trimmed } : {});
      setNote("");
      onClose();
      toast.success(t`Clocked out`);
    } catch (error) {
      // A 409 here means the state moved under the operator — a supervisor or
      // the auto-close shift closed this entry already. The mutation refetches
      // either way, so the screen is about to show the truth; what the
      // operator needs now is the server's own sentence, not a summary.
      toast.error(commandMessage(error, t`Could not clock out`));
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={t`Clock out?`}
      description={t`Your hours for this entry stop now.`}
      affected={[t`Clocked in at ${since}`, t`${worked} so far`]}
      confirmLabel={t`Clock Out`}
      cancelLabel={t`Cancel`}
      pending={clockOut.isPending}
      onConfirm={submit}
      onCancel={() => {
        setNote("");
        onClose();
      }}
    >
      <Field
        label={t`Note (optional)`}
        value={note}
        onChangeText={setNote}
        placeholder={t`Anything your supervisor should know`}
        returnKeyType="done"
        maxLength={200}
        accessibilityLabel={t`Note (optional)`}
      />
    </ConfirmDialog>
  );
}
