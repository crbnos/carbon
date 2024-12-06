import { useParams } from "@remix-run/react";
import { BsCreditCard, BsTruck } from "react-icons/bs";
import { LuFileDown, LuFileText, LuFileUp, LuList } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

type Props = {
  lines?: number;
  externalDocuments?: number;
  internalDocuments?: number;
};

export function usePurchaseOrderSidebar({ lines = 0 }: Props) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const permissions = usePermissions();
  return [
    {
      name: "Summary",
      to: path.to.purchaseOrderDetails(orderId),
      icon: <LuFileText />,
      shortcut: "Command+Shift+s",
    },
    {
      name: "Lines",
      to: path.to.purchaseOrderLines(orderId),
      count: lines,
      icon: <LuList />,
      shortcut: "Command+Shift+l",
    },
    {
      name: "Delivery",
      to: path.to.purchaseOrderDelivery(orderId),
      role: ["employee", "supplier"],
      icon: <BsTruck />,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Payment",
      to: path.to.purchaseOrderPayment(orderId),
      role: ["employee"],
      icon: <BsCreditCard />,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Internal Documents",
      to: path.to.purchaseOrderInternalDocuments(orderId),
      role: ["employee"],
      icon: <LuFileDown />,
      shortcut: "Command+Shift+i",
    },
    {
      name: "External Documents",
      to: path.to.purchaseOrderExternalDocuments(orderId),
      role: ["employee", "supplier"],
      icon: <LuFileUp />,
      shortcut: "Command+Shift+e",
    },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
