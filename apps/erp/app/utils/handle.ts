// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RouteRealtimeTable } from "@carbon/database/realtime-tables";
import type { MessageDescriptor } from "@lingui/core";
import type { ComponentType, ReactNode } from "react";

export type Handle = {
  breadcrumb?: any;
  to?: string;
  module?: string;
  // The tables this route shows. The shell (`RouteRealtime`) reloads the page
  // when one of them changes; each must be in REALTIME_TABLES.
  realtime?: RouteRealtimeTable[];
  // A module layout's sub-navigation. The shell renders it in the one module
  // sidebar (`ModuleSidebarLayout`), so it stays in place across modules.
  sidebar?: ComponentType;
  // When true, the module sidebar is hidden for this route — used by
  // full-screen detail views that provide their own left panel (e.g. the
  // change-order workspace) so the app doesn't stack two left sidebars.
  hideModuleSidebar?: boolean;
};

// A breadcrumb label may be plain text/markup or a Lingui MessageDescriptor
// (produced by `msg\`...\``); the renderer resolves descriptors via i18n.
export type BreadcrumbValue = ReactNode | MessageDescriptor;

export type BreadcrumbSegment = {
  breadcrumb: BreadcrumbValue;
  to?: string;
};

// Detail-page breadcrumb: the list link followed by the current entity's
// readable id. `getEntity` reads the entity's readable identifier from this
// route's loader data; when it is missing (still loading), only the list link
// is shown. `breadcrumb` in `list` may be a string or a Lingui MessageDescriptor.
export function detailBreadcrumb(
  list: { breadcrumb: BreadcrumbValue; to: string },
  getEntity: (data: any) => BreadcrumbValue | undefined
) {
  return (_params: unknown, data: unknown): BreadcrumbSegment[] => {
    const entity = data ? getEntity(data) : undefined;
    return entity ? [list, { breadcrumb: entity }] : [list];
  };
}
