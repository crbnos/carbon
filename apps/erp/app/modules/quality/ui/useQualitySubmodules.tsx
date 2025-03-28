import {
  LuCircleGauge,
  LuClipboardList,
  LuDraftingCompass,
  LuFileText,
  LuOctagonX,
  LuSearchCheck,
  LuShieldX,
  LuSpellCheck,
  LuWorkflow,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const qualityRoutes: AuthenticatedRouteGroup[] = [
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
    name: "Configure Issues",
    routes: [
      {
        name: "Templates",
        to: path.to.nonConformanceTemplates,
        icon: <LuFileText />,
      },
      {
        name: "Types",
        to: path.to.nonConformanceTypes,
        icon: <LuOctagonX />,
      },
      {
        name: "Workflows",
        to: "#",
        icon: <LuWorkflow />,
      },
    ],
  },
];
export default function useQualitySubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: qualityRoutes
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
