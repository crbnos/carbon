// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  CircleCheck,
  Printer,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Wrench
} from "lucide-react-native";
import { forwardRef } from "react";
import { Sheet, type SheetHandle, SheetRow } from "~/components/BottomSheet";

/**
 * Everything the dock does not have room for, in the order web MES's floating
 * action menu lists it.
 *
 * Maintenance is DISABLED with its reason rather than left out. Raising a
 * maintenance request is a real thing an operator standing at a broken machine
 * wants, and an action that is simply missing reads as "this app cannot do my
 * job"; one that says "use Carbon MES in a browser for this" sends them
 * somewhere that works.
 *
 * Note that the quality issue and the label print are NOT gated by
 * `disabledReason`. That reason is about reporting production — a batch the
 * app cannot report, a work center down for maintenance — and neither of those
 * makes a bad part any less bad or a label any less needed. Blocking them
 * would be the app deciding an operator may not report a defect.
 */
export const MoreActionsSheet = forwardRef<
  SheetHandle,
  {
    onScrap: () => void;
    onRework: () => void;
    onFinish: () => void;
    onQualityIssue: () => void;
    onPrint: () => void;
    printing?: boolean;
    /** Null while the operation cannot be acted on (a batch, a blocked centre). */
    disabledReason?: string;
  }
>(function MoreActionsSheet(
  {
    onScrap,
    onRework,
    onFinish,
    onQualityIssue,
    onPrint,
    printing = false,
    disabledReason
  },
  ref
) {
  const { t } = useLingui();
  const blocked = Boolean(disabledReason);

  return (
    <Sheet ref={ref} title={t`More actions`}>
      <SheetRow
        icon={Trash2}
        label={t`Report scrap`}
        tone="destructive"
        onPress={onScrap}
        disabled={blocked}
        disabledReason={disabledReason}
      />
      <SheetRow
        icon={RotateCcw}
        label={t`Report rework`}
        onPress={onRework}
        disabled={blocked}
        disabledReason={disabledReason}
      />
      <SheetRow
        icon={CircleCheck}
        label={t`Finish operation`}
        onPress={onFinish}
        disabled={blocked}
        disabledReason={disabledReason}
      />
      <SheetRow
        icon={ShieldAlert}
        label={t`Raise a quality issue`}
        onPress={onQualityIssue}
      />
      <SheetRow
        icon={Printer}
        label={t`Print a label`}
        description={
          printing ? t`Sending to the printer…` : t`Sent to the shop printer`
        }
        onPress={onPrint}
        disabled={printing}
        disabledReason={printing ? t`Sending to the printer…` : undefined}
      />
      <SheetRow
        icon={Wrench}
        label={t`Maintenance request`}
        disabled
        disabledReason={t`Use Carbon MES in a browser for this.`}
      />
    </Sheet>
  );
});
