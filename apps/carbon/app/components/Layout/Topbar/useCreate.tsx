import { useMemo } from "react";
import {
  LuComponent,
  LuContainer,
  LuShoppingCart,
  LuUserSquare,
  LuUsers,
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
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
        icon: <LuUserSquare />,
      });
      links.push({
        name: "RFQ",
        to: path.to.newSalesRFQ,
        icon: <RiProgress2Line />,
      });
      links.push({
        name: "Quote",
        to: path.to.newQuote,
        icon: <RiProgress4Line />,
      });
      links.push({
        name: "Sales Order",
        to: path.to.newSalesOrder,
        icon: <RiProgress8Line />,
      });
    }

    if (permissions.can("create", "users")) {
      links.push({
        name: "Employee",
        to: path.to.newEmployee,
        icon: <LuUsers />,
      });
    }

    return links;
  }, [permissions]);

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
