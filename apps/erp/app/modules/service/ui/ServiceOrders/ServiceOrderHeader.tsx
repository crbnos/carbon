// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCircleStop,
  LuEllipsisVertical,
  LuFileText,
  LuLock,
  LuPanelRight,
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
import { useServiceOrderNavigation } from "./useServiceOrderNavigation";

/**
 * The order's header strip: identity and status on the left, the lifecycle
 * on the right. The next step is the one primary button. Every move posts to
 * the status route, which checks the move again.
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
    status === "Draft" || status === "Scheduled" || status === "In Progress";

  // A Depot Repair order is worked in the shop: it needs no visit to
  // complete, and its unit ships back from the RMA it came in on.
  const isDepotRepair = order.type === "Depot Repair";
  const returnOrder = order.salesReturnOrderLine?.salesReturnOrder ?? null;
  const canShipBack = isDepotRepair && isReadyToShipBack(order);

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.serviceOrderDetails(id)}>
              <Heading size="h4" className="whitespace-nowrap">
                {order.serviceOrderId}
              </Heading>
            </Link>
            <Copy text={order.serviceOrderId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
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
                <DropdownMenuItem
                  disabled={status !== "Completed" || !can("Draft")}
                  onClick={() => move("Draft")}
                >
                  <DropdownMenuIcon icon={<LuRotateCcw />} />
                  <Trans>Reopen</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
          </HStack>
          <HStack>
            {navigation.length > 1 && <DetailTopbar links={navigation} />}

            {isOpen && (
              <Button
                variant="secondary"
                leftIcon={<LuPause />}
                isDisabled={!can("On Hold")}
                isLoading={
                  isMoving &&
                  statusFetcher.formData?.get("status") === "On Hold"
                }
                onClick={() => move("On Hold")}
              >
                <Trans>Put on Hold</Trans>
              </Button>
            )}

            {status === "On Hold" && (
              <Button
                variant="primary"
                leftIcon={<LuPlay />}
                isDisabled={!can("Draft")}
                isLoading={isMoving}
                onClick={() => move("Draft")}
              >
                <Trans>Resume</Trans>
              </Button>
            )}

            {isOpen && (
              <Button
                variant={
                  status === "In Progress" || isDepotRepair
                    ? "primary"
                    : "secondary"
                }
                leftIcon={<LuCircleCheck />}
                isDisabled={!can("Completed")}
                onClick={completeDisclosure.onOpen}
              >
                <Trans>Complete</Trans>
              </Button>
            )}

            {canShipBack && returnOrder && (
              <Button variant="secondary" leftIcon={<LuTruck />} asChild>
                <Link to={path.to.salesReturnOrderDetails(returnOrder.id)}>
                  <Trans>Ship Back</Trans>
                </Link>
              </Button>
            )}

            {status === "Completed" && unbilledCount > 0 && (
              <Button
                variant="primary"
                leftIcon={<LuFileText />}
                isDisabled={!canInvoice || isMoving}
                onClick={invoiceDisclosure.onOpen}
              >
                <Trans>Create Invoice</Trans>
              </Button>
            )}

            {status === "Completed" && unbilledCount === 0 && (
              <Button
                variant="primary"
                leftIcon={<LuLock />}
                isDisabled={!can("Closed")}
                onClick={closeDisclosure.onOpen}
              >
                <Trans>Close</Trans>
              </Button>
            )}

            {(isOpen || status === "On Hold") && (
              <Button
                variant="secondary"
                leftIcon={<LuCircleStop />}
                isDisabled={!can("Cancelled")}
                onClick={cancelDisclosure.onOpen}
              >
                <Trans>Cancel</Trans>
              </Button>
            )}

            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {completeDisclosure.isOpen && (
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
