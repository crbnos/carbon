// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuBlocks,
  LuBox,
  LuCreditCard,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuLandmark,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuTvMinimalPlay,
  LuUsers,
  LuWorkflow,
  LuWrench
} from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { usePermissions } from "./usePermissions";

/** A nav module: it shows with View on any of its pages (`module`). */
type ModuleDefinition = Authenticated<NavItem> & {
  key: string;
  module?: string;
};

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
    if (item.module) {
      return permissions.hasAny(item.module, "View");
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
      module: "accounting",
      name: t`Accounting`,
      to: path.to.accounting,
      icon: LuLandmark
    },
    {
      key: "documents",
      module: "documents",
      name: t`Documents`,
      to: path.to.documents,
      icon: LuFiles
    },
    {
      key: "inventory",
      module: "inventory",
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox
    },
    {
      key: "invoicing",
      module: "invoicing",
      name: t`Invoicing`,
      to: path.to.invoicing,
      icon: LuCreditCard
    },
    {
      key: "parts",
      module: "parts",
      name: t`Items`,
      to: path.to.parts,
      icon: LuBlocks
    },
    {
      key: "people",
      module: "people",
      name: t`People`,
      to: path.to.people,
      icon: LuUsers
    },
    {
      key: "production",
      module: "production",
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory
    },
    {
      key: "purchasing",
      module: "purchasing",
      name: t`Purchasing`,
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    {
      key: "quality",
      module: "quality",
      name: t`Quality`,
      to: path.to.quality,
      icon: LuFolderCheck
    },
    {
      key: "resources",
      module: "resources",
      name: t`Resources`,
      to: path.to.resources,
      icon: LuWrench
    },
    {
      key: "sales",
      module: "sales",
      name: t`Sales`,
      to: path.to.sales,
      icon: LuCrown
    },
    {
      key: "settings",
      module: "settings",
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings
    },
    {
      key: "shopFloor",
      name: t`Shop Floor`,
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee",
      external: true
    },
    {
      key: "users",
      module: "users",
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield
    },
    {
      key: "workflows",
      module: "workflows",
      name: t`Workflows`,
      to: path.to.workflows,
      icon: LuWorkflow
    }
  ];
}

const PINNED_MODULES = new Set(["settings"]);

export function useModules() {
  const permissions = usePermissions();
  const modules = useModuleDefinitions();

  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);

  const modulePreferences = routeData?.modulePreferences ?? [];
  const permitted = filterByPermissions(modules, permissions).filter(
    (m) => !PINNED_MODULES.has(m.key)
  );

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

export function useSettingsModule() {
  const permissions = usePermissions();
  const modules = useModuleDefinitions();
  const settings = modules.find((m) => m.key === "settings");
  if (!settings) return null;
  if (settings.module && !permissions.hasAny(settings.module, "View")) {
    return null;
  }
  return settings;
}

export function useAllModules() {
  const permissions = usePermissions();
  const modules = useModuleDefinitions();

  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);

  const modulePreferences = routeData?.modulePreferences ?? [];
  const permitted = filterByPermissions(modules, permissions)
    .filter((m) => !PINNED_MODULES.has(m.key))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prefMap = new Map(modulePreferences.map((p) => [p.module, p]));

  return permitted
    .map((m, index) => ({
      ...m,
      position: prefMap.get(m.key)?.position ?? index + 1,
      hidden: prefMap.get(m.key)?.hidden ?? false
    }))
    .sort((a, b) => a.position - b.position);
}
