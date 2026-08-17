import { getQuoteDisplayId, withRevisionSuffix } from "@carbon/documents/utils";
import {
  Button,
  cn,
  Menubar,
  SplitButton,
  useOptimisticLocation
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuCircle } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { path } from "~/utils/path";
import type { Opportunity } from "../../types";

function getOpportunityStarted(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return opportunity.salesRfqs.length > 0;
    case "Quote":
      return opportunity.quotes.length > 0;
    case "Order":
      return opportunity.salesOrders.length > 0;
  }
}

function getOpportunityCompleted(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return (
        opportunity.salesRfqs?.[0]?.completedDate &&
        opportunity.salesRfqs?.[0]?.completedDate !== null
      );
    case "Quote":
      return (
        opportunity.quotes?.[0]?.completedDate &&
        opportunity.quotes?.[0]?.completedDate !== null
      );
    case "Order":
      return (
        opportunity.salesOrders?.[0]?.completedDate &&
        opportunity.salesOrders?.[0]?.completedDate !== null
      );
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
      return path.to.salesRfqDetails(opportunity.salesRfqs?.[0]?.id!);
    case "Quote":
      return path.to.quoteDetails(opportunity.quotes?.[0]?.id!);
    case "Order":
      return path.to.salesOrderDetails(opportunity.salesOrders?.[0]?.id!);
  }
}

function getIsCurrent(
  opportunity: Opportunity,
  pathname: string,
  state: string
) {
  switch (state) {
    case "RFQ":
      return opportunity.salesRfqs.some((rfq) =>
        pathname.includes(path.to.salesRfqDetails(rfq.id!))
      );
    case "Quote":
      return opportunity.quotes.some((quote) =>
        pathname.includes(path.to.quoteDetails(quote.id!))
      );
    case "Order":
      return opportunity.salesOrders.some((order) =>
        pathname.includes(path.to.salesOrderDetails(order.id!))
      );

    default:
      return false;
  }
}

function getItems(opportunity: Opportunity, state: string) {
  switch (state) {
    case "RFQ":
      return opportunity.salesRfqs.map((rfq) => ({
        id: rfq.id!,
        label: rfq.rfqId
          ? withRevisionSuffix(rfq.rfqId, rfq.revisionId)
          : `RFQ ${rfq.id}`,
        path: path.to.salesRfqDetails(rfq.id!)
      }));
    case "Quote":
      return opportunity.quotes.map((quote) => ({
        id: quote.id!,
        label: quote.quoteId ? getQuoteDisplayId(quote) : `Quote ${quote.id}`,
        path: path.to.quoteDetails(quote.id!)
      }));
    case "Order":
      return opportunity.salesOrders.map((order) => ({
        id: order.id!,
        // Sales orders are not revised — the column exists but nothing writes
        // it, so this only ever renders the bare id.
        label: order.salesOrderId ?? `Order ${order.id}`,
        path: path.to.salesOrderDetails(order.id!)
      }));
    default:
      return [];
  }
}

const states = ["RFQ", "Quote", "Order"];

const OpportunityState = ({ opportunity }: { opportunity: Opportunity }) => {
  const { t } = useLingui();
  const { pathname } = useOptimisticLocation();
  const navigate = useNavigate();

  const stateLabels: Record<string, string> = {
    RFQ: t`RFQ`,
    Quote: t`Quote`,
    Order: t`Order`
  };

  return (
    <Menubar>
      {states.map((state, index) => {
        const isStarted = getOpportunityStarted(opportunity, state);
        const isCompleted = getOpportunityCompleted(opportunity, state);
        const isCurrent = getIsCurrent(opportunity, pathname, state);
        const Icon = getOpportunityIcon(state);
        const to = getPath(opportunity, state);
        const items = getItems(opportunity, state);
        const hasMultipleItems = items.length > 1;

        if (isStarted && to) {
          if (hasMultipleItems) {
            const Icon = getOpportunityIcon(state);
            return (
              <SplitButton
                key={state}
                leftIcon={
                  <Icon
                    className={cn(
                      isCurrent && "text-emerald-500",
                      !isCurrent && "opacity-80 hover:opacity-100"
                    )}
                  />
                }
                variant="ghost"
                onClick={() => navigate(to)}
                dropdownItems={items.map((item) => ({
                  label: item.label,
                  onClick: () => navigate(item.path)
                }))}
              >
                {stateLabels[state]}
              </SplitButton>
            );
          } else {
            return (
              <Button
                key={state}
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
                <Link to={to}>{stateLabels[state]}</Link>
              </Button>
            );
          }
        } else {
          return (
            <Button
              key={state}
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
              {stateLabels[state]}
            </Button>
          );
        }
      })}
    </Menubar>
  );
};

export default OpportunityState;
