// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentApprovalState } from "@carbon/ee/approvals";
import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuLock } from "react-icons/lu";
import { Link } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { canEditChangeNoticeEngineering } from "../../items.models";
import type { ChangeNoticeForItem } from "../../items.service";
import type { ChangeNotice } from "../../types";

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

// The engineering-edit lock of the open change notice workspace, read from the
// $id loader: closed, being implemented, or waiting for approval. The UI half of
// the server's getChangeNoticeEngineeringLock; `reason` is translated here
// because macros cannot run server-side.
export function useChangeNoticeEngineeringLock(changeNoticeId: string) {
  const { t } = useLingui();
  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    approval: DocumentApprovalState | null;
  }>(path.to.changeNotice(changeNoticeId));

  const status = routeData?.changeNotice?.status;
  const isPendingApproval = Boolean(routeData?.approval?.pendingRequestId);

  return {
    isDisabled: !canEditChangeNoticeEngineering(status) || isPendingApproval,
    reason: isPendingApproval
      ? t`This change notice is waiting for approval. Its changes are locked until it is approved or rejected.`
      : status === "Implementation"
        ? t`This change notice is being implemented, so its changes are locked. Reopen it to edit.`
        : t`This change notice is closed, so its changes are read-only.`
  };
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
