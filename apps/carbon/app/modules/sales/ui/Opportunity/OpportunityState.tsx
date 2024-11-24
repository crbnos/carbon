import { Button, cn, Menubar } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuCircle } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
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

function getOpportunityIcon(state: string) {
  switch (state) {
    case "RFQ":
      return RiProgress2Line;
    case "Quote":
      return RiProgress4Line;
    case "Order":
      return RiProgress8Line;
    default:
      return LuCircle;
  }
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

const states = ["RFQ", "Quote", "Order"];

const OpportunityState = ({ opportunity }: { opportunity: Opportunity }) => {
  const { pathname } = useOptimisticLocation();
  return (
    <Menubar>
      {states.map((state, index) => {
        const isStarted = getOpportunityStarted(opportunity, state);
        const isCompleted = getOpportunityCompleted(opportunity, state);
        const isCurrent = getIsCurrent(opportunity, pathname, state);
        const Icon = getOpportunityIcon(state);
        const to = getPath(opportunity, state);

        return isStarted && to ? (
          <Button
            leftIcon={
              <Icon
                className={cn(
                  isCurrent && "text-emerald-500",
                  !isCurrent && "opacity-80 hover:opacity-100"
                )}
              />
            }
            variant="ghost"
            asChild
          >
            <Link to={to}>{state}</Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            isDisabled
            leftIcon={
              <Icon
                className={cn(
                  isCompleted && "text-emerald-500",
                  !isCurrent && "opacity-80 hover:opacity-100"
                )}
              />
            }
          >
            {state}
          </Button>
        );
      })}
    </Menubar>
  );
};

export default OpportunityState;
