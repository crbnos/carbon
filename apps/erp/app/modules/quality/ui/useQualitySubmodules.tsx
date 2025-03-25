import {
  LuCircleGauge,
  LuCircleHelp,
  LuClipboardList,
  LuDraftingCompass,
  LuOctagonX,
  LuSearchCheck,
  LuShieldX,
  LuSpellCheck,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";

const inventoryRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Quality Plans",
        to: "#",
        icon: <LuClipboardList />,
      },
      {
        name: "Issues",
        to: "#",
        icon: <LuShieldX />,
        table: "qualityIssue",
      },
      {
        name: "Corrective Actions",
        to: "#",
        icon: <LuSpellCheck />,
        table: "correctiveAction",
      },
      {
        name: "Inspections",
        to: "#",
        icon: <LuSearchCheck />,
        table: "inspection",
      },
    ],
  },
  {
    name: "Gauges",
    routes: [
      {
        name: "Gauges",
        to: "#",
        icon: <LuDraftingCompass />,
      },
      {
        name: "Calibrations",
        to: "#",
        icon: <LuCircleGauge />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Cause Codes",
        to: "#",
        icon: <LuCircleHelp />,
      },
      {
        name: "Non-Conformance Codes",
        to: "#",
        icon: <LuOctagonX />,
      },
    ],
  },
];
export default function useAccountingSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: inventoryRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes),
      })),
  };
}
