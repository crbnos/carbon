// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Gate } from "@carbon/database/access";
import { useLingui } from "@lingui/react/macro";
import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuFiles,
  LuLandmark,
  LuMapPin,
  LuReceipt,
  LuShieldAlert,
  LuTruck
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
};

export function useCustomerSidebar({ contacts, locations }: Props) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  return [
    {
      name: t`Details`,
      to: path.to.customerDetails(customerId),
      icon: <LuBuilding />,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Contacts`,
      to: path.to.customerContacts(customerId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: DETAIL_TAB_SHORTCUTS.contacts
    },
    {
      name: t`Locations`,
      to: path.to.customerLocations(customerId),
      role: ["employee", "customer"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: DETAIL_TAB_SHORTCUTS.locations
    },
    {
      name: t`Payment`,
      to: path.to.customerPayment(customerId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: DETAIL_TAB_SHORTCUTS.payment
    },
    {
      name: t`Bank Accounts`,
      to: path.to.customerBankAccounts(customerId),
      role: ["employee"],
      // Bank accounts sit on the Customers page.
      gate: { "sales.customers": "View" } as Gate,
      icon: <LuLandmark />
    },
    {
      name: t`Documents`,
      to: path.to.customerDocuments(customerId),
      role: ["employee"],
      icon: <LuFiles />
    },
    {
      name: t`Tax`,
      to: path.to.customerTax(customerId),
      role: ["employee"],
      icon: <LuReceipt />,
      shortcut: DETAIL_TAB_SHORTCUTS.tax
    },
    {
      name: t`Shipping`,
      to: path.to.customerShipping(customerId),
      role: ["employee"],
      icon: <LuTruck />,
      shortcut: DETAIL_TAB_SHORTCUTS.shipping
    },
    {
      name: t`Risks`,
      to: path.to.customerRisks(customerId),
      role: ["employee"],
      icon: <LuShieldAlert />
    },
    {
      name: t`RFQs`,
      to: `${path.to.salesRfqs}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress2Line />
    },
    {
      name: t`Quotes`,
      to: `${path.to.quotes}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress4Line />
    },
    {
      name: t`Orders`,
      to: `${path.to.salesOrders}?filter=customerId:eq:${customerId}`,
      role: ["employee"],
      icon: <RiProgress8Line />
    },
    {
      name: t`Invoices`,
      to: `${path.to.invoicingSales}?filter=customerId:eq:${customerId}`,
      icon: <LuCreditCard />
    }
    // {
    //   name: "Accounting",
    //   to: path.to.customerAccounting(customerId),
    //   role: ["employee"],
    //   icon: <LuLandmark />,
    //   shortcut: DETAIL_TAB_SHORTCUTS.accounting,
    // },
  ].filter((item) => {
    // `role` gates on WHO the user is (employee / supplier / customer);
    // `gate` gates on WHAT they may do (a page at a level).
    const roleOk =
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role));
    const gate = (item as { gate?: Gate }).gate;
    const permissionOk = gate === undefined || permissions.has(gate);
    return roleOk && permissionOk;
  });
}
