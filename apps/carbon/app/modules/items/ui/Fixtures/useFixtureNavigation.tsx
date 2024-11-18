import { useParams } from "@remix-run/react";

import { BiListCheck } from "react-icons/bi";
import { LuBox, LuFileText, LuShoppingCart, LuTags } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { Role } from "~/types";
import { path } from "~/utils/path";
import type { Fixture } from "../../types";

export function useFixtureNavigation() {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    fixtureSummary: Fixture;
  }>(path.to.fixture(itemId));
  if (!routeData?.fixtureSummary?.replenishmentSystem)
    throw new Error("Could not find replenishmentSystem in routeData");
  if (!routeData?.fixtureSummary?.itemTrackingType)
    throw new Error("Could not find itemTrackingType in routeData");

  const replenishment = routeData.fixtureSummary.replenishmentSystem;
  const itemTrackingType = routeData.fixtureSummary.itemTrackingType;

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
      isDisabled: replenishment === "Make",
      role: ["employee", "supplier"],
      icon: LuShoppingCart,
      shortcut: "Command+Shift+p",
    },
    {
      name: "Manufacturing",
      to: path.to.fixtureManufacturing(itemId),
      isDisabled: replenishment === "Buy",
      role: ["employee"],
      icon: BiListCheck,
      shortcut: "Command+Shift+m",
    },
    {
      name: "Costing",
      to: path.to.fixtureCosting(itemId),
      role: ["employee"],
      icon: LuTags,
      shortcut: "Command+Shift+c",
    },
    {
      name: "Inventory",
      to: path.to.fixtureInventory(itemId),
      isDisabled: itemTrackingType === "Non-Inventory",
      role: ["employee", "supplier"],
      icon: LuBox,
      shortcut: "Command+Shift+i",
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}
