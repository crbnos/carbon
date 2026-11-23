// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, HStack } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { LuHandCoins } from "react-icons/lu";
import { Hyperlink } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import type { ProjectBorrow } from "~/modules/projects/types";
import { StockOwner } from "~/modules/projects/ui/Transfers/StockOwner";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

/**
 * The planning worklist's read-only "Overdue borrows" group: Open borrows at
 * the location past their payback date. MRP plans a borrow as firm demand on
 * the borrower and firm supply on the lender and never suggests a change to
 * it, so the planner sees the exception here and settles it with a Payback
 * from the borrower's Stock tab.
 */
export function PlanningOverdueBorrows({
  borrows
}: {
  borrows: ProjectBorrow[];
}) {
  const { locale } = useLocale();
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();

  if (borrows.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border bg-card px-4 py-2 lg:px-6">
      <HStack spacing={2} className="mb-1">
        <LuHandCoins className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          <Trans>Overdue borrows</Trans>
        </span>
        <Badge variant="red">{borrows.length}</Badge>
      </HStack>
      <ul className="max-h-32 overflow-y-auto">
        {borrows.map((borrow) => {
          const item = items.find((i) => i.id === borrow.itemId);
          const owed =
            Number(borrow.quantity) - Number(borrow.quantityPaidBack);
          return (
            <li
              key={borrow.id}
              className="flex min-w-0 items-center gap-3 py-1 text-sm"
            >
              <Hyperlink
                to={path.to.projectStock(borrow.borrowerProjectId)}
                className="shrink-0 whitespace-nowrap font-medium"
              >
                {item?.readableIdWithRevision ?? borrow.itemId}
              </Hyperlink>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {item?.name}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatQuantity(owed)}
              </span>
              <HStack spacing={1} className="shrink-0 text-xs">
                <StockOwner project={borrow.borrower} />
                <span className="text-muted-foreground">
                  <Trans>owes</Trans>
                </span>
                <StockOwner project={borrow.lender} />
              </HStack>
              <span className="shrink-0 whitespace-nowrap text-red-600 dark:text-red-400">
                {formatDate(borrow.paybackDueDate, undefined, locale)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
