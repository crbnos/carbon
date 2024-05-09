import { useParams } from "@remix-run/react";
import { LuFileText, LuList } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  lines?: number;
  externalDocuments?: number;
  internalDocuments?: number;
};

export function useSalesOrderSidebar({
  lines = 0,
  internalDocuments = 0,
  externalDocuments = 0,
}: Props) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const permissions = usePermissions();
  return [
    {
      name: "Summary",
      to: path.to.salesOrderDetails(orderId),
      icon: LuFileText,
      shortcut: "Command+Shift+s",
    },
    {
      name: "Lines",
      to: path.to.salesOrderLines(orderId),
      count: lines,
      icon: LuList,
      shortcut: "Command+Shift+l",
      role: ["employee", "customer"],
    },
    /*{
      name: "Shipment",
      to: path.to.salesOrderShipment(orderId),
      role: ["employee", "customer"],
      icon: BsTruck,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Payment",
      to: path.to.salesOrderPayment(orderId),
      role: ["employee"],
      icon: BsCreditCard,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Internal Documents",
      to: path.to.salesOrderInternalDocuments(orderId),
      role: ["employee"],
      count: internalDocuments,
      icon: HiOutlineDocumentArrowDown,
      shortcut: "Command+Shift+i",
    },
    {
      name: "External Documents",
      to: path.to.salesOrderExternalDocuments(orderId),
      role: ["employee", "customer"],
      count: externalDocuments,
      icon: HiOutlineDocumentArrowUp,
      shortcut: "Command+Shift+e",
    },*/
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
