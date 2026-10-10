// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";

/** One resolved breadcrumb, as `useBreadcrumbs()` returns it. */
export type Crumb = {
  breadcrumb: ReactNode;
  to?: string;
};

export type AppBarState = {
  title: ReactNode;
  subtitle?: ReactNode;
  backTo?: string;
  /**
   * Root screens show the section switcher; pushed screens show Back; a
   * selection (list select mode) hides the page actions.
   */
  kind: "root" | "pushed" | "selection";
};

/** What a page sets over the derived app bar (see useSetAppBarOverride). */
export type AppBarOverride = Partial<AppBarState> & { trailing?: ReactNode };

/**
 * The derived app bar with a page's override on top. An override replaces the
 * subtitle too, so a pushed record never shows the list's crumb under it.
 */
export function mergeAppBar(
  base: AppBarState,
  override: AppBarOverride | null
): AppBarState & { trailing?: ReactNode } {
  if (!override) return base;
  return { ...base, subtitle: undefined, ...override };
}

type DeriveOptions = {
  /** The route renders inside a module layout with a content sidebar (`handle.sidebar`). */
  hasModuleSidebar: boolean;
  /** Index of the module crumb in `crumbs` (usually 0). */
  moduleCrumbIndex: number;
};

/**
 * Derive the compact app bar from the desktop breadcrumbs: the last crumb is
 * the title; on a pushed screen the previous crumb is the subtitle and the Back
 * target ("up", never history). A screen is root when it is Home, a module
 * landing page, or a module-sidebar page at most one crumb below the module.
 */
export function deriveAppBar(
  crumbs: Crumb[],
  { hasModuleSidebar, moduleCrumbIndex }: DeriveOptions
): AppBarState {
  const last = crumbs[crumbs.length - 1];
  const title = last?.breadcrumb ?? null;
  const belowModule = crumbs.length - 1 - Math.max(moduleCrumbIndex, 0);

  const isHome = crumbs.length === 0;
  const isModuleLanding = belowModule <= 0;
  const isSidebarSection = hasModuleSidebar && belowModule <= 1;

  if (isHome || isModuleLanding || isSidebarSection) {
    return { title, kind: "root" };
  }

  const parent = crumbs[crumbs.length - 2];
  return {
    title,
    subtitle: parent?.breadcrumb,
    backTo: parent?.to,
    kind: "pushed"
  };
}
