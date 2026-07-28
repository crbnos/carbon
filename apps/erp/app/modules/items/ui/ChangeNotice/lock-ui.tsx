import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuLock } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { ChangeNoticeForItem } from "../../items.service";

// -----------------------------------------------------------------------------
// Shared Change Notice lock UI.
//
// Two surfaces freeze a card: the notice workspace (content frozen at
// Implementation) and the item master (a version the notice owns is authored in
// the notice, not here). Both read the same way because they render the same
// hint.
// -----------------------------------------------------------------------------

// Matches the lock affordance BillOfMaterial / BillOfProcess render inline, so
// every frozen card looks the same. Cards that expose a title slot use this;
// BOM/BOP take a bare `disabledReason` and wrap it themselves.
export function LockedHint({ reason }: { reason?: ReactNode }) {
  const { t } = useLingui();

  return (
    <Tooltip>
      {/* Focusable: the tooltip is the only place the lock is explained. */}
      <TooltipTrigger
        className="text-muted-foreground"
        aria-label={t`Why is this locked?`}
      >
        <LuLock className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}

export type ChangeNoticeDraftLock = {
  id: string;
  readableId: string;
};

// A Draft method still stamped with a changeOrderId is owned by that notice —
// the stamp is cleared at release, so its presence alone means "authored there".
// The number is resolved separately and may be missing; the id is not.
export function getChangeNoticeDraftLock(
  changeOrderId: string | null | undefined,
  changeNotices: ChangeNoticeForItem[] | null | undefined
): ChangeNoticeDraftLock | null {
  if (!changeOrderId) return null;
  return {
    id: changeOrderId,
    readableId:
      changeNotices?.find((cn) => cn.id === changeOrderId)?.changeOrderId ?? ""
  };
}

export function ChangeNoticeDraftLockReason({
  lock
}: {
  lock: ChangeNoticeDraftLock;
}) {
  const className = "font-medium underline underline-offset-2";

  if (!lock.readableId) {
    return (
      <Trans>
        This version belongs to an open{" "}
        <Link to={path.to.changeNotice(lock.id)} className={className}>
          change notice
        </Link>
        . Edit it there.
      </Trans>
    );
  }

  return (
    <Trans>
      This version belongs to change notice{" "}
      <Link to={path.to.changeNotice(lock.id)} className={className}>
        {lock.readableId}
      </Link>
      . Edit it there.
    </Trans>
  );
}
