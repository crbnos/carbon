// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type ExpandedClaims,
  MODULES,
  type ModuleId
} from "@carbon/database/access";
import { useRouteData } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuBlocks,
  LuBox,
  LuCreditCard,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuFolderKanban,
  LuHeadphones,
  LuHeartHandshake,
  LuLandmark,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuTvMinimalPlay,
  LuUsers,
  LuWorkflow
} from "react-icons/lu";
import { useUIStore } from "~/stores/ui";
import type { Authenticated, NavItem } from "~/types";
import { moduleLanding } from "~/utils/nav";
import { path } from "~/utils/path";
import {
  type SubmoduleLayout,
  submoduleLayout
} from "~/utils/submodule-visibility";
import { usePermissions } from "./usePermissions";
import { useUser } from "./useUser";

type ModuleLink = Authenticated<NavItem> & { key: string };

/**
 * Each module's nav entry. `landing` modules open on the person's first page
 * of the module (`moduleLanding`); the others open on `to`: a dashboard any
 * page of the module can view, or an `_index` that picks the page itself.
 * Names stay here: Lingui translates only strings the macro sees.
 */
function useModuleLinks(): Record<
  ModuleId,
  Omit<ModuleLink, "key"> & { landing?: true }
> {
  const { t } = useLingui();
  return {
    accounting: {
      name: t`Accounting`,
      to: path.to.accounting,
      icon: LuLandmark
    },
    documents: { name: t`Documents`, to: path.to.documents, icon: LuFiles },
    inventory: {
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox,
      landing: true
    },
    invoicing: {
      name: t`Invoicing`,
      to: path.to.invoicing,
      icon: LuCreditCard
    },
    parts: { name: t`Items`, to: path.to.parts, icon: LuBlocks, landing: true },
    people: {
      name: t`People`,
      to: path.to.people,
      icon: LuUsers,
      landing: true
    },
    production: {
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory
    },
    projects: {
      name: t`Projects`,
      to: path.to.projects,
      icon: LuFolderKanban,
      landing: true
    },
    purchasing: {
      name: t`Purchasing`,
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    quality: { name: t`Quality`, to: path.to.quality, icon: LuFolderCheck },
    resources: {
      name: t`Resources`,
      to: path.to.resources,
      icon: LuHeartHandshake
    },
    sales: { name: t`Sales`, to: path.to.sales, icon: LuCrown },
    service: {
      name: t`Service`,
      to: path.to.serviceJobs,
      icon: LuHeadphones,
      landing: true
    },
    settings: {
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings,
      landing: true
    },
    users: {
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield,
      landing: true
    },
    workflows: {
      name: t`Workflows`,
      to: path.to.workflows,
      icon: LuWorkflow,
      landing: true
    }
  };
}

type ModulePreference = {
  module: string;
  position: number;
  hidden: boolean;
  hiddenSubmodules: string[];
  submoduleOrder: string[];
};

const NO_PREFERENCES: ModulePreference[] = [];

function useModulePreferences() {
  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);
  return routeData?.modulePreferences ?? NO_PREFERENCES;
}

/**
 * The sub-modules this user hides and the order they put them in. While
 * Customize is open it is the unsaved layout, so the sidebar previews it.
 */
export function useSubmoduleLayout(): SubmoduleLayout {
  const modulePreferences = useModulePreferences();
  const draft = useUIStore((state) => state.draftSubmoduleLayout);
  return useMemo(
    () => draft ?? submoduleLayout(modulePreferences),
    [draft, modulePreferences]
  );
}

/** The modules the person can open (View on any of their pages), plus Shop Floor. */
function usePermittedModules(): {
  settings: ModuleLink | null;
  modules: ModuleLink[];
  preferences: Map<string, ModulePreference>;
} {
  const permissions = usePermissions();
  const links = useModuleLinks();
  const { t } = useLingui();
  const {
    company: { id: companyId }
  } = useUser();
  const routeData = useRouteData<{ permissions: ExpandedClaims }>(
    path.to.authenticatedRoot
  );
  const modulePreferences = useModulePreferences();

  const permitted = MODULES.filter(({ id }) =>
    permissions.hasAny(id, "View")
  ).map(({ id }): ModuleLink => {
    const { landing, ...link } = links[id];
    const to = landing
      ? moduleLanding(id, routeData?.permissions, companyId)
      : undefined;
    return { ...link, key: id, to: to ?? link.to };
  });
  const shopFloor: ModuleLink = {
    key: "shopFloor",
    name: t`Shop Floor`,
    to: path.to.external.mes,
    icon: LuTvMinimalPlay,
    external: true,
    newTab: true
  };

  return {
    // Settings is pinned apart from the reorderable modules.
    settings: permitted.find((m) => m.key === "settings") ?? null,
    modules: [...permitted.filter((m) => m.key !== "settings"), shopFloor].sort(
      (a, b) => a.name.localeCompare(b.name)
    ),
    preferences: new Map(modulePreferences.map((p) => [p.module, p]))
  };
}

export function useModules() {
  const { modules, preferences } = usePermittedModules();
  if (preferences.size === 0) return modules;
  return modules
    .filter((m) => !preferences.get(m.key)?.hidden)
    .sort(
      (a, b) =>
        (preferences.get(a.key)?.position ?? Infinity) -
        (preferences.get(b.key)?.position ?? Infinity)
    );
}

export function useSettingsModule() {
  return usePermittedModules().settings;
}

export function useAllModules() {
  const { modules, preferences } = usePermittedModules();
  return modules
    .map((m, index) => ({
      ...m,
      position: preferences.get(m.key)?.position ?? index + 1,
      hidden: preferences.get(m.key)?.hidden ?? false,
      hiddenSubmodules: preferences.get(m.key)?.hiddenSubmodules ?? [],
      submoduleOrder: preferences.get(m.key)?.submoduleOrder ?? []
    }))
    .sort((a, b) => a.position - b.position);
}
