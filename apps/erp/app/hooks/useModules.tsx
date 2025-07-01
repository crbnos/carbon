import {
  LuBox,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuLandmark,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuSquareStack,
  LuTvMinimalPlay,
  LuUsers,
  LuWrench,
} from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { usePermissions } from "./usePermissions";

export function useModules() {
  const permissions = usePermissions();

  const modules: Authenticated<NavItem>[] = [
    {
      name: "Shop Floor",
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee",
    },
    {
      permission: "sales",
      name: "Sales",
      to: path.to.sales,
      icon: LuCrown,
    },
    {
      permission: "production",
      name: "Production",
      to: path.to.production,
      icon: LuFactory,
    },
    {
      permission: "parts",
      name: "Items",
      to: path.to.parts,
      icon: LuSquareStack,
    },
    {
      permission: "inventory",
      name: "Inventory",
      to: path.to.inventory,
      icon: LuBox,
    },
    {
      permission: "purchasing",
      name: "Purchasing",
      to: path.to.purchasing,
      icon: LuShoppingCart,
    },
    {
      permission: "quality",
      name: "Quality",
      to: path.to.quality,
      icon: LuFolderCheck,
    },
    {
      permission: "accounting",
      name: "Finance",
      to: path.to.currencies,
      icon: LuLandmark,
    },
    // {
    //   permission: "invoicing",
    //   name: "Invoicing",
    //   to: path.to.purchaseInvoices,
    //   icon: LuCreditCard,
    // },
    {
      permission: "people",
      name: "People",
      to: path.to.people,
      icon: LuUsers,
    },
    {
      permission: "resources",
      name: "Resources",
      to: path.to.resources,
      icon: LuWrench,
    },
    {
      permission: "documents",
      name: "Documents",
      to: path.to.documents,
      icon: LuFiles,
    },
    {
      permission: "users",
      name: "Users",
      to: path.to.employeeAccounts,
      icon: LuShield,
    },
    {
      permission: "settings",
      name: "Settings",
      to: path.to.company,
      icon: LuSettings,
    },
  ];

  return modules.filter((item) => {
    if (item.permission) {
      return permissions.can("view", item.permission);
    } else if (item.role) {
      return permissions.is(item.role);
    } else {
      return true;
    }
  });
}
