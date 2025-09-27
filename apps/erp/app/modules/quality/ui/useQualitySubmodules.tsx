import {
  LuCircleGauge,
  LuDraftingCompass,
  LuFileText,
  LuListChecks,
  LuOctagonX,
  LuSearch,
  LuShapes,
  LuShieldX,
  LuSquareCheck,
  LuWorkflow,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const qualityRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "History",
    routes: [
      {
        name: "Actions",
        to: path.to.qualityActions,
        icon: <LuListChecks />,
        table: "nonConformanceActionTask",
      },

      {
        name: "Issues",
        to: path.to.issues,
        icon: <LuShieldX />,
        table: "nonConformance",
      },
      // {
      //   name: "Inspections",
      //   to: "#",
      //   icon: <LuSearchCheck />,
      //   table: "inspection",
      // },
    ],
  },
  {
    name: "Gauges",
    routes: [
      {
        name: "Gauges",
        to: path.to.gauges,
        icon: <LuDraftingCompass />,
      },
      {
        name: "Calibrations",
        to: path.to.calibrations,
        icon: <LuCircleGauge />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Action Types",
        to: path.to.requiredActions,
        icon: <LuSquareCheck />,
      },
      {
        name: "Documents",
        to: path.to.qualityDocuments,
        icon: <LuFileText />,
        table: "qualityDocument",
      },
      {
        name: "Gauge Types",
        to: path.to.gaugeTypes,
        icon: <LuShapes />,
      },
      {
        name: "Investigation Types",
        to: path.to.investigationTypes,
        icon: <LuSearch />,
      },
      {
        name: "Issue Types",
        to: path.to.issueTypes,
        icon: <LuOctagonX />,
      },
      {
        name: "Issue Workflows",
        to: path.to.issueWorkflows,
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
