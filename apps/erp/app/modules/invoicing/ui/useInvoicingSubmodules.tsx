// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    return (
      (!route.role || permissions.is(route.role)) &&
      (!route.page || permissions.has({ [route.page]: "View" }))
    );
  };

  const invoicingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Accounts Payable`,
      routes: [
        {
          name: t`Payables`,
          to: path.to.payables,
          page: "invoicing.payables",
          icon: <BanknoteArrowUp />
        },
        {
          name: t`Purchase Invoices`,
          to: path.to.invoicingPurchasing,
          page: "invoicing.purchaseInvoices",
          icon: <LuReceiptText />,
          table: "purchaseInvoice"
        },
        {
          name: t`Supplier Credits`,
          to: path.to.supplierCredits,
          page: "invoicing.supplierCredits",
          icon: <LuCreditCard />,
          table: "memo"
        },
        {
          name: t`Charges`,
          to: path.to.charges,
          page: "invoicing.charges",
          icon: <LuReceipt />,
          table: "charge"
        },
        {
          name: t`Reimbursements`,
          to: path.to.reimbursements,
          page: "invoicing.reimbursements",
          icon: <LuWallet />,
          table: "reimbursement"
        }
      ]
    },
    {
      name: t`Accounts Receivable`,
      routes: [
        {
          name: t`Receivables`,
          to: path.to.receivables,
          page: "invoicing.receivables",
          icon: <BanknoteArrowDown />
        },
        {
          name: t`Sales Invoices`,
          to: path.to.invoicingSales,
          page: "invoicing.salesInvoices",
          icon: <LuCreditCard />,
          table: "salesInvoice"
        },
        {
          name: t`Credit Memos`,
          to: path.to.creditMemos,
          page: "invoicing.creditMemos",
          icon: <LuCreditCard />,
          table: "memo"
        }
      ]
    },

    {
      name: t`Payments`,
      routes: [
        {
          name: t`Payments`,
          to: path.to.payments,
          page: "invoicing.payments",
          icon: <LuBanknote />,
          table: "payment"
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
