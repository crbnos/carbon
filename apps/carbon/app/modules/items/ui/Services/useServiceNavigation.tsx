import { LuFileText, LuShoppingCart } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { ServiceType } from "~/modules/items/types";
import type { Role } from "~/types";

export function useServiceNavigation(type: ServiceType) {
  const permissions = usePermissions();
  return [
    {
      name: "Details",
      to: "details",
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: "purchasing",
      isDisabled: type === "Internal",
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}
