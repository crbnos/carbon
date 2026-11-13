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
import { visibleGroups } from "~/utils/nav";
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
          icon: <AiOutlinePartition />,
          table: "part"
        },
        {
          name: t`Materials`,
          to: path.to.materials,
          icon: <LuAtom />,
          table: "material"
        },
        {
          name: t`Tools`,
          to: path.to.tools,
          icon: <LuHammer />,
          table: "tool"
        },
        {
          name: t`Consumables`,
          to: path.to.consumables,
          icon: <LuPizza />,
          table: "consumable"
        },
        {
          name: t`Services`,
          to: path.to.services,
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
          icon: <LuGitPullRequestArrow />,
          table: "changeOrder"
        }
      ]
    },
    {
      name: t`Material Properties`,
      routes: [
        {
          name: t`Dimensions`,
          to: path.to.materialDimensions,
          icon: <LuAxis3D />
        },
        {
          name: t`Finishes`,
          to: path.to.materialFinishes,
          icon: <LuDessert />
        },
        {
          name: t`Grades`,
          to: path.to.materialGrades,
          icon: <LuBeef />
        },
        {
          name: t`Shapes`,
          to: path.to.materialForms,
          icon: <LuShapes />
        },
        {
          name: t`Substances`,
          to: path.to.materialSubstances,
          icon: <LuGlassWater />
        },
        {
          name: t`Types`,
          to: path.to.materialTypes,
          icon: <LuPuzzle />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Change Notice Types`,
          to: path.to.changeNoticeTypes,
          icon: <LuTags />
        },
        {
          name: t`Change Notice Actions`,
          to: path.to.changeNoticeRequiredActions,
          icon: <LuListChecks />
        },
        {
          name: t`Item Groups`,
          to: path.to.itemPostingGroups,
          icon: <LuGroup />
        },
        {
          name: t`Units`,
          to: path.to.uoms,
          icon: <LuRuler />
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(itemsRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
