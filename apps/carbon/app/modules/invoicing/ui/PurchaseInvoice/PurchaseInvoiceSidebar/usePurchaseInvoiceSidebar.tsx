import { LuFileText, LuList } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";

type Props = {
  lines?: number;
};

export function usePurchaseInvoiceSidebar({ lines = 0 }: Props) {
  const permissions = usePermissions();
  return [
    {
      name: "Summary",
      to: "details",
      icon: LuFileText,
      shortcut: "Command+Shift+s",
      role: ["employee"],
    },
    {
      name: "Lines",
      to: "lines",
      count: lines,
      icon: LuList,
      shortcut: "Command+Shift+l",
      role: ["employee"],
    },
    // {
    //   name: "Payment",
    //   to: "payment",
    //   role: ["employee"],
    //   icon: BsCreditCard,
    //   shortcut: "Command+Shift+p",
    // },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
