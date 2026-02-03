import { Button, cn, Menubar, SplitButton } from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { LuCircle, LuCreditCard } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { path } from "~/utils/path";
import type { SupplierInteraction } from "../../types";

type LinkedPurchasingRFQ = {
  id: string;
  rfqId?: string;
  status?: string;
};

type LinkedSupplierQuote = {
  id: string;
  supplierQuoteId?: string;
  revisionId?: number;
  status?: string;
  supplierId?: string;
  supplier?: { name: string } | null;
};

type SupplierInteractionStateProps = {
  // For use from supplier quote / purchase order (has interaction with optional purchasingRfq)
  interaction?: SupplierInteraction | null;
  // For use from purchasing RFQ (has current RFQ)
  currentRfq?: LinkedPurchasingRFQ | null;
  linkedQuotes?: LinkedSupplierQuote[];
  // For use from quote view: sibling quotes (other quotes from same RFQ)
  siblingQuotes?: LinkedSupplierQuote[];
};

function getSupplierInteractionIcon(state: string) {
  switch (state) {
    case "RFQ":
      return RiProgress2Line;
    case "Quote":
      return RiProgress4Line;
    case "Order":
      return RiProgress8Line;
    case "Invoice":
      return LuCreditCard;
    default:
      return LuCircle;
  }
}

const states = ["RFQ", "Quote", "Order", "Invoice"];

const SupplierInteractionState = ({
  interaction,
  currentRfq,
  linkedQuotes = [],
  siblingQuotes = []
}: SupplierInteractionStateProps) => {
  const { pathname } = useOptimisticLocation();
  const navigate = useNavigate();

  // Determine if we're in "RFQ mode" (viewing from purchasing RFQ) or "interaction mode" (viewing from quote/order)
  const isRfqMode = currentRfq !== undefined && currentRfq !== null;

  // Get RFQ: currentRfq for RFQ mode, interaction.purchasingRfq for interaction mode
  const rfqs = isRfqMode
    ? [currentRfq]
    : interaction?.purchasingRfq
      ? [interaction.purchasingRfq]
      : [];
  const hasRfqs = rfqs.length > 0;

  // Combine quote sources:
  // - RFQ mode: use linkedQuotes (quotes linked to current RFQ)
  // - Quote mode (siblingQuotes provided): combine current quote with siblings
  // - Order mode: use interaction.supplierQuotes (shows parent quote)
  const interactionQuotes =
    interaction?.supplierQuotes?.map((q) => ({
      id: q.id!,
      supplierQuoteId: q.supplierQuoteId ?? undefined,
      revisionId: q.revisionId ?? undefined,
      status: q.status ?? undefined,
      supplierId: q.supplierId ?? undefined
    })) ?? [];

  const quotes = isRfqMode
    ? linkedQuotes
    : siblingQuotes.length > 0
      ? [...interactionQuotes, ...siblingQuotes]
      : interactionQuotes;
  const hasQuotes = quotes.length > 0;

  // Orders and invoices only from interaction
  const orders = interaction?.purchaseOrders ?? [];
  const hasOrders = orders.length > 0;
  //   const invoices = interaction?.purchaseInvoices ?? [];

  // Determine which states to show
  const statesToShow = hasRfqs ? ["RFQ", "Quote", "Order"] : ["Quote", "Order"];

  return (
    <Menubar>
      {states
        .filter((state) => statesToShow.includes(state))
        .map((state) => {
          const Icon = getSupplierInteractionIcon(state);

          // RFQ State
          if (state === "RFQ" && hasRfqs) {
            const rfqItems = rfqs.map((rfq) => ({
              id: rfq.id!,
              label: rfq.rfqId ? rfq.rfqId : `RFQ ${rfq.id}`,
              path: path.to.purchasingRfqDetails(rfq.id!)
            }));

            const firstPath = rfqItems[0]?.path;
            const hasMultiple = rfqItems.length > 1;
            const isCurrent = rfqItems.some((item) =>
              pathname.includes(path.to.purchasingRfq(item.id))
            );

            if (hasMultiple) {
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
                  onClick={() => navigate(firstPath)}
                  dropdownItems={rfqItems.map((item) => ({
                    label: item.label,
                    onClick: () => navigate(item.path)
                  }))}
                >
                  RFQ
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
                  <Link to={firstPath}>RFQ</Link>
                </Button>
              );
            }
          }

          // Quote State
          if (state === "Quote" && hasQuotes) {
            const quoteItems = quotes.map((quote) => ({
              id: quote.id!,
              label: quote.supplierQuoteId
                ? `${quote.supplierQuoteId}${
                    quote.revisionId && quote.revisionId > 0
                      ? `-${quote.revisionId}`
                      : ""
                  }`
                : `Quote ${quote.id}`,
              path: path.to.supplierQuoteDetails(quote.id!)
            }));

            const firstPath = quoteItems[0]?.path;
            const hasMultiple = quoteItems.length > 1;
            const isCurrent = quoteItems.some((item) =>
              pathname.includes(item.path)
            );

            if (hasMultiple) {
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
                  onClick={() => navigate(firstPath)}
                  dropdownItems={quoteItems.map((item) => ({
                    label: item.label,
                    onClick: () => navigate(item.path)
                  }))}
                >
                  Quote
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
                  <Link to={firstPath}>Quote</Link>
                </Button>
              );
            }
          }

          // Order State
          if (state === "Order" && hasOrders) {
            const orderItems = orders.map((order) => ({
              id: order.id!,
              label: order.purchaseOrderId
                ? `${order.purchaseOrderId}${
                    order.revisionId && order.revisionId > 0
                      ? `-${order.revisionId}`
                      : ""
                  }`
                : `Order ${order.id}`,
              path: path.to.purchaseOrderDetails(order.id!)
            }));

            const firstPath = orderItems[0]?.path;
            const hasMultiple = orderItems.length > 1;
            const isCurrent = orderItems.some((item) =>
              pathname.includes(item.path)
            );

            if (hasMultiple) {
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
                  onClick={() => navigate(firstPath)}
                  dropdownItems={orderItems.map((item) => ({
                    label: item.label,
                    onClick: () => navigate(item.path)
                  }))}
                >
                  Order
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
                  <Link to={firstPath}>Order</Link>
                </Button>
              );
            }
          }

          // Disabled states
          return (
            <Button
              key={state}
              variant="ghost"
              isDisabled
              leftIcon={<Icon className="opacity-50" />}
            >
              {state}
            </Button>
          );
        })}
    </Menubar>
  );
};

export default SupplierInteractionState;
