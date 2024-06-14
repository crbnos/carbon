import { useParams } from "@remix-run/react";

import {
  LuBox,
  LuFileBarChart,
  LuFileText,
  LuShare2,
  LuShoppingCart,
  LuTags,
} from "react-icons/lu";
import { DetailSidebar } from "~/components/Layout";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

export function useToolNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: "Details",
      to: path.to.toolDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: path.to.toolPurchasing(itemId),
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Suppliers",
      to: path.to.toolSuppliers(itemId),
      role: ["employee", "supplier"],
      icon: LuShare2,
      shortcut: "Command+Shift+s",
    },

    {
      name: "Costing",
      to: path.to.toolCosting(itemId),
      role: ["employee", "supplier"],
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Planning",
      to: path.to.toolPlanning(itemId),
      role: ["employee"],
      icon: LuFileBarChart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Inventory",
      to: path.to.toolInventory(itemId),
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i",
    },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}

const ToolNavigation = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const links = useToolNavigation();

  return <DetailSidebar links={links} />;
};

export default ToolNavigation;
