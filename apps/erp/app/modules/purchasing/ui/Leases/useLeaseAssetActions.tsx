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
import { type LeasePurchaseOffer, leasePurchaseOffer } from "./utils";

export type LeaseAssetAction = "terminate" | "purchase";

export type LeaseAssetActionState = {
  canTerminate: boolean;
  /** How the asset can be bought — at its purchase option, or taken on the
   *  end date when ownership transfers — or null. */
  purchase: LeasePurchaseOffer | null;
};

/** What can happen to one asset of an Active lease, and the modal for it.
 *  Used by the asset's page; the rental agreement's units have the same
 *  hook in `useRentalLineActions`. */
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
      purchase: isActive ? leasePurchaseOffer(lease, line) : null
    };
  };

  const close = () => setPending(null);
  const offer = pending ? leasePurchaseOffer(lease, pending.line) : null;

  const modals =
    pending?.action === "terminate" ? (
      <LeaseTerminateModal
        lease={lease}
        line={pending.line}
        payments={payments}
        schedule={schedule}
        onClose={close}
      />
    ) : pending?.action === "purchase" && offer ? (
      <LeasePurchaseModal
        lease={lease}
        line={pending.line}
        offer={offer}
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
