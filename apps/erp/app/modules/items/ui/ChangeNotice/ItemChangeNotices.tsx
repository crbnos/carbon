import { Card, CardContent, CardHeader, CardTitle, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { isChangeNoticeLocked } from "../../items.models";
import type { ChangeNoticeForItem } from "../../items.service";
import ChangeNoticeStatus from "./ChangeNoticeStatus";

type ItemChangeNoticesProps = {
  changeNotices: ChangeNoticeForItem[];
  types: ListItem[];
};

// Part → CO traceability (4b): a history card of every change notice that
// references this part (across all its revisions). Newest first (the G6 query
// orders it). Done rows are de-emphasized. Renders nothing when empty.
const ItemChangeNotices = ({
  changeNotices,
  types
}: ItemChangeNoticesProps) => {
  if (changeNotices.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Change Notices</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-border">
          {changeNotices.map((co) => {
            const isDone = isChangeNoticeLocked(co.status);
            const categoryName =
              types.find((ty) => ty.id === co.changeOrderTypeId)?.name ?? null;
            return (
              <Link
                key={co.id}
                to={path.to.changeNotice(co.id)}
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
                  <ChangeNoticeStatus status={co.status} />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ItemChangeNotices;
