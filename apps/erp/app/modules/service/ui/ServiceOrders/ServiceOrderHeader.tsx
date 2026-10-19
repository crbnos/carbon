// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuCircleCheck,
  LuCircleStop,
  LuFileText,
  LuLock,
  LuPause,
  LuPlay,
  LuPrinter,
  LuRotateCcw,
  LuServer,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import DetailTopbar from "~/components/Layout/Navigation/DetailsTopbar";
import { RecordHeader } from "~/components/Layout/RecordHeader";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { ServiceOrderStatusAction } from "../../service.models";
import { canMoveServiceOrder, isReadyToShipBack } from "../../service.models";
import type { ServiceOrder } from "../../types";
import {
  CustomerAssetStatus,
  ServiceOrderStatus,
  WarrantyBadge
} from "../ServiceStatus";
import CompleteRefurbishmentModal from "./CompleteRefurbishmentModal";
import { useServiceOrderNavigation } from "./useServiceOrderNavigation";

/**
 * The order's header strip, as the project header: identity and status on
 * the left; the route tabs, the copy button and the ⋯ menu at the right
 * end. There is no primary button (Brad, 2026-10-13): the menu opens with
 * the status transitions, the next step first (Complete when it applies),
 * then the links. Every move posts to the status route, which checks the
 * move again.
 */
