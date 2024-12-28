import { LuDollarSign, LuList } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const accountingRoutes: AuthenticatedRouteGroup[] = [
  // {
  //   name: "Manage",
  //   routes: [
  //     {
  //       name: "Chart of Accounts",
  //       to: path.to.chartOfAccounts,
  //       role: "employee",
  //     },
  //     // {
  //     //   name: "Journals",
  //     //   to: path.to.accountingJournals,
  //     //   role: "employee",
  //     // },
  //   ],
  // },
  // {
  //   name: "Posting Groups",
  //   routes: [
  //     // {
  //     //   name: "Bank Account Groups",
  //     //   to: path.to.accountingGroupsBankAccount,
  //     //   role: "employee",
  //     // },
  //     // {
  //     //   name: "Fixed Asset Groups",
  //     //   to: path.to.accountingGroupsFixedAsset,
  //     //   role: "employee",
  //     // },
  //     {
  //       name: "Inventory Groups",
  //       to: path.to.accountingGroupsInventory,
  //       role: "employee",
  //     },
  //     {
  //       name: "Purchasing Groups",
  //       to: path.to.accountingGroupsPurchasing,
  //       role: "employee",
  //     },
  //     {
  //       name: "Sales Groups",
  //       to: path.to.accountingGroupsSales,
  //       role: "employee",
  //     },
  //   ],
  // },
  {
    name: "Configure",
    routes: [
      // {
      //   name: "Account Categories",
      //   to: path.to.accountingCategories,
      //   role: "employee",
      // },
      {
        name: "Currencies",
        to: path.to.currencies,
        role: "employee",
        icon: <LuDollarSign />,
      },
      // {
      //   name: "Default Accounts",
      //   to: path.to.accountingDefaults,
      //   role: "employee",
      // },
      // {
      //   name: "Fiscal Year",
      //   to: path.to.fiscalYears,
      //   role: "employee",
      // },
      {
        name: "Payment Terms",
        to: path.to.paymentTerms,
        role: "employee",
        icon: <LuList />,
      },
    ],
  },
];

export default function useAccountingSubmodules() {
  const permissions = usePermissions();
  return {
    groups: accountingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        }),
      })),
  };
}
