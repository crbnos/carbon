// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuAtom,
  LuAxis3D,
  LuBeef,
  LuDessert,
  LuGitPullRequestArrow,
  LuGlassWater,
  LuGroup,
  LuHammer,
  LuHeadphones,
  LuListChecks,
  LuPizza,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuTags
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useItemsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();
  const itemsRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Items`,
      routes: [
        {
          name: t`Parts`,
          to: path.to.parts,
          page: "parts.parts",
          icon: <AiOutlinePartition />,
          table: "part"
        },
        {
          name: t`Materials`,
          to: path.to.materials,
          page: "parts.materials",
          icon: <LuAtom />,
          table: "material"
        },
        {
          name: t`Tools`,
          to: path.to.tools,
          page: "parts.tools",
          icon: <LuHammer />,
          table: "tool"
        },
        {
          name: t`Consumables`,
          to: path.to.consumables,
          page: "parts.consumables",
          icon: <LuPizza />,
          table: "consumable"
        },
        {
          name: t`Services`,
          to: path.to.services,
          page: "parts.services",
          icon: <LuHeadphones />,
          table: "service"
        }
      ]
    },
    {
      name: t`Change Notices`,
      routes: [
        {
          name: t`Change Notices`,
          to: path.to.changeNotices,
          page: "parts.changeNotices",
          icon: <LuGitPullRequestArrow />,
          table: "changeOrder"
        },
        {
          name: t`Change Notice Types`,
          to: path.to.changeNoticeTypes,
          page: "parts.changeNoticeTypes",
          icon: <LuTags />,
          role: "employee"
        },
        {
          name: t`Change Notice Actions`,
          to: path.to.changeNoticeRequiredActions,
          page: "parts.changeNoticeActions",
          icon: <LuListChecks />,
          role: "employee"
        }
      ]
    },
    {
      name: t`Material Properties`,
      routes: [
        {
          name: t`Dimensions`,
          to: path.to.materialDimensions,
          page: "parts.dimensions",
          icon: <LuAxis3D />,
          role: "employee"
        },
        {
          name: t`Finishes`,
          to: path.to.materialFinishes,
          page: "parts.finishes",
          icon: <LuDessert />,
          role: "employee"
        },
        {
          name: t`Grades`,
          to: path.to.materialGrades,
          page: "parts.grades",
          icon: <LuBeef />,
          role: "employee"
        },
        {
          name: t`Shapes`,
          to: path.to.materialForms,
          page: "parts.shapes",
          icon: <LuShapes />,
          role: "employee"
        },
        {
          name: t`Substances`,
          to: path.to.materialSubstances,
          page: "parts.substances",
          icon: <LuGlassWater />,
          role: "employee"
        },
        {
          name: t`Types`,
          to: path.to.materialTypes,
          page: "parts.types",
          icon: <LuPuzzle />,
          role: "employee"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Item Groups`,
          to: path.to.itemPostingGroups,
          page: "parts.itemGroups",
          role: "employee",
          icon: <LuGroup />
        },
        {
          name: t`Units`,
          to: path.to.uoms,
          page: "parts.units",
          role: "employee",
          icon: <LuRuler />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: itemsRoutes
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
