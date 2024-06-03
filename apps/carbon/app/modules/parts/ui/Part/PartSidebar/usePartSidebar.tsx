import { useParams } from "@remix-run/react";
import { BiListCheck } from "react-icons/bi";
import {
  LuBox,
  LuFileBarChart,
  LuFileText,
  LuReceipt,
  LuShare2,
  LuShoppingCart,
  LuTags,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { PartReplenishmentSystem } from "~/modules/parts/types";
import type { Role } from "~/types";
import { path } from "~/utils/path";

export function usePartSidebar(replenishment: PartReplenishmentSystem) {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: "Details",
      to: path.to.partDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: path.to.partPurchasing(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Suppliers",
      to: path.to.partSuppliers(itemId),
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      icon: LuShare2,
      shortcut: "Command+Shift+s",
    },
    {
      name: "Manufacturing",
      to: path.to.partManufacturing(itemId),
      isDisabled: replenishment === "Buy",
      role: ["employee"],
      icon: BiListCheck,
      shortcut: "Command+Shift+m",
    },
    {
      name: "Costing",
      to: path.to.partCosting(itemId),
      role: ["employee", "supplier"],
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Planning",
      to: path.to.partPlanning(itemId),
      role: ["employee"],
      icon: LuFileBarChart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Inventory",
      to: path.to.partInventory(itemId),
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i",
    },
    {
      name: "Sale Price",
      to: path.to.partSalePrice(itemId),
      role: ["employee", "customer"],
      icon: LuReceipt,
      shortcut: "Command+Shift+x",
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}