const ServiceOrderHeader = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { toggleProperties } = usePanels();
  const routeData = useRouteData<{
    serviceOrder: ServiceOrder;
    unbilledCount: number;
  }>(path.to.serviceOrder(id));
  if (!routeData?.serviceOrder) {
    throw new Error("Failed to load service order");
  }

  const order = routeData.serviceOrder;
  const status = order.status;
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const canInvoice = canUpdate && permissions.can("create", "invoicing");
  const unbilledCount = routeData.unbilledCount ?? 0;
  const navigation = useServiceOrderNavigation();

  const statusFetcher = useFetcher<{ success: boolean }>();
  const isMoving = statusFetcher.state !== "idle";
  const move = (to: ServiceOrderStatusAction) =>
    statusFetcher.submit(
      { status: to },
      { method: "post", action: path.to.serviceOrderStatus(id) }
    );
  const can = (to: ServiceOrderStatusAction) =>
    canUpdate && !isMoving && canMoveServiceOrder(status, to);

  const completeDisclosure = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const closeDisclosure = useDisclosure();
  const invoiceDisclosure = useDisclosure();

  const isOpen =
    status === "Draft" ||
    status === "Planned" ||
    status === "Scheduled" ||
    status === "In Progress";

  // A Depot Repair order is worked in the shop: it needs no visit to
  // complete, and its unit ships back from the RMA it came in on.
  const isDepotRepair = order.type === "Depot Repair";
  // A refurbishment is worked in the shop too; its Complete moves the cost
  // into the serial, so it shows a preview first and never reopens.
  const isRefurbishment = order.type === "Refurbishment";
  const returnOrder = order.salesReturnOrderLine?.salesReturnOrder ?? null;
  const canShipBack = isDepotRepair && isReadyToShipBack(order);

  // The next step first: Mark as Planned on a Draft order (its parts become
  // MRP demand and it takes charges), Complete on an open order, Resume on
  // hold, then Create Invoice or Close on a completed one.
  const transitions = (
    <>
      {status === "Draft" && (
        <DropdownMenuItem
          disabled={!can("Planned")}
          onClick={() => move("Planned")}
        >
          <DropdownMenuIcon icon={<LuCheckCheck />} />
          <Trans>Mark as Planned</Trans>
        </DropdownMenuItem>
      )}
      {isOpen && (
        <DropdownMenuItem
          disabled={!can("Completed")}
          onClick={completeDisclosure.onOpen}
        >
          <DropdownMenuIcon icon={<LuCircleCheck />} />
          <Trans>Complete</Trans>
        </DropdownMenuItem>
      )}
      {status === "On Hold" && (
        <DropdownMenuItem
          disabled={!can("Planned")}
          onClick={() => move("Planned")}
        >
          <DropdownMenuIcon icon={<LuPlay />} />
          <Trans>Resume</Trans>
        </DropdownMenuItem>
      )}
      {status === "Completed" && unbilledCount > 0 && (
        <DropdownMenuItem
          disabled={!canInvoice || isMoving}
          onClick={invoiceDisclosure.onOpen}
        >
          <DropdownMenuIcon icon={<LuFileText />} />
          <Trans>Create Invoice</Trans>
        </DropdownMenuItem>
      )}
      {status === "Completed" && unbilledCount === 0 && (
        <DropdownMenuItem
          disabled={!can("Closed")}
          onClick={closeDisclosure.onOpen}
        >
          <DropdownMenuIcon icon={<LuLock />} />
          <Trans>Close</Trans>
        </DropdownMenuItem>
      )}
      {canShipBack && returnOrder && (
        <DropdownMenuItem asChild>
          <Link to={path.to.salesReturnOrderDetails(returnOrder.id)}>
            <DropdownMenuIcon icon={<LuTruck />} />
            <Trans>Ship Back</Trans>
          </Link>
        </DropdownMenuItem>
      )}
      {isOpen && (
        <DropdownMenuItem
          disabled={!can("On Hold")}
          onClick={() => move("On Hold")}
        >
          <DropdownMenuIcon icon={<LuPause />} />
          <Trans>Put on Hold</Trans>
        </DropdownMenuItem>
      )}
      {status === "Completed" && !isRefurbishment && (
        <DropdownMenuItem
          disabled={!can("Planned")}
          onClick={() => move("Planned")}
        >
          <DropdownMenuIcon icon={<LuRotateCcw />} />
          <Trans>Reopen</Trans>
        </DropdownMenuItem>
      )}
      {(isOpen || status === "On Hold") && (
        <DropdownMenuItem
          destructive
          disabled={!can("Cancelled")}
          onClick={cancelDisclosure.onOpen}
        >
          <DropdownMenuIcon icon={<LuCircleStop />} />
          <Trans>Cancel</Trans>
        </DropdownMenuItem>
      )}
    </>
  );
  const hasTransitions =
    isOpen || status === "On Hold" || status === "Completed" || canShipBack;

  const menu = (
    <>
      {transitions}
      {hasTransitions && <DropdownMenuSeparator />}
      {order.customerAssetId && (
        <DropdownMenuItem asChild>
          <Link to={path.to.customerAsset(order.customerAssetId)}>
            <DropdownMenuIcon icon={<LuServer />} />
            <Trans>View Unit</Trans>
          </Link>
        </DropdownMenuItem>
      )}
      {returnOrder && (
        <DropdownMenuItem asChild>
          <Link to={path.to.salesReturnOrderDetails(returnOrder.id)}>
            <DropdownMenuIcon icon={<LuUndo2 />} />
            <Trans>View Return Order</Trans>
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <a
          href={path.to.serviceOrderEstimate(id)}
          target="_blank"
          rel="noreferrer"
        >
          <DropdownMenuIcon icon={<LuPrinter />} />
          <Trans>Print Estimate</Trans>
        </a>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={
          <span className="whitespace-nowrap">{order.serviceOrderId}</span>
        }
        titleTo={path.to.serviceOrderDetails(id)}
        copyValue={order.serviceOrderId}
        menu={menu}
        status={
          <>
            <ServiceOrderStatus status={status} />
            {isDepotRepair && order.customerAsset?.status === "At Depot" && (
              <CustomerAssetStatus status="At Depot" />
            )}
            {order.customerAsset && (
              <WarrantyBadge asset={order.customerAsset} />
            )}
            {returnOrder && (
              <Link
                to={path.to.salesReturnOrderDetails(returnOrder.id)}
                className="whitespace-nowrap text-sm text-muted-foreground hover:text-foreground"
              >
                {returnOrder.salesReturnOrderId}
              </Link>
            )}
          </>
        }
        aside={
          navigation.length > 1 ? <DetailTopbar links={navigation} /> : null
        }
        onToggleProperties={toggleProperties}
        toolsPlacement="end"
      />

      {completeDisclosure.isOpen && isRefurbishment && (
        <CompleteRefurbishmentModal
          serviceOrderId={id}
          readableId={order.serviceOrderId}
          onClose={completeDisclosure.onClose}
        />
      )}

      {completeDisclosure.isOpen && !isRefurbishment && (
        <Confirm
          action={path.to.serviceOrderStatus(id)}
          title={t`Complete ${order.serviceOrderId}`}
          text={t`Is the work on this unit done? A completed order is ready to invoice. Open visits stay as they are.`}
          confirmText={t`Complete`}
          onCancel={completeDisclosure.onClose}
          onSubmit={completeDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Completed" />
        </Confirm>
      )}

      {closeDisclosure.isOpen && (
        <Confirm
          action={path.to.serviceOrderStatus(id)}
          title={t`Close ${order.serviceOrderId}`}
          text={t`Are you sure you want to close this service order without an invoice? A closed order cannot change.`}
          confirmText={t`Close`}
          onCancel={closeDisclosure.onClose}
          onSubmit={closeDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Closed" />
        </Confirm>
      )}

      {invoiceDisclosure.isOpen && (
        <Confirm
          action={path.to.serviceOrderInvoice(id)}
          title={t`Invoice ${order.serviceOrderId}`}
          text={t`Create a Draft invoice of the order's unbilled items, laid out by its work? The service order is closed.`}
          confirmText={t`Create Invoice`}
          onCancel={invoiceDisclosure.onClose}
          onSubmit={invoiceDisclosure.onClose}
        />
      )}

      {cancelDisclosure.isOpen && (
        <Confirm
          action={path.to.serviceOrderStatus(id)}
          title={t`Cancel ${order.serviceOrderId}`}
          text={t`Are you sure you want to cancel this service order? Its open visits are cancelled too. An order with a charge that is not reversed cannot be cancelled.`}
          confirmText={t`Cancel Service Order`}
          confirmVariant="destructive"
          onCancel={cancelDisclosure.onClose}
          onSubmit={cancelDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Cancelled" />
        </Confirm>
      )}
    </>
  );
};

export default ServiceOrderHeader;
