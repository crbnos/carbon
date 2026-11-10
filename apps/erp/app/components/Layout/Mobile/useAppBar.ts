// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { useMatches } from "react-router";
import { useUser } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { useCompactModuleSidebar } from "../Navigation/CollapsibleSidebar";
import { useBreadcrumbs } from "../Topbar/Breadcrumbs";
import { deriveAppBar, mergeAppBar } from "./appBar";
import { useAppBarOverride } from "./useAppBarOverride";

/**
 * The compact app bar for the current route: title, subtitle and Back from
 * the desktop breadcrumbs (with a page's override on top), the module
 * sidebar for the section switcher, and the module name for the switcher's
 * title. Home shows the company name.
 */
export function useAppBar() {
  const { i18n } = useLingui();
  const matches = useMatches();
  const crumbs = useBreadcrumbs();
  const Sidebar = useCompactModuleSidebar();
  const { company } = useUser();
  const override = useAppBarOverride();

  const derived = deriveAppBar(crumbs, {
    hasModuleSidebar: Boolean(Sidebar),
    moduleCrumbIndex: 0
  });
  // The deepest route that names its record type replaces the list crumb.
  const subtitle = [...matches]
    .reverse()
    .find((m) => (m.handle as Handle | undefined)?.appBarSubtitle);
  const state = mergeAppBar(
    {
      ...derived,
      title: crumbs.length === 0 ? company?.name : derived.title,
      ...(subtitle
        ? {
            subtitle: i18n._(
              (subtitle.handle as Handle).appBarSubtitle as MessageDescriptor
            )
          }
        : {})
    },
    override
  );

  return {
    ...state,
    moduleTitle: crumbs[0]?.breadcrumb,
    Sidebar: state.kind === "root" ? Sidebar : undefined
  };
}
