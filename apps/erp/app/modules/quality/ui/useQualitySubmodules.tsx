// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
          page: "quality.actions",
          icon: <LuListChecks />,
          table: "nonConformanceActionTask"
        },

        {
          name: t`Issues`,
          to: path.to.issues,
          page: "quality.issues",
          icon: <LuShieldX />,
          table: "nonConformance"
        },
        {
          name: t`Risks`,
          to: path.to.risks,
          page: "quality.risks",
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
          page: "quality.gauges",
          icon: <LuDraftingCompass />
        },
        {
          name: t`Records`,
          to: path.to.calibrations,
          page: "quality.records",
          icon: <LuCircleGauge />
        }
      ]
    },
    {
      name: t`Inspection`,
      routes: [
        {
          name: t`Inspections`,
          to: path.to.inspections,
          page: "quality.inspections",
          icon: <LuClipboardCheck />,
          table: "inspection"
        },
        {
          name: t`Inspection Plans`,
          to: path.to.inspectionDocuments,
          page: "quality.inspectionPlans",
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
          page: "quality.qualityDocuments",
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
          page: "quality.actionTypes",
          icon: <LuSquareCheck />
        },

        {
          name: t`Gauge Types`,
          to: path.to.gaugeTypes,
          page: "quality.gaugeTypes",
          icon: <LuShapes />
        },
        {
          name: t`Issue Types`,
          to: path.to.issueTypes,
          page: "quality.issueTypes",
          icon: <LuOctagonX />
        },
        {
          name: t`Issue Workflows`,
          to: path.to.issueWorkflows,
          page: "quality.issueWorkflows",
          icon: <LuWorkflow />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: qualityRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          return isRouteVisible(route);
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            return isRouteVisible(route);
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
