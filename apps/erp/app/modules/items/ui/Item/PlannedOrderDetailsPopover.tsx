import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";
import { Link } from "react-router";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import type { PlannedOrder } from "~/modules/purchasing/purchasing.models";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { ItemReorderPolicy } from "./ItemReorderPolicy";

type Props = {
  order: PlannedOrder;
  conversionFactor: number;
  children: ReactNode;
};

export function PlannedOrderDetailsPopover({
  order,
  conversionFactor,
  children
}: Props) {
  const numberFormatter = useNumberFormatter();
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter();
  const [suppliers] = useSuppliers();

  const supplierLabel = order.supplierId
    ? (suppliers.find((s) => s.id === order.supplierId)?.name ?? null)
    : null;

  const hasPolicy = !!order.policyName;
  const hasLinkedPo = !!order.existingLineId;
  const inventoryQty = (order.quantity ?? 0) * conversionFactor;
  const isAsap = (order as { isASAP?: boolean }).isASAP === true;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-md max-h-112 overflow-y-auto pointer-events-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3">
          {/* Section A — Order facts */}
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">
              <Trans>Planned Order</Trans>
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>
                Planned order = MRP suggestion to cover projected demand based
                on the item's reorder policy (or manually added).
              </Trans>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">
                <Trans>Supplier</Trans>
              </dt>
              <dd>
                {supplierLabel ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>

              <dt className="text-muted-foreground">
                <Trans>Quantity</Trans>
              </dt>
              <dd>
                {numberFormatter.format(order.quantity ?? 0)}
                {conversionFactor !== 1 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({numberFormatter.format(inventoryQty)} <Trans>inv</Trans>)
                  </span>
                )}
              </dd>

              {order.startDate && (
                <>
                  <dt className="text-muted-foreground inline-flex items-center gap-1">
                    <Trans>Order by</Trans>
                    <Tooltip>
                      <TooltipTrigger tabIndex={-1}>
                        <LuInfo
                          className="size-3 cursor-help"
                          aria-label="info"
                        />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <Trans>
                          The latest date to place this PO so it arrives by the
                          need-by date, given the supplier's lead time.
                        </Trans>
                      </TooltipContent>
                    </Tooltip>
                  </dt>
                  <dd>{formatDate(order.startDate)}</dd>
                </>
              )}

              {order.dueDate && (
                <>
                  <dt className="text-muted-foreground inline-flex items-center gap-1">
                    <Trans>Need by</Trans>
                    <Tooltip>
                      <TooltipTrigger tabIndex={-1}>
                        <LuInfo
                          className="size-3 cursor-help"
                          aria-label="info"
                        />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <Trans>
                          The date the item is required on-site to cover the
                          period's projected demand.
                        </Trans>
                      </TooltipContent>
                    </Tooltip>
                  </dt>
                  <dd>
                    {formatDate(order.dueDate)}
                    {isAsap && (
                      <span className="ml-2 text-xs text-red-500 font-medium uppercase">
                        ASAP
                      </span>
                    )}
                  </dd>
                </>
              )}

              {order.unitPrice != null && (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Unit price</Trans>
                  </dt>
                  <dd>{currencyFormatter.format(order.unitPrice)}</dd>
                </>
              )}
            </dl>
          </div>

          {/* Section B — Why suggested */}
          {hasPolicy && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <div className="text-sm font-medium">
                <Trans>Why is this included?</Trans>
              </div>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  <Trans>Policy</Trans>
                </dt>
                <dd>
                  {order.policyName && (
                    <ItemReorderPolicy
                      reorderingPolicy={
                        order.policyName as
                          | "Demand-Based Reorder"
                          | "Fixed Reorder Quantity"
                          | "Manual Reorder"
                          | "Maximum Quantity"
                      }
                    />
                  )}
                </dd>

                {order.triggerValues?.projectedStock != null && (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans>Projected stock</Trans>
                    </dt>
                    <dd>
                      {numberFormatter.format(
                        order.triggerValues.projectedStock
                      )}
                    </dd>
                  </>
                )}

                {order.triggerValues?.safetyStock != null && (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans>Safety stock</Trans>
                    </dt>
                    <dd>
                      {numberFormatter.format(order.triggerValues.safetyStock)}
                    </dd>
                  </>
                )}

                {order.triggerValues?.lotSize != null && (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans>Lot size</Trans>
                    </dt>
                    <dd>
                      {numberFormatter.format(order.triggerValues.lotSize)}
                    </dd>
                  </>
                )}

                {order.triggerValues?.leadTime != null && (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans>Lead time (days)</Trans>
                    </dt>
                    <dd>
                      {numberFormatter.format(order.triggerValues.leadTime)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Section C — Linked PO */}
          {hasLinkedPo && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <div className="text-sm font-medium">
                <Trans>Linked PO</Trans>
              </div>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  <Trans>PO</Trans>
                </dt>
                <dd>
                  {order.existingId ? (
                    <Link
                      to={path.to.purchaseOrder(order.existingId)}
                      className="text-primary hover:underline"
                    >
                      {order.existingReadableId ?? order.existingId}
                    </Link>
                  ) : (
                    (order.existingReadableId ?? "—")
                  )}
                </dd>

                {order.existingStatus && (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans>Status</Trans>
                    </dt>
                    <dd className="font-mono text-xs">
                      {order.existingStatus}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
