import { useLingui } from "@lingui/react/macro";
import {
  LuBanknote,
  LuCreditCard,
  LuReceipt,
  LuReceiptText,
  LuWallet
} from "react-icons/lu";
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

  // Charges are a first-class Carbon document with their own posting path, so
  // the nav entry is NOT gated on a spend integration being connected — an
  // empty list is discoverable, a missing nav entry is not. Permission is the
  // only gate (as it is for every other invoicing route).
  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) => {
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
        },
        {
          name: t`Vendor Credits`,
          to: path.to.vendorCredits,
          icon: <LuCreditCard />,
          table: "memo",
          permission: "invoicing"
        },
        {
          name: t`Charges`,
          to: path.to.charges,
          icon: <LuReceipt />,
          table: "charge",
          permission: "invoicing"
        },
        {
          name: t`Reimbursements`,
          to: path.to.reimbursements,
          icon: <LuWallet />,
          table: "reimbursement",
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
        },
        {
          name: t`Credit Memos`,
          to: path.to.creditMemos,
          icon: <LuCreditCard />,
          table: "memo",
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
