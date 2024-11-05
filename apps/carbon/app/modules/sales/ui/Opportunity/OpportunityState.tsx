import { Card, cn } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuCheckCircle2, LuCircle } from "react-icons/lu";
import { useOptimisticLocation } from "~/hooks/useOptimisticLocation";
import { path } from "~/utils/path";
import type { Opportunity } from "../../types";

function getOpportunityStarted(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return opportunity.salesRfqId !== null;
    case "Quote":
      return opportunity.quoteId !== null;
    case "Order":
      return opportunity.salesOrderId !== null;
  }
}

function getOpportunityCompleted(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return opportunity.salesRfqCompletedDate !== null;
    case "Quote":
      return opportunity.quoteCompletedDate !== null;
    case "Order":
      return opportunity.salesOrderCompletedDate !== null;
  }
}

function getStateIcon(isCompleted?: boolean) {
  return isCompleted ? LuCheckCircle2 : LuCircle;
}

function getPath(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return path.to.salesRfqDetails(opportunity.salesRfqId!);
    case "Quote":
      return path.to.quoteDetails(opportunity.quoteId!);
    case "Order":
      return path.to.salesOrderDetails(opportunity.salesOrderId!);
  }
}

function getIsCurrent(
  opportunity: Opportunity,
  pathname: string,
  state: string
) {
  switch (state) {
    case "RFQ":
      return pathname.includes(
        path.to.salesRfqDetails(opportunity.salesRfqId!)
      );
    case "Quote":
      return pathname.includes(path.to.quoteDetails(opportunity.quoteId!));
    case "Order":
      return pathname.includes(
        path.to.salesOrderDetails(opportunity.salesOrderId!)
      );
    default:
      return false;
  }
}

const states = ["RFQ", "Quote", "Order", "Shipped"];

const OpportunityState = ({ opportunity }: { opportunity: Opportunity }) => {
  const { pathname } = useOptimisticLocation();
  return (
    <Card>
      <div className="relative flex items-center justify-between">
        {states.map((state) => {
          const isStarted = getOpportunityStarted(opportunity, state);
          const isCompleted = getOpportunityCompleted(opportunity, state);
          const isCurrent = getIsCurrent(opportunity, pathname, state);

          const Component = isStarted ? Link : "div";

          return (
            <Component
              key={state}
              // @ts-expect-error
              to={isStarted ? getPath(opportunity, state) : undefined}
              className="group flex flex-col items-center z-10"
            >
              <div
                className={cn(
                  "w-12 h-12 rounded-full border-2 flex items-center justify-center mb-2 bg-muted border-border",
                  !isStarted && "cursor-not-allowed",
                  isCurrent &&
                    "bg-emerald-600 dark:bg-emerald-900 border-transparent"
                )}
              >
                {getStateIcon(isCompleted)({
                  className: cn(
                    "w-8 h-8 muted-foreground",
                    isStarted &&
                      isCurrent &&
                      "text-emerald-100  dark:text-emerald-400",
                    isStarted &&
                      !isCurrent &&
                      "text-emerald-600  dark:text-emerald-400",
                    !isStarted && "text-muted-foreground"
                  ),
                })}
              </div>
              <span
                className={cn(
                  "text-sm text-center",
                  isCurrent
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground transition-colors"
                )}
              >
                {state}
              </span>
            </Component>
          );
        })}
        <div className="absolute top-6 left-4 right-4 h-0.5 bg-border" />
      </div>
    </Card>
  );
};

export default OpportunityState;
