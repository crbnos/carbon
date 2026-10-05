// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { useSettingsSubmodules } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Settings" }];
};

function SettingsSidebar() {
  const { groups } = useSettingsSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Settings`,
  to: path.to.company,
  module: "settings",
  sidebar: SettingsSidebar
};

export default function SettingsRoute() {
  return (
    <VStack
      spacing={0}
      className="overflow-y-auto scrollbar-hide h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <Outlet />
    </VStack>
  );
}
