// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuShoppingCart } from "react-icons/lu";
import { Link } from "react-router";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.service";

/** These lines post on the invoice or to the asset: no receipt count to show. */
const LINES_WITHOUT_RECEIVED_COUNT = ["Service", "G/L Account", "Fixed Asset"];

/**
 * The purchase order lines charged to an element, one row each under its jobs
 * (in `ElementChildren`'s list), linked to the order: its number, what the
 * line buys, how many have been received, its required date and the order's
 * status. A line shows here from the moment it exists, before it has any cost.
 */
export function ElementPurchaseOrderLines({
  lines
}: {
  lines: ProjectElementPage["purchaseOrderLines"];
}) {
  const [items] = useItems();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const idChars = Math.max(
    0,
    ...lines.map((line) => line.purchaseOrder.purchaseOrderId.length)
  );

  return (
    <>
      {lines.map((line) => {
        const item = line.itemId ? itemById.get(line.itemId) : undefined;
        const received = formatQuantity(Number(line.quantityReceived ?? 0));
        const ordered = formatQuantity(Number(line.purchaseQuantity ?? 0));
        return (
          <div
            key={line.id}
            className="group/row relative flex h-9 items-center gap-3 rounded-md px-3 transition-colors hover:bg-accent/50"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <LuShoppingCart className="size-3.5 shrink-0 text-muted-foreground" />
              <span
                className="shrink-0 whitespace-nowrap text-sm text-muted-foreground tabular-nums"
                style={{ minWidth: `${idChars}ch` }}
              >
                {line.purchaseOrder.purchaseOrderId}
              </span>
              <Link
                to={path.to.purchaseOrderDetails(line.purchaseOrder.id)}
                className="min-w-0 truncate text-sm before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:before:ring-1 focus-visible:before:ring-inset focus-visible:before:ring-ring"
              >
                {item
                  ? `${item.readableIdWithRevision} ${item.name}`
                  : (line.description ?? line.purchaseOrder.purchaseOrderId)}
              </Link>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
              {!LINES_WITHOUT_RECEIVED_COUNT.includes(
                line.purchaseOrderLineType
              ) && (
                <span className="tabular-nums">
                  <Trans>
                    {received} of {ordered}
                  </Trans>
                </span>
              )}
              {line.requiredDate && (
                <span className="tabular-nums">
                  {formatDate(line.requiredDate)}
                </span>
              )}
              <PurchasingStatus status={line.purchaseOrder.status} />
            </div>
          </div>
        );
      })}
    </>
  );
}
