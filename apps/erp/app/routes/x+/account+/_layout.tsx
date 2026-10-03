// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import useAccountSubmodules from "~/modules/account/ui/useAccountSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | My Account" }];
};

function AccountSidebar() {
  const { groups } = useAccountSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Account`,
  to: path.to.profile,
  module: "account",
  sidebar: AccountSidebar
};

export default function AccountRoute() {
  return (
    <VStack
      spacing={0}
      className="overflow-y-auto scrollbar-hide h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <VStack spacing={4} className="py-12 px-4 max-w-[60rem] h-full mx-auto">
        <Outlet />
      </VStack>
    </VStack>
  );
}
