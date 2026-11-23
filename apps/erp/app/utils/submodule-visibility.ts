// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

type SubmoduleRoute = { to: string; q?: string };
type SubmoduleGroup = { routes: SubmoduleRoute[] };

/** The sub-modules a user hides, and the place of each one they moved, by key. */
export type SubmoduleLayout = {
  hidden: ReadonlySet<string>;
  order: ReadonlyMap<string, number>;
};

/** A sub-module has no id, so its link is its key. Documents differs only by `q`. */
export function submoduleKey(route: SubmoduleRoute) {
  return route.q ? `${route.to}?q=${route.q}` : route.to;
}

/** Reads the layout from module rows. A row saved before a column existed has no list. */
export function submoduleLayout(
  modules: { hiddenSubmodules?: string[]; submoduleOrder?: string[] }[]
): SubmoduleLayout {
  return {
    hidden: new Set(modules.flatMap((m) => m.hiddenSubmodules ?? [])),
    order: new Map(
      modules.flatMap((m) =>
        (m.submoduleOrder ?? []).map((key, index) => [key, index] as const)
      )
    )
  };
}

/** Sorts each group into the user's order. A sub-module with no saved place goes last, in code order. */
export function orderedGroups<G extends SubmoduleGroup>(
  groups: G[],
  order: ReadonlyMap<string, number>
): G[] {
  if (order.size === 0) return groups;
  const place = (route: SubmoduleRoute) =>
    order.get(submoduleKey(route)) ?? Number.MAX_SAFE_INTEGER;
  return groups.map((group) => ({
    ...group,
    routes: [...group.routes].sort((a, b) => place(a) - place(b))
  }));
}

/** Keeps the groups as they are if hiding would leave nothing to show. */
export function visibleGroups<G extends SubmoduleGroup>(
  groups: G[],
  hidden: ReadonlySet<string>
): G[] {
  const visible = groups
    .map((group) => ({
      ...group,
      routes: group.routes.filter((route) => !hidden.has(submoduleKey(route)))
    }))
    .filter((group) => group.routes.length > 0);
  return visible.length > 0 ? visible : groups;
}

/** The groups as the user arranged them: in their order, without the hidden ones. */
export function arrangedGroups<G extends SubmoduleGroup>(
  groups: G[],
  layout: SubmoduleLayout
): G[] {
  return visibleGroups(orderedGroups(groups, layout.order), layout.hidden);
}

/** The module a link belongs to: its first segment after `/x`. */
export function getModule(link: string) {
  return link.split("/")?.[2];
}

/**
 * Where a module opens: `opensOn`, or, if that one is hidden, the first sub-module
 * left inside the module. A page outside it (My Time) has no module sidebar.
 */
export function moduleLanding(
  to: string,
  opensOn: string,
  groups: SubmoduleGroup[],
  layout: SubmoduleLayout
) {
  if (!layout.hidden.has(opensOn)) return to;
  const first = arrangedGroups(groups, layout)
    .flatMap((group) => group.routes)
    .find((route) => getModule(route.to) === getModule(to));
  return first ? submoduleKey(first) : to;
}
