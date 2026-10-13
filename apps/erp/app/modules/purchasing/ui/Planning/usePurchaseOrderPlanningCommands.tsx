// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { DropdownMenuIcon, DropdownMenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCheckCheck, LuGitBranchPlus, LuLoaderCircle } from "react-icons/lu";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { usePermissions } from "~/hooks";
import type { PlanningPurchaseOrder } from "~/modules/production/ui/Planning/planning-review";
import { purchaseOrderPlanningMenu } from "~/modules/production/ui/Planning/planning-review";
import type { loader as finalizeDefaultsLoader } from "~/routes/api+/purchasing.purchase-order.$id.finalize";
import { path } from "~/utils/path";
import { isPurchaseOrderLocked } from "../../purchasing.models";
import PurchaseOrderFinalizeModal from "../PurchaseOrder/PurchaseOrderFinalizeModal";

/**
 * The purchasing planning page's commands on a purchase order itself, offered
 * in the ⋯ menu of every row that names one (the expanded action lines and the
 * order drawer's Open Orders):
 *
 *   Reopen / Reopen as Revision — a PO planning cannot change (in approval or
 *     sent) goes back to PLANNED, not Draft: Draft is not MRP supply, so its
 *     lines would leave the plan and the next run would suggest them again as
 *     a new order. Planned is also what planning may change, so the row's
 *     action turns from Review to Apply as soon as the page reloads.
 *   Finalize — a Draft / Planned PO, through the PO page's own modal.
 *
 * Both post to the purchase order's own routes, which hold the permissions,
 * the approval rules and the revision bump; they redirect back here.
 */
export function usePurchaseOrderPlanningCommands(): {
  purchaseOrderMenuItems: (order: PlanningPurchaseOrder) => ReactNode;
  /** Opens the Finalize modal for a PO — a Release action's button. */
  finalizePurchaseOrder: (purchaseOrderId: string) => void;
  purchaseOrderDialogs: ReactNode;
  /** Bumped each time a command settles, so lists read from the database
   *  (the drawer's open orders) re-read. */
  ordersVersion: number;
} {
  const { t } = useLingui();
  const permissions = usePermissions();
  const statusFetcher = useFetcher();
  const finalizeFetcher = useFetcher();
  const [revisionOrder, setRevisionOrder] =
    useState<PlanningPurchaseOrder | null>(null);
  const [finalizeOrderId, setFinalizeOrderId] = useState<string | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);

  const isBusy =
    statusFetcher.state !== "idle" || finalizeFetcher.state !== "idle";

  // Once per settled command, not per state change.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (isBusy) {
      wasBusy.current = true;
    } else if (wasBusy.current) {
      wasBusy.current = false;
      setOrdersVersion((version) => version + 1);
    }
  }, [isBusy]);

  const reopen = useCallback(
    (purchaseOrderId: string) => {
      statusFetcher.submit(
        { status: "Planned" },
        {
          method: "post",
          action: path.to.purchaseOrderStatus(purchaseOrderId)
        }
      );
    },
    [statusFetcher.submit]
  );

  const canUpdate = permissions.can("update", "purchasing");
  const canDelete = permissions.can("delete", "purchasing");
  const canCreate = permissions.can("create", "purchasing");

  const purchaseOrderMenuItems = useCallback(
    (order: PlanningPurchaseOrder) => {
      const menu = purchaseOrderPlanningMenu(order);
      if (!menu.canReopen && !menu.canFinalize) return null;
      // the status route's rule: reopening a SENT order needs delete
      const mayReopen = isPurchaseOrderLocked(order.status)
        ? canDelete
        : canUpdate;
      return (
        <>
          {menu.canReopen && (
            <DropdownMenuItem
              disabled={isBusy || !mayReopen}
              onSelect={() => reopen(order.id)}
            >
              <DropdownMenuIcon icon={<LuLoaderCircle />} />
              <Trans>Reopen</Trans>
            </DropdownMenuItem>
          )}
          {menu.canReopenAsRevision && (
            <DropdownMenuItem
              disabled={isBusy || !canDelete}
              onSelect={() => setRevisionOrder(order)}
            >
              <DropdownMenuIcon icon={<LuGitBranchPlus />} />
              <Trans>Reopen as Revision</Trans>
            </DropdownMenuItem>
          )}
          {menu.canFinalize && (
            <DropdownMenuItem
              disabled={isBusy || !canCreate}
              onSelect={() => setFinalizeOrderId(order.id)}
            >
              <DropdownMenuIcon icon={<LuCheckCheck />} />
              <Trans>Finalize</Trans>
            </DropdownMenuItem>
          )}
        </>
      );
    },
    [isBusy, reopen, canUpdate, canDelete, canCreate]
  );

  const revisionLabel = revisionOrder?.readableId ?? t`The purchase order`;
  const purchaseOrderDialogs = (
    <>
      {revisionOrder && (
        <Confirm
          action={path.to.purchaseOrderStatus(revisionOrder.id)}
          title={t`Reopen as Revision`}
          text={t`${revisionLabel} will be reopened for planning as its next revision. The document already sent to the supplier is unchanged until you finalize and resend the order.`}
          confirmText={t`Create Revision`}
          onCancel={() => setRevisionOrder(null)}
          onSubmit={() => {
            setRevisionOrder(null);
            setOrdersVersion((version) => version + 1);
          }}
        >
          <input type="hidden" name="status" value="Planned" />
          <input type="hidden" name="createRevision" value="true" />
        </Confirm>
      )}
      {finalizeOrderId && (
        <PlanningFinalizeModal
          purchaseOrderId={finalizeOrderId}
          fetcher={finalizeFetcher}
          onClose={() => setFinalizeOrderId(null)}
        />
      )}
    </>
  );

  return {
    purchaseOrderMenuItems,
    finalizePurchaseOrder: setFinalizeOrderId,
    purchaseOrderDialogs,
    ordersVersion
  };
}

/** The PO page's finalize modal, with the order and default CC it reads from
 *  that page's loader fetched instead. */
function PlanningFinalizeModal({
  purchaseOrderId,
  fetcher,
  onClose
}: {
  purchaseOrderId: string;
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
}) {
  const defaults = useLoaderQuery<typeof finalizeDefaultsLoader>(
    path.to.api.purchaseOrderFinalize(purchaseOrderId)
  );
  // The modal seeds its form from these on mount: wait for them.
  if (!defaults.data?.purchaseOrder) return null;
  return (
    <PurchaseOrderFinalizeModal
      purchaseOrderId={purchaseOrderId}
      purchaseOrder={defaults.data.purchaseOrder}
      defaultCc={defaults.data.defaultCc}
      fetcher={fetcher}
      onClose={onClose}
    />
  );
}
