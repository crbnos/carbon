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
  LuLayoutList,
  LuMapPin,
  LuPackage,
  LuPackageSearch,
  LuReceipt,
  LuRedoDot,
  LuShieldAlert,
  LuTruck
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import { OPEN_LIST, visibleRoutes } from "~/utils/nav";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
  parts: number;
};

export function useSupplierSidebar({ contacts, locations, parts }: Props) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const tabs = [
    {
      name: t`Details`,
      to: path.to.supplierDetails(supplierId),
      icon: <LuBuilding />,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Contacts`,
      to: path.to.supplierContacts(supplierId),
      count: contacts,
      icon: <LuContact />,
      shortcut: DETAIL_TAB_SHORTCUTS.contacts
    },
    {
      name: t`Locations`,
      to: path.to.supplierLocations(supplierId),
      count: locations,
      icon: <LuMapPin />,
      shortcut: DETAIL_TAB_SHORTCUTS.locations
    },
    {
      name: t`Payment`,
      to: path.to.supplierPayment(supplierId),
      icon: <LuCreditCard />,
      shortcut: DETAIL_TAB_SHORTCUTS.payment
    },
    {
      name: t`Tax`,
      to: path.to.supplierTax(supplierId),
      icon: <LuReceipt />,
      shortcut: DETAIL_TAB_SHORTCUTS.tax
    },
    {
      name: t`Shipping`,
      to: path.to.supplierShipping(supplierId),
      icon: <LuTruck />,
      shortcut: DETAIL_TAB_SHORTCUTS.shipping
    },
    {
      name: t`Processes`,
      to: path.to.supplierProcesses(supplierId),
      icon: <LuRedoDot />,
      shortcut: DETAIL_TAB_SHORTCUTS.processes
    },
    {
      name: t`Parts`,
      to: path.to.supplierParts(supplierId),
      count: parts,
      icon: <LuPackage />
    },
    {
      name: t`Documents`,
      to: path.to.supplierDocuments(supplierId),
      icon: <LuFiles />
    },
    {
      name: t`Default Attachments`,
      to: path.to.supplierDefaultAttachments(supplierId),
      icon: <LuFiles />
    },
    {
      name: t`Bank Accounts`,
      to: path.to.supplierBankAccounts(supplierId),
      icon: <LuLandmark />
    },
    {
      name: t`Risks`,
      to: path.to.supplierRisks(supplierId),
      icon: <LuShieldAlert />
    },
    {
      name: t`Quotes`,
      to: `${path.to.supplierQuotes}?filter=supplierId:eq:${supplierId}`,
      gate: OPEN_LIST,
      icon: <LuPackageSearch />
    },
    {
      name: t`Orders`,
      to: `${path.to.purchaseOrders}?filter=supplierId:eq:${supplierId}`,
      gate: OPEN_LIST,
      icon: <LuLayoutList />
    },
    {
      name: t`Invoices`,
      to: `${path.to.invoicingPurchasing}?filter=supplierId:eq:${supplierId}`,
      gate: OPEN_LIST,
      icon: <LuCreditCard />
    }
  ];
  return visibleRoutes(tabs, permissions);
}
