import { useParams } from "@remix-run/react";

import { LuFileText } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { NonConformance } from "../../types";

export function useNonConformanceNavigation() {
  const permissions = usePermissions();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ nonConformance: NonConformance }>(
    path.to.nonConformance(id)
  );
  if (!routeData?.nonConformance?.source)
    throw new Error("Could not find source in routeData");

  const isExternal = routeData.nonConformance.source === "External";

  return [
    {
      name: "Details",
      to: path.to.nonConformanceDetails(id),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
      isDisabled: false,
    },
  ].filter((item) => !item.isDisabled);
}
