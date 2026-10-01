// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { CgProfile } from "react-icons/cg";
import { LuBell, LuShieldCheck } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useAccountSubmodules() {
  const { t } = useLingui();
  const accountGroups: RouteGroup[] = [
    {
      name: t`Account`,
      routes: [
        {
          name: t`Notifications`,
          to: path.to.notificationSettings,
          icon: <LuBell />
        },
        {
          name: t`Profile`,
          to: path.to.profile,
          icon: <CgProfile />
        },
        {
          name: t`Security`,
          to: path.to.accountSecurity,
          icon: <LuShieldCheck />
        }
      ]
    }
  ];
  return { groups: accountGroups };
}
