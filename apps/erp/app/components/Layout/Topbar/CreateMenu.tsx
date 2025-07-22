import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@carbon/react";
import { Link } from "@remix-run/react";

import {
  LuContainer,
  LuHardHat,
  LuShieldX,
  LuShoppingCart,
  LuSquarePen,
  LuSquareStack,
  LuSquareUser,
  LuUsers,
} from "react-icons/lu";

import { useMemo } from "react";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line,
} from "react-icons/ri";
import { usePermissions } from "~/hooks";

import type { Route } from "~/types";
import { path } from "~/utils/path";

function useCreate(): Route[] {
  const permissions = usePermissions();

  const result = useMemo(() => {
    let links: Route[] = [];
    if (permissions.can("create", "parts")) {
      links.push({
        name: "Part",
        to: path.to.newPart,
        icon: <LuSquareStack />,
      });
    }

    if (permissions.can("create", "quality")) {
      links.push({
        name: "Issue",
        to: path.to.newIssue,
        icon: <LuShieldX />,
      });
    }

    if (permissions.can("create", "production")) {
      links.push({
        name: "Job",
        to: path.to.newJob,
        icon: <LuHardHat />,
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
        icon: <LuSquareUser />,
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

const CreateMenu = () => {
  const createLinks = useCreate();

  if (!createLinks.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label="Create"
          icon={<LuSquarePen />}
          variant="ghost"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-48">
        {createLinks.map((link) => (
          <DropdownMenuItem key={link.to} asChild>
            <Link to={link.to}>
              {link.icon && <DropdownMenuIcon icon={link.icon} />}
              {link.name}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CreateMenu;
