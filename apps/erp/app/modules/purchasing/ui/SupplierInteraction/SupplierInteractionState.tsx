import { Button, cn, Menubar, SplitButton } from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { Link, useNavigate } from "@remix-run/react";
import { LuCircle, LuCreditCard } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { path } from "~/utils/path";
import type { SupplierInteraction } from "../../types";

function getSupplierInteractionStarted(
  interaction: SupplierInteraction,
  state: string
) {
  switch (state) {
    // case "RFQ":
    //   return interaction.purchaseRfqs.length > 0;
    case "Quote":
      return interaction.supplierQuotes.length > 0;
    case "Order":
      return interaction.purchaseOrders.length > 0;
    // case "Invoice":
    //   return interaction.purchaseInvoices.length > 0;
  }
}

function getSupplierInteractionCompleted(
  interaction: SupplierInteraction,
  state: string
) {
  switch (state) {
    // case "RFQ":
    //   return (
    //     interaction.purchaseRfqs?.[0]?.completedDate &&
    //     interaction.purchaseRfqs?.[0]?.completedDate !== null
    //   );
    case "Quote":
      return interaction.supplierQuotes.length > 0;
    case "Order":
      return interaction.purchaseOrders?.[0]?.status === "Completed";
    // case "Invoice":
    //   return (
    //     interaction.purchaseInvoices?.[0]?.completedDate &&
    //     interaction.purchaseInvoices?.[0]?.completedDate !== null
    //   );
  }
}

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

function getPath(interaction: SupplierInteraction, state: string) {
  switch (state) {
    // case "RFQ":
    //   return path.to.purchaseRfqDetails(interaction.purchaseRfqs?.[0]?.id!);
    case "Quote":
      return path.to.supplierQuoteDetails(interaction.supplierQuotes?.[0]?.id!);
    case "Order":
      return path.to.purchaseOrderDetails(interaction.purchaseOrders?.[0]?.id!);
    case "Invoice":
      return path.to.purchaseInvoiceDetails(
        interaction.purchaseInvoices?.[0]?.id!
      );
  }
}

function getIsCurrent(
  interaction: SupplierInteraction,
  pathname: string,
  state: string
) {
  switch (state) {
    // case "RFQ":
    //   return interaction.purchaseRfqs.some((rfq) =>
    //     pathname.includes(path.to.purchaseRfqDetails(rfq.id!))
    //   );
    case "Quote":
      return interaction.supplierQuotes.some((quote) =>
        pathname.includes(path.to.supplierQuoteDetails(quote.id!))
      );
    case "Order":
      return interaction.purchaseOrders.some((order) =>
        pathname.includes(path.to.purchaseOrderDetails(order.id!))
      );
    case "Invoice":
      return interaction.purchaseInvoices.some((invoice) =>
        pathname.includes(path.to.purchaseInvoiceDetails(invoice.id!))
      );
    default:
      return false;
  }
}

function getItems(interaction: SupplierInteraction, state: string) {
  switch (state) {
    // case "RFQ":
    //   return interaction.purchaseRfqs.map((rfq) => ({
    //     id: rfq.id!,
    //     label: rfq.rfqId
    //       ? `${rfq.rfqId}${
    //           rfq.revisionId && rfq.revisionId > 0 ? `-${rfq.revisionId}` : ""
    //         }`
    //       : `RFQ ${rfq.id}`,
    //     path: path.to.purchaseRfqDetails(rfq.id!),
    //   }));
    case "Quote":
      return interaction.supplierQuotes.map((quote) => ({
        id: quote.id!,
        label: quote.supplierQuoteId
          ? `${quote.supplierQuoteId}${
              quote.revisionId && quote.revisionId > 0
                ? `-${quote.revisionId}`
                : ""
            }`
          : `Quote ${quote.id}`,
        path: path.to.supplierQuoteDetails(quote.id!),
      }));
    case "Order":
      return interaction.purchaseOrders.map((order) => ({
        id: order.id!,
        label: order.purchaseOrderId
          ? `${order.purchaseOrderId}${
              order.revisionId && order.revisionId > 0
                ? `-${order.revisionId}`
                : ""
            }`
          : `Order ${order.id}`,
        path: path.to.purchaseOrderDetails(order.id!),
      }));
    case "Invoice":
      return interaction.purchaseInvoices.map((invoice) => ({
        id: invoice.id!,
        label: invoice.invoiceId
          ? `${invoice.invoiceId}`
          : `Invoice ${invoice.id}`,
        path: path.to.purchaseInvoiceDetails(invoice.id!),
      }));
    default:
      return [];
  }
}

const states = ["RFQ", "Quote", "Order", "Invoice"];

const SupplierInteractionState = ({
  interaction,
}: {
  interaction: SupplierInteraction;
}) => {
  const { pathname } = useOptimisticLocation();
  const navigate = useNavigate();

  return (
    <Menubar>
      {states
        .filter((state) => ["Quote", "Order"].includes(state))
        .map((state, index) => {
          const isStarted = getSupplierInteractionStarted(interaction, state);
          const isCompleted = getSupplierInteractionCompleted(
            interaction,
            state
          );
          const isCurrent = getIsCurrent(interaction, pathname, state);
          const Icon = getSupplierInteractionIcon(state);
          const to = getPath(interaction, state);
          const items = getItems(interaction, state);
          const hasMultipleItems = items.length > 1;

          if (isStarted && to) {
            if (hasMultipleItems) {
              const Icon = getSupplierInteractionIcon(state);
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
                    onClick: () => navigate(item.path),
                  }))}
                >
                  {state}
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
                  <Link to={to}>{state}</Link>
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
                {state}
              </Button>
            );
          }
        })}
    </Menubar>
  );
};

export default SupplierInteractionState;
