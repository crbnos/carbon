import { useLingui } from "@lingui/react/macro";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuAtom,
  LuAxis3D,
  LuBeef,
  LuDessert,
  LuGlassWater,
  LuGroup,
  LuHammer,
  LuPizza,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuShieldCheck
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
      name: t`Manage`,
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
        }
      ]
    },
    {
      name: t`Configure Materials`,
      routes: [
        {
          name: t`Dimensions`,
          to: path.to.materialDimensions,
          icon: <LuAxis3D />,
          role: "employee"
        },
        {
          name: t`Finishes`,
          to: path.to.materialFinishes,
          icon: <LuDessert />,
          role: "employee"
        },
        {
          name: t`Grades`,
          to: path.to.materialGrades,
          icon: <LuBeef />,
          role: "employee"
        },
        {
          name: t`Shapes`,
          to: path.to.materialForms,
          icon: <LuShapes />,
          role: "employee"
        },
        {
          name: t`Substances`,
          to: path.to.materialSubstances,
          icon: <LuGlassWater />,
          role: "employee"
        },
        {
          name: t`Types`,
          to: path.to.materialTypes,
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
          role: "employee",
          icon: <LuGroup />
        },
        {
          name: t`Rules`,
          to: path.to.itemRules,
          role: "employee",
          icon: <LuShieldCheck />
        },
        {
          name: t`Units`,
          to: path.to.uoms,
          role: "employee",
          icon: <LuRuler />
        }
      ]
    }
  ];

  return {
    groups: itemsRoutes
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
