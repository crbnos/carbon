import { useParams } from "@remix-run/react";
import {
  LuBuilding,
  LuContact,
  LuCreditCard,
  LuMapPin,
  LuTruck,
} from "react-icons/lu";
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
      icon: LuBuilding,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Contacts",
      to: path.to.supplierContacts(supplierId),
      role: ["employee"],
      count: contacts,
      icon: LuContact,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Locations",
      to: path.to.supplierLocations(supplierId),
      role: ["employee", "supplier"],
      count: locations,
      icon: LuMapPin,
      shortcut: "Command+Shift+l",
    },
    {
      name: "Payments",
      to: path.to.supplierPayment(supplierId),
      role: ["employee"],
      icon: LuCreditCard,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Shipping",
      to: path.to.supplierShipping(supplierId),
      role: ["employee"],
      icon: LuTruck,
      shortcut: "Command+Shift+s",
    },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
