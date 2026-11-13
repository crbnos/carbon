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
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

export default function useInvoicingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  // Charges are a first-class Carbon document with their own posting path, so
  // the nav entry is NOT gated on a spend integration being connected — an
  // empty list is discoverable, a missing nav entry is not. Permission is the
  // only gate (as it is for every other invoicing route).

  const invoicingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Accounts Payable`,
      routes: [
        {
          name: t`Payables`,
          to: path.to.payables,
          icon: <BanknoteArrowUp />
        },
        {
          name: t`Purchase Invoices`,
          to: path.to.invoicingPurchasing,
          icon: <LuReceiptText />,
          table: "purchaseInvoice"
        },
        {
          name: t`Supplier Credits`,
          to: path.to.supplierCredits,
          icon: <LuCreditCard />,
          table: "memo"
        },
        {
          name: t`Charges`,
          to: path.to.charges,
          icon: <LuReceipt />,
          table: "charge"
        },
        {
          name: t`Reimbursements`,
          to: path.to.reimbursements,
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
          icon: <BanknoteArrowDown />
        },
        {
          name: t`Sales Invoices`,
          to: path.to.invoicingSales,
          icon: <LuCreditCard />,
          table: "salesInvoice"
        },
        {
          name: t`Credit Memos`,
          to: path.to.creditMemos,
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
          icon: <LuBanknote />,
          table: "payment"
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(invoicingRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
