import { Card, CardContent, CardHeader, CardTitle, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { isChangeOrderLocked } from "../../items.models";
import type { ChangeOrderForItem } from "../../items.service";
import ChangeOrderStatus from "./ChangeOrderStatus";

type ItemChangeOrdersProps = {
  changeOrders: ChangeOrderForItem[];
  types: ListItem[];
};

// Part → CO traceability (4b): a history card of every change order that
// references this part (across all its revisions). Newest first (the G6 query
// orders it). Done rows are de-emphasized. Renders nothing when empty.
const ItemChangeOrders = ({ changeOrders, types }: ItemChangeOrdersProps) => {
  if (changeOrders.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Change Orders</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-border">
          {changeOrders.map((co) => {
            const isDone = isChangeOrderLocked(co.status);
            const categoryName =
              types.find((ty) => ty.id === co.changeOrderTypeId)?.name ?? null;
            return (
              <Link
                key={co.id}
                to={path.to.changeOrder(co.id)}
                className={cn(
                  "flex items-center justify-between gap-4 py-2 hover:bg-accent/50 rounded-md px-2 -mx-2 transition-colors",
                  isDone && "opacity-60"
                )}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium tracking-tight truncate">
                    {co.changeOrderId}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {co.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {categoryName && <Enumerable value={categoryName} />}
                  <ChangeOrderStatus status={co.status} />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ItemChangeOrders;
