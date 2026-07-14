import { useLingui } from "@lingui/react/macro";
import {
  LuChartLine,
  LuCirclePlay,
  LuListChecks,
  LuSquareChartGantt,
  LuSquareKanban,
  LuStepForward,
  LuTrash
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const internalOnlyRoutes = new Set<string>([path.to.assemblyInstructions]);

export default function useProductionSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { isInternal } = useFlags();

  const productionRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Production`,
      routes: [
        {
          name: t`Jobs`,
          to: path.to.jobs,
          icon: <LuCirclePlay />,
          table: "job"
        }
      ]
    },
    {
      name: t`Plan`,
      routes: [
        {
          name: t`Planning`,
          to: path.to.productionPlanning,
          icon: <LuSquareChartGantt />,
          table: "production-planning"
        },
        {
          name: t`Projections`,
          to: path.to.demandProjections,
          icon: <LuChartLine />,
          table: "demand-projection"
        },
        {
          name: t`Schedule`,
          to: path.to.scheduleDates,
          icon: <LuSquareKanban />
        }
      ]
    },
    {
      name: t`Work Instructions`,
      routes: [
        {
          name: t`Assemblies`,
          to: path.to.assemblyInstructions,
          icon: <LuStepForward />,
          role: "employee"
        },
        {
          name: t`Procedures`,
          to: path.to.procedures,
          icon: <LuListChecks />,
          table: "procedure",
          role: "employee"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Scrap Reasons`,
          to: path.to.scrapReasons,
          role: "employee",
          icon: <LuTrash />
        }
      ]
    }
  ];
  const { addSavedViewsToRoutes } = useSavedViews();

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) => {
    if (route.role && !permissions.is(route.role)) return false;
    if (!isInternal && internalOnlyRoutes.has(route.to)) return false;
    return true;
  };

  return {
    groups: productionRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
  };
}
