// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
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
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
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

/**
 * The order's header strip, as the project header: the id and what it is
 * about, and the status, on the left; the order's actions (every move it can
 * make, the next step the primary button, Brad 2026-10-19), the copy button
 * and the ⋯ menu of links at the right end. Every move posts to the status
 * route, which checks the move again.
 */
const ServiceOrderHeader = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { toggleExplorer } = usePanels();
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

  const statusFetcher = useFetcher<{ success: boolean }>();
  const isMoving = statusFetcher.state !== "idle";
  const move = (to: ServiceOrderStatusAction) =>
    statusFetcher.submit(
      { status: to },
      { method: "post", action: path.to.serviceOrderStatus(id) }
    );

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

  // Every move the order can make is a header button; a move it cannot make
  // is not shown, and one the user may not make is disabled. The next step is
  // the primary button: Mark as Planned on a Draft order (its parts become
  // MRP demand and it takes charges), Complete on an open order, Resume on
  // hold, then Ship Back on a repaired unit, else Create Invoice or Close.
  const shows = (to: ServiceOrderStatusAction) =>
    canMoveServiceOrder(status, to);
  const isDisabled = !canUpdate || isMoving;
  const showInvoice = status === "Completed" && unbilledCount > 0;
  const showClose =
    status === "Completed" && unbilledCount === 0 && shows("Closed");
  const showReopen =
    status === "Completed" && !isRefurbishment && shows("Planned");
  const shipsBack = canShipBack && !!returnOrder;

  const actions = (
    <>
      <RecordAction slot="overflow">
        <Button variant="secondary" leftIcon={<LuPrinter />} asChild>
          <a
            href={path.to.serviceOrderEstimate(id)}
            target="_blank"
            rel="noreferrer"
          >
            <Trans>Print Estimate</Trans>
          </a>
        </Button>
      </RecordAction>
      {isOpen && shows("On Hold") && (
        <RecordAction slot="overflow">
          <Button
            variant="secondary"
            leftIcon={<LuPause />}
            isDisabled={isDisabled}
            onClick={() => move("On Hold")}
          >
            <Trans>Put on Hold</Trans>
          </Button>
        </RecordAction>
      )}
      {(isOpen || status === "On Hold") && shows("Cancelled") && (
        <RecordAction slot="overflow">
          <Button
            variant="secondary"
            leftIcon={<LuCircleStop />}
            isDisabled={isDisabled}
            onClick={cancelDisclosure.onOpen}
          >
            <Trans>Cancel</Trans>
          </Button>
        </RecordAction>
      )}
      {showReopen && (
        <RecordAction slot="overflow">
          <Button
            variant="secondary"
            leftIcon={<LuRotateCcw />}
            isDisabled={isDisabled}
            onClick={() => move("Planned")}
          >
            <Trans>Reopen</Trans>
          </Button>
        </RecordAction>
      )}
      {status === "Draft" && shows("Planned") && (
        <RecordAction slot="primary">
          <Button
            variant="primary"
            leftIcon={<LuCheckCheck />}
            isDisabled={isDisabled}
            onClick={() => move("Planned")}
          >
            <Trans>Mark as Planned</Trans>
          </Button>
        </RecordAction>
      )}
      {isOpen && shows("Completed") && (
        <RecordAction slot={status === "Draft" ? "overflow" : "primary"}>
          <Button
            variant={status === "Draft" ? "secondary" : "primary"}
            leftIcon={<LuCircleCheck />}
            isDisabled={isDisabled}
            onClick={completeDisclosure.onOpen}
          >
            <Trans>Complete</Trans>
          </Button>
        </RecordAction>
      )}
      {status === "On Hold" && shows("Planned") && (
        <RecordAction slot="primary">
          <Button
            variant="primary"
            leftIcon={<LuPlay />}
            isDisabled={isDisabled}
            onClick={() => move("Planned")}
          >
            <Trans>Resume</Trans>
          </Button>
        </RecordAction>
      )}
      {showInvoice && (
        <RecordAction slot={shipsBack ? "overflow" : "primary"}>
          <Button
            variant={shipsBack ? "secondary" : "primary"}
            leftIcon={<LuFileText />}
            isDisabled={!canInvoice || isMoving}
            onClick={invoiceDisclosure.onOpen}
          >
            <Trans>Create Invoice</Trans>
          </Button>
        </RecordAction>
      )}
      {showClose && (
        <RecordAction slot={shipsBack ? "overflow" : "primary"}>
          <Button
            variant={shipsBack ? "secondary" : "primary"}
            leftIcon={<LuLock />}
            isDisabled={isDisabled}
            onClick={closeDisclosure.onOpen}
          >
            <Trans>Close</Trans>
          </Button>
        </RecordAction>
      )}
      {shipsBack && returnOrder && (
        <RecordAction slot="primary">
          <Button variant="primary" leftIcon={<LuTruck />} asChild>
            <Link to={path.to.salesReturnOrderDetails(returnOrder.id)}>
              <Trans>Ship Back</Trans>
            </Link>
          </Button>
        </RecordAction>
      )}
    </>
  );

  // The ⋯ menu keeps the links to the order's other records.
  const hasLinks = Boolean(order.customerAssetId || returnOrder);
  const menu = hasLinks ? (
    <>
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
    </>
  ) : undefined;

  return (
    <>
      <RecordHeader
        title={
          // As the project header: the id, then what the order is about.
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap">
              {order.serviceOrderId}
            </span>
            <span className="min-w-0 truncate font-normal text-muted-foreground">
              {[
                order.customer?.name ?? order.item?.readableIdWithRevision,
                order.trackedEntity?.readableId
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        }
        copyValue={order.serviceOrderId}
        menu={menu}
        actions={actions}
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
        onToggleExplorer={toggleExplorer}
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
