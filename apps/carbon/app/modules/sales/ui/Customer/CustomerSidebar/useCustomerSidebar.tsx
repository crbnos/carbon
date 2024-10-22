import { useParams } from "@remix-run/react";
import { LuBuilding, LuContact, LuCreditCard, LuMapPin } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  contacts: number;
  locations: number;
};

export function useCustomerSidebar({ contacts, locations }: Props) {
  const permissions = usePermissions();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");
  return [
    {
      name: "Details",
      to: path.to.customerDetails(customerId),
      icon: <LuBuilding />,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Contacts",
      to: path.to.customerContacts(customerId),
      role: ["employee"],
      count: contacts,
      icon: <LuContact />,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Locations",
      to: path.to.customerLocations(customerId),
      role: ["employee", "customer"],
      count: locations,
      icon: <LuMapPin />,
      shortcut: "Command+Shift+l",
    },
    {
      name: "Payment Terms",
      to: path.to.customerPayment(customerId),
      role: ["employee"],
      icon: <LuCreditCard />,
      shortcut: "Command+Shift+p",
    },
    // {
    //   name: "Shipping",
    //   to: path.to.customerShipping(customerId),
    //   role: ["employee"],
    //   icon: <LuTruck />,
    //   shortcut: "Command+Shift+s",
    // },
    // {
    //   name: "Accounting",
    //   to: path.to.customerAccounting(customerId),
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
