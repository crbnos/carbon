import { LuFileBadge2, LuGroup, LuUsers } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const usersRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Accounts",
        to: path.to.employeeAccounts,
        icon: <LuUsers />,
      },
      // {
      //   name: "Customers",
      //   to: path.to.customerAccounts,
      //   icon: <LuSquareUser />,
      // },
      // {
      //   name: "Suppliers",
      //   to: path.to.supplierAccounts,
      //   icon: <LuContainer />,
      // },
      {
        name: "Groups",
        to: path.to.groups,
        icon: <LuGroup />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Employee Types",
        to: path.to.employeeTypes,
        icon: <LuFileBadge2 />,
      },
    ],
  },
];

export default function useUsersSubmodules() {
  return { groups: usersRoutes };
}
