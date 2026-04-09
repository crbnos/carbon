import { useLingui } from "@lingui/react/macro";
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
  LuWrench
} from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { usePermissions } from "./usePermissions";

export function useModules() {
  const permissions = usePermissions();
  const { t } = useLingui();

  const modules: Authenticated<NavItem>[] = [
    {
      name: t`Shop Floor`,
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee"
    },
    {
      permission: "sales",
      name: t`Sales`,
      to: path.to.sales,
      icon: LuCrown
    },
    {
      permission: "production",
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory
    },
    {
      permission: "parts",
      name: t`Items`,
      to: path.to.parts,
      icon: LuSquareStack
    },
    {
      permission: "inventory",
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox
    },
    {
      permission: "purchasing",
      name: t`Purchasing`,
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    {
      permission: "quality",
      name: t`Quality`,
      to: path.to.quality,
      icon: LuFolderCheck
    },
    {
      permission: "accounting",
      name: t`Finance`,
      to: path.to.currencies,
      icon: LuLandmark
    },
    // {
    //   permission: "invoicing",
    //   name: "Invoicing",
    //   to: path.to.purchaseInvoices,
    //   icon: LuCreditCard,
    // },
    {
      permission: "people",
      name: t`People`,
      to: path.to.people,
      icon: LuUsers
    },
    {
      permission: "resources",
      name: t`Resources`,
      to: path.to.resources,
      icon: LuWrench
    },
    {
      permission: "documents",
      name: t`Documents`,
      to: path.to.documents,
      icon: LuFiles
    },
    {
      permission: "users",
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield
    },
    {
      permission: "settings",
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings
    }
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
