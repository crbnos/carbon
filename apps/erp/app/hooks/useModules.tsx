import { useRouteData } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuBox,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuLandmark,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuSquareStack,
  LuTvMinimalPlay,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { usePermissions } from "./usePermissions";

type ModuleDefinition = Authenticated<NavItem> & { key: string };

type ModulePreference = {
  module: string;
  position: number;
  hidden: boolean;
};

function filterByPermissions(
  modules: ModuleDefinition[],
  permissions: ReturnType<typeof usePermissions>
) {
  return modules.filter((item) => {
    if (item.permission) {
      return permissions.can("view", item.permission);
    } else if (item.role) {
      return permissions.is(item.role);
    } else {
      return true;
    }
  });
}

function useModuleDefinitions(): ModuleDefinition[] {
  const { t } = useLingui();
  return [
    {
      key: "accounting",
      permission: "accounting",
      name: t`Accounting`,
      to: path.to.chartOfAccounts,
      icon: LuLandmark
    },
    {
      key: "documents",
      permission: "documents",
      name: t`Documents`,
      to: path.to.documents,
      icon: LuFiles
    },
    {
      key: "inventory",
      permission: "inventory",
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox
    },
    {
      key: "parts",
      permission: "parts",
      name: t`Items`,
      to: path.to.parts,
      icon: LuSquareStack
    },
    {
      key: "people",
      permission: "people",
      name: t`People`,
      to: path.to.people,
      icon: LuUsers
    },
    {
      key: "production",
      permission: "production",
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory
    },
    {
      key: "purchasing",
      permission: "purchasing",
      name: t`Purchasing`,
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    {
      key: "quality",
      permission: "quality",
      name: t`Quality`,
      to: path.to.quality,
      icon: LuFolderCheck
    },
    {
      key: "resources",
      permission: "resources",
      name: t`Resources`,
      to: path.to.resources,
      icon: LuWrench
    },
    {
      key: "sales",
      permission: "sales",
      name: t`Sales`,
      to: path.to.sales,
      icon: LuCrown
    },
    {
      key: "settings",
      permission: "settings",
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings
    },
    {
      key: "shopFloor",
      name: t`Shop Floor`,
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee"
    },
    {
      key: "users",
      permission: "users",
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield
    }
  ];
}

export function useModules() {
  const permissions = usePermissions();
  const modules = useModuleDefinitions();

  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);

  const modulePreferences = routeData?.modulePreferences ?? [];
  const permitted = filterByPermissions(modules, permissions);

  const alphabetical = permitted.sort((a, b) => a.name.localeCompare(b.name));

  if (modulePreferences.length === 0) {
    return alphabetical;
  }

  const prefMap = new Map(modulePreferences.map((p) => [p.module, p]));

  const visible = alphabetical.filter((m) => {
    const pref = prefMap.get(m.key);
    return !pref?.hidden;
  });

  return visible.sort((a, b) => {
    const posA = prefMap.get(a.key)?.position ?? Infinity;
    const posB = prefMap.get(b.key)?.position ?? Infinity;
    return posA - posB;
  });
}

export function useAllModules() {
  const permissions = usePermissions();
  const modules = useModuleDefinitions();

  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);

  const modulePreferences = routeData?.modulePreferences ?? [];
  const permitted = filterByPermissions(modules, permissions).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const prefMap = new Map(modulePreferences.map((p) => [p.module, p]));

  return permitted
    .map((m, index) => ({
      ...m,
      position: prefMap.get(m.key)?.position ?? index + 1,
      hidden: prefMap.get(m.key)?.hidden ?? false
    }))
    .sort((a, b) => a.position - b.position);
}
