import { useParams } from "@remix-run/react";

import {
  LuBox,
  LuFileText,
  LuShare2,
  LuShoppingCart,
  LuTags,
} from "react-icons/lu";
import { DetailSidebar } from "~/components/Layout";
import { usePermissions } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";

export function useFixtureNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: "Details",
      to: path.to.fixtureDetails(itemId),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Purchasing",
      to: path.to.fixturePurchasing(itemId),
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Suppliers",
      to: path.to.fixtureSuppliers(itemId),
      role: ["employee", "supplier"],
      icon: LuShare2,
      shortcut: "Command+Shift+s",
    },

    {
      name: "Costing",
      to: path.to.fixtureCosting(itemId),
      role: ["employee", "supplier"],
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Inventory",
      to: path.to.fixtureInventory(itemId),
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

const FixtureNavigation = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const links = useFixtureNavigation();

  return <DetailSidebar links={links} />;
};

export default FixtureNavigation;
