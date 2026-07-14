import { useLingui } from "@lingui/react/macro";
import { LuBanknote, LuCreditCard, LuReceiptText } from "react-icons/lu";
import {
  BanknoteArrowDown,
  BanknoteArrowUp
} from "~/assets/icons/BanknoteArrows";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useInvoicingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

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
          name: t`Purchasing Invoices`,
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
        }
      ]
    }
  ];

  return {
    groups: invoicingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else if (route.permission) {
            return permissions.can("view", route.permission);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            } else if (route.permission) {
              return permissions.can("view", route.permission);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
