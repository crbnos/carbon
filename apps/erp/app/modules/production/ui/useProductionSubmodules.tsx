import { useLingui } from "@lingui/react/macro";
import { IoBalloonOutline } from "react-icons/io5";
import {
  LuChartBarBig,
  LuChartLine,
  LuCirclePlay,
  LuListChecks,
  LuListTodo,
  LuSquareChartGantt,
  LuSquareKanban,
  LuStepForward,
  LuTrash
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useProductionSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();

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
      name: t`Planning`,
      routes: [
        {
          name: t`Demand Forecasts`,
          to: path.to.demandProjections,
          icon: <LuChartLine />,
          table: "demand-projection"
        },
        {
          name: t`Material Planning`,
          to: path.to.productionPlanning,
          icon: <LuListTodo />,
          table: "production-planning"
        },
        {
          name: t`Resource Planning`,
          to: path.to.priorityPeople,
          icon: <LuChartBarBig />
        }
      ]
    },
    {
      name: t`Scheduling`,
      routes: [
        {
          name: t`Forecast`,
          to: path.to.scheduleForecast,
          icon: <LuSquareChartGantt />
        },
        {
          name: t`Priorities`,
          to: path.to.priorityDates,
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
          name: t`Inspection Plans`,
          to: path.to.inspectionDocuments,
          icon: <IoBalloonOutline />,
          permission: "quality"
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
    if (route.permission && !permissions.can("view", route.permission))
      return false;
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
