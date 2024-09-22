import {
  LuBox,
  LuComponent,
  LuCreditCard,
  LuCrown,
  LuFactory,
  LuFiles,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuUsers,
  LuWrench,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

export function useModules() {
  const permissions = usePermissions();

  const modules: Authenticated<NavItem>[] = [
    {
      permission: "parts",
      name: "Items",
      to: path.to.parts,
      icon: LuComponent,
    },

    {
      permission: "inventory",
      name: "Inventory",
      to: path.to.inventory,
      icon: LuBox,
    },
    {
      permission: "production",
      name: "Production",
      to: path.to.production,
      icon: LuFactory,
    },
    {
      permission: "sales",
      name: "Sales",
      to: path.to.salesOrders,
      icon: LuCrown,
    },
    {
      permission: "purchasing",
      name: "Purchasing",
      to: path.to.purchaseOrders,
      icon: LuShoppingCart,
    },

    // {
    //   permission: "messages",
    //   name: "Messaging",
    //   to: path.to.messaging,
    //   icon: BiMessage,
    // },
    // {
    //   permission: "accounting",
    //   name: "Accounting",
    //   to: path.to.chartOfAccounts,
    //   icon: LuLandmark,
    // },
    {
      permission: "invoicing",
      name: "Invoicing",
      to: path.to.purchaseInvoices,
      icon: LuCreditCard,
    },
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
    } else {
      return true;
    }
  });
}
