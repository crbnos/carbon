// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuFileBadge2, LuGroup, LuMonitor, LuUsers } from "react-icons/lu";
import { useSettings } from "~/hooks/useSettings";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useUsersSubmodules() {
  const { t } = useLingui();
  const settings = useSettings();

  const usersRoutes: RouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Accounts`,
          to: path.to.employeeAccounts,
          icon: <LuUsers />
        },
        {
          name: t`Operators`,
          to: path.to.operators,
          icon: <LuMonitor />,
          setting: "consoleEnabled" as any
        },
        // {
        //   name: t`Customers`,
        //   to: path.to.customerAccounts,
        //   icon: <LuSquareUser />,
        // },
        // {
        //   name: t`Suppliers`,
        //   to: path.to.supplierAccounts,
        //   icon: <LuContainer />,
        // },
        {
          name: t`Groups`,
          to: path.to.groups,
          icon: <LuGroup />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Employee Types`,
          to: path.to.employeeTypes,
          icon: <LuFileBadge2 />
        }
      ]
    }
  ];

  return {
    groups: usersRoutes.map((group) => ({
      ...group,
      routes: group.routes.filter(
        (route) =>
          !route.setting ||
          settings[route.setting as keyof typeof settings] === true
      )
    }))
  };
}
