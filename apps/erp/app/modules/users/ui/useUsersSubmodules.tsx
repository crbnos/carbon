// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuFileBadge2, LuGroup, LuMonitor, LuUsers } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useUsersSubmodules() {
  const { t } = useLingui();
  const settings = useSettings();
  const permissions = usePermissions();

  const usersRoutes: RouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Accounts`,
          to: path.to.employeeAccounts,
          page: "users.accounts",
          icon: <LuUsers />
        },
        {
          name: t`Operators`,
          to: path.to.operators,
          page: "users.operators",
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
          page: "users.groups",
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
          page: "users.employeeTypes",
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
          (!route.setting ||
            settings[route.setting as keyof typeof settings] === true) &&
          (!route.page || permissions.has({ [route.page]: "View" }))
      )
    }))
  };
}
