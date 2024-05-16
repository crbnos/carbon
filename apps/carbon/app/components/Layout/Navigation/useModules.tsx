import { BiListCheck } from "react-icons/bi";
import { BsCalendar2Week } from "react-icons/bs";
import { LuSettings, LuShield, LuUsers } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";

export function useModules() {
  const permissions = usePermissions();

  const modules: Authenticated<NavItem>[] = [
    // {
    //   permission: "parts",
    //   name: "Parts",
    //   to: path.to.partsSearch,
    //   icon: LuComponent,
    // },
    {
      permission: "jobs",
      name: "Jobs",
      to: path.to.jobs,
      icon: BiListCheck,
    },
    // {
    //   permission: "inventory",
    //   name: "Inventory",
    //   to: path.to.receipts,
    //   icon: LuBox,
    // },
    {
      permission: "scheduling",
      name: "Scheduling",
      to: path.to.scheduling,
      icon: BsCalendar2Week,
    },
    // {
    //   permission: "timecards",
    //   name: "Timecards",
    //   to: path.to.timecards,
    //   icon: AiOutlineFieldTime,
    // },
    // {
    //   permission: "sales",
    //   name: "Sales",
    //   to: path.to.salesOrders,
    //   icon: LuReceipt,
    // },
    // {
    //   permission: "purchasing",
    //   name: "Purchasing",
    //   to: path.to.purchaseOrders,
    //   icon: LuShoppingCart,
    // },
    // {
    //   permission: "documents",
    //   name: "Documents",
    //   to: path.to.documents,
    //   icon: LuFiles,
    // },
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
    // {
    //   permission: "invoicing",
    //   name: "Invoicing",
    //   to: path.to.purchaseInvoices,
    //   icon: LuCreditCard,
    // },
    {
      permission: "resources",
      name: "Resources",
      to: path.to.people,
      icon: LuUsers,
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
