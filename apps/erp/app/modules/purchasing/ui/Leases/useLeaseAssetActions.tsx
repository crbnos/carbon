// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useState } from "react";
import { usePermissions } from "~/hooks";
import LeasePurchaseModal from "./LeasePurchaseModal";
import LeaseTerminateModal from "./LeaseTerminateModal";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { isScheduleLinePosted } from "./utils";

export type LeaseAssetAction = "terminate" | "purchase";

export type LeaseAssetActionState = {
  canTerminate: boolean;
  canPurchase: boolean;
};

/** What can happen to one asset of an Active lease, and the modal for it.
 *  Shared by the explorer row and the asset's page, as the rental
 *  agreement's units share `useRentalLineActions`. */
export function useLeaseAssetActions({
  lease,
  payments,
  schedule
}: {
  lease: Lease;
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
}) {
  const permissions = usePermissions();
  const [pending, setPending] = useState<{
    action: LeaseAssetAction;
    line: LeaseLine;
  } | null>(null);

  const canChange =
    lease.status === "Active" && permissions.can("update", "purchasing");

  const stateOf = (line: LeaseLine): LeaseAssetActionState => {
    const isActive = canChange && line.status === "Active";
    return {
      canTerminate: isActive,
      // An open-ended or short-term asset has no purchase option to exercise.
      canPurchase:
        isActive &&
        !!lease.endDate &&
        Number(line.purchaseOptionAmount ?? 0) > 0 &&
        line.lesseeClassification !== "Short-Term"
    };
  };

  const close = () => setPending(null);

  const modals =
    pending?.action === "terminate" ? (
      <LeaseTerminateModal
        lease={lease}
        line={pending.line}
        payments={payments}
        schedule={schedule}
        onClose={close}
      />
    ) : pending?.action === "purchase" ? (
      <LeasePurchaseModal
        lease={lease}
        line={pending.line}
        payments={payments}
        schedule={schedule}
        onClose={close}
      />
    ) : null;

  return {
    stateOf,
    open: (action: LeaseAssetAction, line: LeaseLine) =>
      setPending({ action, line }),
    modals
  };
}

/** The asset's lease liability after its last posted month: null once it
 *  has ended, and for a short-term asset, which is never on the balance
 *  sheet. */
export function leaseAssetLiability(
  line: LeaseLine,
  schedule: LeaseScheduleLine[]
) {
  if (
    line.status !== "Active" ||
    !line.lesseeClassification ||
    line.lesseeClassification === "Short-Term"
  ) {
    return null;
  }
  let last: LeaseScheduleLine | undefined;
  for (const row of schedule) {
    if (row.leaseLineId !== line.id) continue;
    if (!isScheduleLinePosted(row)) break;
    last = row;
  }
  return last
    ? Number(last.closingLiability)
    : Number(line.initialLiability ?? 0);
}
