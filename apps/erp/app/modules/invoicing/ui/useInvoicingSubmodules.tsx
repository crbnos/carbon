import { useLingui } from "@lingui/react/macro";
import {
  LuBanknote,
  LuCreditCard,
  LuReceipt,
  LuReceiptText
} from "react-icons/lu";
import {
  BanknoteArrowDown,
  BanknoteArrowUp
} from "~/assets/icons/BanknoteArrows";
import { usePermissions } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useInvoicingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const integrations = useIntegrations();
  const { addSavedViewsToRoutes } = useSavedViews();

  const hasRamp = integrations.has("ramp");

  // Routes that only make sense with an active integration; hidden otherwise.
  const integrationRoutes = new Map<string, boolean>([
    [path.to.cardTransactions, hasRamp]
  ]);

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) => {
    if (integrationRoutes.has(route.to) && !integrationRoutes.get(route.to)) {
      return false;
    }
    if (route.role) {
      return permissions.is(route.role);
    } else if (route.permission) {
      return permissions.can("view", route.permission);
    }
    return true;
  };

  const invoicingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Accounts Payable`,
      routes: [
        {
          name: t`Payables`,
          to: path.to.payables,
          icon: <BanknoteArrowUp />,
          permission: "invoicing"
        },
        {
          name: t`Purchase Invoices`,
          to: path.to.invoicingPurchasing,
          icon: <LuReceiptText />,
          table: "purchaseInvoice",
          permission: "invoicing"
        }
      ]
    },
    {
      name: t`Accounts Receivable`,
      routes: [
        {
          name: t`Receivables`,
          to: path.to.receivables,
          icon: <BanknoteArrowDown />,
          permission: "invoicing"
        },
        {
          name: t`Sales Invoices`,
          to: path.to.invoicingSales,
          icon: <LuCreditCard />,
          table: "salesInvoice",
          permission: "invoicing"
        }
      ]
    },

    {
      name: t`Payments`,
      routes: [
        {
          name: t`Payments`,
          to: path.to.payments,
          icon: <LuBanknote />,
          table: "payment",
          permission: "invoicing"
        },
        {
          name: t`Credits & Debits`,
          to: path.to.memos,
          icon: <LuCreditCard />,
          table: "memo",
          permission: "invoicing"
        },
        {
          name: t`Card Transactions`,
          to: path.to.cardTransactions,
          icon: <LuReceipt />,
          table: "cardTransaction",
          permission: "invoicing"
        }
      ]
    }
  ];

  return {
    groups: invoicingRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
  };
}
