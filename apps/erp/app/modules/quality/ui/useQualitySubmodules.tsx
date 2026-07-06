import { useLingui } from "@lingui/react/macro";
import { IoBalloonOutline } from "react-icons/io5";
import {
  LuCircleGauge,
  LuClipboardCheck,
  LuDraftingCompass,
  LuFileText,
  LuListChecks,
  LuOctagonX,
  LuShapes,
  LuShieldAlert,
  LuShieldX,
  LuSquareCheck,
  LuWorkflow
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useQualitySubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const qualityRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Issues`,
      routes: [
        {
          name: t`Actions`,
          to: path.to.qualityActions,
          icon: <LuListChecks />,
          table: "nonConformanceActionTask"
        },

        {
          name: t`Issues`,
          to: path.to.issues,
          icon: <LuShieldX />,
          table: "nonConformance"
        },
        {
          name: t`Risks`,
          to: path.to.risks,
          icon: <LuShieldAlert />,
          table: "riskRegister"
        }
      ]
    },
    {
      name: t`Calibrations`,
      routes: [
        {
          name: t`Gauges`,
          to: path.to.gauges,
          icon: <LuDraftingCompass />
        },
        {
          name: t`Records`,
          to: path.to.calibrations,
          icon: <LuCircleGauge />
        }
      ]
    },
    {
      name: t`Inspection`,
      routes: [
        {
          name: t`Inbound Inspections`,
          to: path.to.inboundInspections,
          icon: <LuClipboardCheck />,
          table: "inboundInspection"
        },
        {
          name: t`Inspection Documents`,
          to: path.to.inspectionDocuments,
          icon: <IoBalloonOutline />
        }
      ]
    },
    {
      name: t`Document Control`,
      routes: [
        {
          name: t`Quality Documents`,
          to: path.to.qualityDocuments,
          icon: <LuFileText />,
          table: "qualityDocument"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Action Types`,
          to: path.to.requiredActions,
          icon: <LuSquareCheck />
        },

        {
          name: t`Gauge Types`,
          to: path.to.gaugeTypes,
          icon: <LuShapes />
        },
        {
          name: t`Issue Types`,
          to: path.to.issueTypes,
          icon: <LuOctagonX />
        },
        {
          name: t`Issue Workflows`,
          to: path.to.issueWorkflows,
          icon: <LuWorkflow />
        }
      ]
    }
  ];

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
          .map(addSavedViewsToRoutes)
      }))
  };
}
