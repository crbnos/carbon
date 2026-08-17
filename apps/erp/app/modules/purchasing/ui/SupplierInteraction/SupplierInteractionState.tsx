import {
  getPurchaseOrderDisplayId,
  withRevisionSuffix
} from "@carbon/documents/utils";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Menubar,
  SplitButton,
  useOptimisticLocation
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuChevronDown, LuCircle, LuCreditCard } from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { useSuppliers } from "~/stores/suppliers";
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

/** "Acme Tooling (SQ000012-1)", degrading to whichever half is known. */
function buildSupplierQuoteLabel(
  supplierName: string | undefined,
  quoteDisplayId: string,
  quoteId: string
) {
  if (supplierName) {
    return quoteDisplayId
      ? `${supplierName} (${quoteDisplayId})`
      : supplierName;
  }
  return quoteDisplayId || `Quote ${quoteId}`;
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

const states = ["RFQ", "Quote", "Order", "Invoice"];

const SupplierInteractionState = ({
  interaction,
  currentRfq,
  linkedQuotes = [],
  siblingQuotes = []
}: SupplierInteractionStateProps) => {
  const { t } = useLingui();
  const { pathname } = useOptimisticLocation();
  const navigate = useNavigate();
  const [suppliers] = useSuppliers();

  const stateLabels: Record<string, string> = {
    RFQ: t`RFQ`,
    Quote: t`Quote`,
    Order: t`Order`,
    Invoice: t`Invoice`
  };

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
                  {stateLabels.RFQ}
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
                  <Link to={firstPath}>{stateLabels.RFQ}</Link>
                </Button>
              );
            }
          }

          // Quote State
          if (state === "Quote" && hasQuotes) {
            const quoteItems = quotes
              .map((quote) => {
                const supplierName =
                  ("supplier" in quote ? quote.supplier?.name : undefined) ??
                  suppliers.find((s) => s.id === quote.supplierId)?.name;

                return {
                  id: quote.id!,
                  label: buildSupplierQuoteLabel(
                    supplierName,
                    withRevisionSuffix(quote.supplierQuoteId, quote.revisionId),
                    quote.id!
                  ),
                  path: path.to.supplierQuoteDetails(quote.id!)
                };
              })
              .sort((a, b) => a.label.localeCompare(b.label));

            const hasMultiple = quoteItems.length > 1;
            const currentItem = quoteItems.find((item) =>
              pathname.includes(item.path)
            );
            const isCurrent = !!currentItem;

            if (hasMultiple) {
              return (
                <DropdownMenu key={state}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      leftIcon={
                        <Icon
                          className={cn(
                            isCurrent && "text-emerald-500",
                            !isCurrent && "opacity-80 hover:opacity-100"
                          )}
                        />
                      }
                      rightIcon={<LuChevronDown className="h-3 w-3" />}
                      variant="ghost"
                    >
                      {stateLabels.Quote}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuRadioGroup
                      value={currentItem?.id}
                      onValueChange={(id) => {
                        const item = quoteItems.find((q) => q.id === id);
                        if (item) navigate(item.path);
                      }}
                    >
                      {quoteItems.map((item) => (
                        <DropdownMenuRadioItem key={item.id} value={item.id}>
                          {item.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                  <Link to={quoteItems[0]?.path}>{stateLabels.Quote}</Link>
                </Button>
              );
            }
          }

          // Order State
          if (state === "Order" && hasOrders) {
            const orderItems = orders.map((order) => ({
              id: order.id!,
              label: order.purchaseOrderId
                ? getPurchaseOrderDisplayId(order)
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
                  {stateLabels.Order}
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
                  <Link to={firstPath}>{stateLabels.Order}</Link>
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
              {stateLabels[state]}
            </Button>
          );
        })}
    </Menubar>
  );
};

export default SupplierInteractionState;
