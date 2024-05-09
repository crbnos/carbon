import { useMemo } from "react";
import {
  LuComponent,
  LuContainer,
  LuPenSquare,
  LuReceipt,
  LuShoppingCart,
  LuUserSquare,
  LuUsers,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";

import type { Route } from "~/types";
import { path } from "~/utils/path";

export default function useCreate(): Route[] {
  const permissions = usePermissions();

  const result = useMemo(() => {
    let links: Route[] = [];
    if (permissions.can("create", "parts")) {
      links.push({
        name: "Part",
        to: path.to.newPart,
        icon: <LuComponent />,
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: "Purchase Order",
        to: path.to.newPurchaseOrder,
        icon: <LuShoppingCart />,
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: "Supplier",
        to: path.to.newSupplier,
        icon: <LuContainer />,
      });
    }

    if (permissions.can("create", "sales")) {
      links.push({
        name: "Customer",
        to: path.to.newCustomer,
        icon: <LuUsers />,
      });
      links.push({
        name: "Quotation",
        to: path.to.newQuote,
        icon: <LuPenSquare />,
      });
      links.push({
        name: "Sales Order",
        to: path.to.newSalesOrder,
        icon: <LuReceipt />,
      });
    }

    if (permissions.can("create", "users")) {
      links.push({
        name: "Employee",
        to: path.to.newEmployee,
        icon: <LuUserSquare />,
      });
    }

    return links;
  }, [permissions]);

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
