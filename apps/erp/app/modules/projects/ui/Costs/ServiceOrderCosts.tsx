// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import type { ServiceOrderStatus as ServiceOrderStatusType } from "~/modules/service/service.models";
import { ServiceOrderStatus } from "~/modules/service/ui/ServiceStatus";
import { path } from "~/utils/path";

export type ServiceOrderCostRow = {
  serviceOrderId: string;
  serviceOrderReadableId: string;
  status: ServiceOrderStatusType;
  serial: string | null;
  actual: number;
  actualHours: number;
  billed: number;
  unbilled: number;
};

const FIGURE_CELL = "w-28 shrink-0 px-2 text-right tabular-nums";

/**
 * The service orders whose Service project has this project as its parent
 * (the orders a coverage contract covers): one row each, under the element
 * tree. The order opens for users with service_view; others see its id.
 */
export default function ServiceOrderCosts({
  rows
}: {
  rows: ServiceOrderCostRow[];
}) {
  const permissions = usePermissions();
  const canViewService = permissions.can("view", "service");
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();

  if (rows.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex h-10 items-center border-b border-border bg-card pr-4 text-xs font-medium text-muted-foreground">
        <div className="min-w-0 flex-1 px-4">
          <Trans>Service orders</Trans>
        </div>
        <span className="w-40 shrink-0 px-2">
          <Trans>Serial</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Hours</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Actual</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Billed</Trans>
        </span>
        <span className={FIGURE_CELL}>
          <Trans>Unbilled</Trans>
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.serviceOrderId}
            className="flex h-9 items-center border-b border-border pr-4 text-sm last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
              {canViewService ? (
                <Hyperlink
                  to={path.to.serviceOrder(row.serviceOrderId)}
                  className="whitespace-nowrap"
                >
                  {row.serviceOrderReadableId}
                </Hyperlink>
              ) : (
                <span className="whitespace-nowrap font-medium">
                  {row.serviceOrderReadableId}
                </span>
              )}
              <ServiceOrderStatus status={row.status} />
            </div>
            <span className="w-40 shrink-0 truncate px-2 text-muted-foreground">
              {row.serial ?? "—"}
            </span>
            <span className={FIGURE_CELL}>
              {formatQuantity(row.actualHours)}
            </span>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.actual)}
            </span>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.billed)}
            </span>
            <span className={FIGURE_CELL}>
              {formatMoney.format(row.unbilled)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
