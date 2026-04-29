import { useLingui } from "@lingui/react/macro";
import {
  LuBuilding,
  LuCog,
  LuContact,
  LuCreditCard,
  LuLayoutList,
  LuMapPin,
  LuPackageSearch,
  LuShieldAlert,
  LuTruck
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
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
      shortcut: "Command+Shift+d"
    },
    {
      name: t`Contacts`,
      to: path.to.supplierContacts(supplierId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: "Command+Shift+c"
    },
    {
      name: t`Locations`,
      to: path.to.supplierLocations(supplierId),
      role: ["employee", "supplier"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: "Command+Shift+l"
    },
    {
      name: t`Payment`,
      to: path.to.supplierPayment(supplierId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: "Command+Shift+p"
    },
    {
      name: t`Shipping`,
      to: path.to.supplierShipping(supplierId),
      role: ["employee"],
      icon: <LuTruck />,
      shortcut: "Command+Shift+s"
    },
    {
      name: t`Processes`,
      to: path.to.supplierProcesses(supplierId),
      role: ["employee"],
      icon: <LuCog />,
      shortcut: "Command+Shift+r"
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
      to: `${path.to.purchaseInvoices}?filter=supplierId:eq:${supplierId}`,
      icon: <LuCreditCard />
    }
    // {
    //   name: t`Shipping`,
    //   to: path.to.supplierShipping(supplierId),
    //   role: ["employee"],
    //   icon: <LuTruck />,
    //   shortcut: "Command+Shift+s",
    // },
    // {
    //   name: t`Accounting`,
    //   to: path.to.supplierAccounting(supplierId),
    //   role: ["employee"],
    //   icon: <LuLandmark />,
    //   shortcut: "Command+Shift+a",
    // },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
