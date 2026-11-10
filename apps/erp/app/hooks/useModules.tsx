// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type ExpandedClaims,
  MODULES,
  type ModuleId,
  pageOfUrl,
  pagesOf
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

/** `opensOn`: the sub-module the link opens on, or `to` when that is a dashboard. */
type ModuleLink = Authenticated<NavItem> & { key: string; opensOn: string };

/**
 * Each module's nav entry. A module of several pages whose `to` is one of
 * them opens on the person's first page of the module (`moduleLanding`); the
 * others open on `to`: a dashboard any page of the module can view, the one
 * page of a one-page module, or, with `indexPicksPage`, an `_index` that
 * redirects to that first page itself.
 * Names stay here: Lingui translates only strings the macro sees.
 */
function useModuleLinks(): Record<
  ModuleId,
  Omit<ModuleLink, "key" | "opensOn"> & { indexPicksPage?: true }
> {
  const { t } = useLingui();
  return {
    accounting: {
      name: t`Accounting`,
      to: path.to.accounting,
      icon: LuLandmark,
      indexPicksPage: true
    },
    documents: { name: t`Documents`, to: path.to.documents, icon: LuFiles },
    inventory: {
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox
    },
    invoicing: {
      name: t`Invoicing`,
      to: path.to.invoicing,
      icon: LuCreditCard
    },
    parts: { name: t`Items`, to: path.to.parts, icon: LuBlocks },
    people: {
      name: t`People`,
      to: path.to.people,
      icon: LuUsers
    },
    production: {
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory
    },
    projects: {
      name: t`Projects`,
      to: path.to.projects,
      icon: LuFolderKanban
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
      icon: LuHeadphones
    },
    settings: {
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings
    },
    users: {
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield
    },
    workflows: {
      name: t`Workflows`,
      to: path.to.workflows,
      icon: LuWorkflow
    }
  };
}

/** Each module's translated name, as its nav entry shows it. */
export function useModuleNames(): Record<ModuleId, string> {
  return Object.fromEntries(
    Object.entries(useModuleLinks()).map(([id, link]) => [id, link.name])
  ) as Record<ModuleId, string>;
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
    const { indexPicksPage, ...link } = links[id];
    const landing =
      indexPicksPage ||
      (pagesOf(id).length > 1 && pageOfUrl(link.to) !== undefined)
        ? moduleLanding(id, routeData?.permissions, companyId)
        : undefined;
    return {
      ...link,
      key: id,
      to: (!indexPicksPage && landing) || link.to,
      opensOn: landing ?? link.to
    };
  });
  const shopFloor: ModuleLink = {
    key: "shopFloor",
    name: t`Shop Floor`,
    to: path.to.external.mes,
    opensOn: path.to.external.mes,
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
