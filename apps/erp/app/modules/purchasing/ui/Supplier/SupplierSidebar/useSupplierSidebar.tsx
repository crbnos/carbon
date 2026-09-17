import { useLingui } from "@lingui/react/macro";
import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuFiles,
  LuLayoutList,
  LuMapPin,
  LuPackageSearch,
  LuReceipt,
  LuRedoDot,
  LuShieldAlert,
  LuTruck
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
};

export function useSupplierSidebar({ contacts, locations }: Props) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  return [
    {
      name: t`Details`,
      to: path.to.supplierDetails(supplierId),
      icon: <LuBuilding />,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Contacts`,
      to: path.to.supplierContacts(supplierId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: DETAIL_TAB_SHORTCUTS.contacts
    },
    {
      name: t`Locations`,
      to: path.to.supplierLocations(supplierId),
      role: ["employee", "supplier"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: DETAIL_TAB_SHORTCUTS.locations
    },
    {
      name: t`Payment`,
      to: path.to.supplierPayment(supplierId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: DETAIL_TAB_SHORTCUTS.payment
    },
    {
      name: t`Tax`,
      to: path.to.supplierTax(supplierId),
      role: ["employee"],
      icon: <LuReceipt />,
      shortcut: DETAIL_TAB_SHORTCUTS.tax
    },
    {
      name: t`Shipping`,
      to: path.to.supplierShipping(supplierId),
      role: ["employee"],
      icon: <LuTruck />,
      shortcut: DETAIL_TAB_SHORTCUTS.shipping
    },
    {
      name: t`Processes`,
      to: path.to.supplierProcesses(supplierId),
      role: ["employee"],
      icon: <LuRedoDot />,
      shortcut: DETAIL_TAB_SHORTCUTS.processes
    },
    {
      name: t`Default Attachments`,
      to: path.to.supplierDefaultAttachments(supplierId),
      role: ["employee"],
      icon: <LuFiles />
    },
    {
      name: t`Risks`,
      to: path.to.supplierRisks(supplierId),
      role: ["employee"],
      icon: <LuShieldAlert />
    },
    {
      name: t`Quotes`,
      to: `${path.to.supplierQuotes}?filter=supplierId:eq:${supplierId}`,

      icon: <LuPackageSearch />
    },
    {
      name: t`Orders`,
      to: `${path.to.purchaseOrders}?filter=supplierId:eq:${supplierId}`,
      icon: <LuLayoutList />
    },
    {
      name: t`Invoices`,
      to: `${path.to.invoicingPurchasing}?filter=supplierId:eq:${supplierId}`,
      icon: <LuCreditCard />
    }
    // {
    //   name: t`Shipping`,
    //   to: path.to.supplierShipping(supplierId),
    //   role: ["employee"],
    //   icon: <LuTruck />,
    //   shortcut: DETAIL_TAB_SHORTCUTS.shipping,
    // },
    // {
    //   name: t`Accounting`,
    //   to: path.to.supplierAccounting(supplierId),
    //   role: ["employee"],
    //   icon: <LuLandmark />,
    //   shortcut: DETAIL_TAB_SHORTCUTS.accounting,
    // },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
