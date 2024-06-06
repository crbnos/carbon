import { LuFileText, LuShare2 } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { ServiceType } from "~/modules/items/types";
import type { Role } from "~/types";

export function useServiceSidebar(type: ServiceType) {
  const permissions = usePermissions();
  return [
    {
      name: "Details",
      to: "details",
      icon: LuFileText,
    },
    {
      name: "Suppliers",
      to: "suppliers",
      isDisabled: type === "Internal",
      role: ["employee", "supplier"],
      icon: LuShare2,
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}
