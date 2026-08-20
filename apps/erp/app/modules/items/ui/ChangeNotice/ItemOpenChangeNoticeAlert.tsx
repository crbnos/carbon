import { Badge, Card } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { LuGitPullRequestArrow } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import { isChangeNoticeOpen } from "../../items.models";
import type { ChangeNoticeForItem } from "../../items.service";

type ItemOpenChangeNoticeAlertProps = {
  changeNotices: ChangeNoticeForItem[];
};

// Part → CO traceability (4b): a subtle heads-up when this part is on one or
// more not-yet-Done change notices. Derived from the same history list. Renders
// nothing when there are no open COs.
const ItemOpenChangeNoticeAlert = ({
  changeNotices
}: ItemOpenChangeNoticeAlertProps) => {
  const open = changeNotices.filter((co) => isChangeNoticeOpen(co.status));
  if (open.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <LuGitPullRequestArrow className="mt-0.5 size-4 shrink-0 text-amber-500 dark:text-amber-400" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium leading-none tracking-tight">
              <Plural
                value={open.length}
                one="This item is on 1 open change notice"
                other="This item is on # open change notices"
              />
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Its design may change before the change notice is released.
              </Trans>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {open.map((co) => (
              <Link
                key={co.id}
                to={path.to.changeNotice(co.id)}
                className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer transition-colors hover:bg-accent active:scale-[0.98]"
                >
                  {co.changeOrderId}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ItemOpenChangeNoticeAlert;
