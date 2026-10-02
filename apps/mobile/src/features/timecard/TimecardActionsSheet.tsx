// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { CircleStop, Pencil } from "lucide-react-native";
import { forwardRef } from "react";
import { Sheet, type SheetHandle, SheetRow } from "~/components/BottomSheet";

/**
 * The secondary actions, in a sheet — there is no right-click on a tablet and
 * nothing may be revealed on hover.
 *
 * End shift is here rather than on the screen on purpose: the dock holds
 * exactly one dominant action, and an operator reaching for Clock out must not
 * find a button next to it that also closes every running timer. It is red
 * because that is what the colour means here; nothing else in the sheet
 * competes for it.
 *
 * Editing an entry is DISABLED with its reason rather than left out. A
 * mistyped clock-in is a real thing somebody needs fixed, and a row that is
 * simply absent reads as "this app cannot do my job"; one that points at the
 * browser sends them somewhere that works. Editing and deleting entries are
 * deliberately web-only (`commands.timecard.server.ts`), so there is nothing
 * to call here even if the row were enabled.
 */
export const TimecardActionsSheet = forwardRef<
  SheetHandle,
  { onEndShift: () => void }
>(function TimecardActionsSheet({ onEndShift }, ref) {
  const { t } = useLingui();

  return (
    <Sheet ref={ref} title={t`More actions`}>
      <SheetRow
        icon={CircleStop}
        label={t`End shift`}
        description={t`Stops every running timer and clocks you out`}
        tone="destructive"
        onPress={onEndShift}
      />
      <SheetRow
        icon={Pencil}
        label={t`Edit an entry`}
        disabled
        disabledReason={t`Use Carbon MES in a browser for this.`}
      />
    </Sheet>
  );
});
