import { useParams } from "@remix-run/react";
import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuLayoutList,
  LuMapPin,
  LuPackageSearch,
 LuCog } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
};

export function useSupplierSidebar({ contacts, locations }: Props) {
  const permissions = usePermissions();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  return [
    {
      name: "Details",
      to: path.to.supplierDetails(supplierId),
      icon: <LuBuilding />,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Contacts",
      to: path.to.supplierContacts(supplierId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Locations",
      to: path.to.supplierLocations(supplierId),
      role: ["employee", "supplier"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: "Command+Shift+l",
    },
    {
      name: "Payment Terms",
      to: path.to.supplierPayment(supplierId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Processes",
      to: path.to.supplierProcesses(supplierId),
      role: ["employee"],
      icon: <LuCog />,
      shortcut: "Command+Shift+r",
    },
    {
      name: "Quotes",
      to: `${path.to.supplierQuotes}?filter=supplierId:eq:${supplierId}`,

      icon: <LuPackageSearch />,
    },
    {
      name: "Orders",
      to: `${path.to.purchaseOrders}?filter=supplierId:eq:${supplierId}`,
      icon: <LuLayoutList />,
    },
    {
      name: "Invoices",
      to: `${path.to.purchaseInvoices}?filter=supplierId:eq:${supplierId}`,
      icon: <LuCreditCard />,
    },
    // {
    //   name: "Shipping",
    //   to: path.to.supplierShipping(supplierId),
    //   role: ["employee"],
    //   icon: <LuTruck />,
    //   shortcut: "Command+Shift+s",
    // },
    // {
    //   name: "Accounting",
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
