import { BsCartDash } from "react-icons/bs";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const invoicingRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Purchasing",
        to: path.to.purchaseInvoices,
        role: "employee",
        icon: <BsCartDash />,
      },
      // {
      //   name: "Sales",
      //   to: path.to.salesInvoices,
      //   role: "employee",
      //   icon: <BsCartPlus />,
      // },
    ],
  },
];

export default function useInvoicingSubmodules() {
  const permissions = usePermissions();
  return {
    groups: invoicingRoutes
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
