import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { LuGitPullRequestArrow } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import { changeOrderOpenStatuses } from "../../items.models";
import type { ChangeOrderForItem } from "../../items.service";

type ItemOpenChangeOrderAlertProps = {
  changeOrders: ChangeOrderForItem[];
};

const openStatusSet = new Set<string>(changeOrderOpenStatuses);

// Part → CO traceability (4b): a subtle heads-up when this part is on one or
// more not-yet-Done change orders. Derived from the same history list. Renders
// nothing when there are no open COs.
const ItemOpenChangeOrderAlert = ({
  changeOrders
}: ItemOpenChangeOrderAlertProps) => {
  const open = changeOrders.filter((co) => openStatusSet.has(co.status));
  if (open.length === 0) return null;

  return (
    <Alert variant="warning">
      <LuGitPullRequestArrow className="h-4 w-4" />
      <AlertTitle>
        <Plural
          value={open.length}
          one="This part is on 1 open change order"
          other="This part is on # open change orders"
        />
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          {open.map((co) => (
            <Link
              key={co.id}
              to={path.to.changeOrder(co.id)}
              className="text-sm font-medium hover:underline"
            >
              {co.changeOrderId}
            </Link>
          ))}
          <span className="sr-only">
            <Trans>Open change orders affecting this part</Trans>
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
};

export default ItemOpenChangeOrderAlert;
