// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuFiles,
  LuLandmark,
  LuMapPin,
  LuReceipt,
  LuServer,
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
import { OPEN_LIST, visibleRoutes } from "~/utils/nav";
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
  const tabs = [
    {
      name: t`Details`,
      to: path.to.customerDetails(customerId),
      icon: <LuBuilding />,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Contacts`,
      to: path.to.customerContacts(customerId),
      count: contacts,
      icon: <LuContact />,
      shortcut: DETAIL_TAB_SHORTCUTS.contacts
    },
    {
      name: t`Locations`,
      to: path.to.customerLocations(customerId),
      count: locations,
      icon: <LuMapPin />,
      shortcut: DETAIL_TAB_SHORTCUTS.locations
    },
    {
      name: t`Payment`,
      to: path.to.customerPayment(customerId),
      icon: <LuCreditCard />,
      shortcut: DETAIL_TAB_SHORTCUTS.payment
    },
    {
      name: t`Bank Accounts`,
      to: path.to.customerBankAccounts(customerId),
      icon: <LuLandmark />
    },
    {
      name: t`Documents`,
      to: path.to.customerDocuments(customerId),
      icon: <LuFiles />
    },
    {
      name: t`Tax`,
      to: path.to.customerTax(customerId),
      icon: <LuReceipt />,
      shortcut: DETAIL_TAB_SHORTCUTS.tax
    },
    {
      name: t`Shipping`,
      to: path.to.customerShipping(customerId),
      icon: <LuTruck />,
      shortcut: DETAIL_TAB_SHORTCUTS.shipping
    },
    {
      name: t`Risks`,
      to: path.to.customerRisks(customerId),
      icon: <LuShieldAlert />
    },
    {
      name: t`Assets`,
      to: path.to.customerAssetsTab(customerId),
      icon: <LuServer />
    },
    {
      name: t`RFQs`,
      to: `${path.to.salesRfqs}?filter=customerId:eq:${customerId}`,
      gate: OPEN_LIST,
      icon: <RiProgress2Line />
    },
    {
      name: t`Quotes`,
      to: `${path.to.quotes}?filter=customerId:eq:${customerId}`,
      gate: OPEN_LIST,
      icon: <RiProgress4Line />
    },
    {
      name: t`Orders`,
      to: `${path.to.salesOrders}?filter=customerId:eq:${customerId}`,
      gate: OPEN_LIST,
      icon: <RiProgress8Line />
    },
    {
      name: t`Invoices`,
      to: `${path.to.invoicingSales}?filter=customerId:eq:${customerId}`,
      gate: OPEN_LIST,
      icon: <LuCreditCard />
    }
  ];
  return visibleRoutes(tabs, permissions);
}
