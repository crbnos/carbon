import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuCirclePlay,
  LuContainer,
  LuShieldX,
  LuShoppingCart,
  LuSquareStack,
  LuSquareUser,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import type { Route } from "~/types";
import { path } from "~/utils/path";

function useCreate(): Route[] {
  const permissions = usePermissions();
  const { t } = useLingui();

  const result = useMemo(() => {
    let links: Route[] = [];
    if (permissions.can("create", "parts")) {
      links.push({
        name: t`Part`,
        to: path.to.newPart,
        icon: <LuSquareStack />
      });
    }

    if (permissions.can("create", "quality")) {
      links.push({
        name: t`Issue`,
        to: path.to.newIssue,
        icon: <LuShieldX />
      });
    }

    if (permissions.can("create", "production")) {
      links.push({
        name: t`Job`,
        to: path.to.newJob,
        icon: <LuCirclePlay />
      });
    }

    if (permissions.can("create", "production")) {
      links.push({
        name: t`Maintenance`,
        to: path.to.newMaintenanceDispatch,
        icon: <LuWrench />
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: t`Purchase Order`,
        to: path.to.newPurchaseOrder,
        icon: <LuShoppingCart />
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: t`Supplier`,
        to: path.to.newSupplier,
        icon: <LuContainer />
      });
    }

    if (permissions.can("create", "sales")) {
      links.push({
        name: t`Customer`,
        to: path.to.newCustomer,
        icon: <LuSquareUser />
      });
      links.push({
        name: t`RFQ`,
        to: path.to.newSalesRFQ,
        icon: <RiProgress2Line />
      });
      links.push({
        name: t`Quote`,
        to: path.to.newQuote,
        icon: <RiProgress4Line />
      });
      links.push({
        name: t`Sales Order`,
        to: path.to.newSalesOrder,
        icon: <RiProgress8Line />
      });
    }

    if (permissions.can("create", "users")) {
      links.push({
        name: t`Employee`,
        to: path.to.newEmployee,
        icon: <LuUsers />
      });
    }

    return links;
  }, [permissions, t]);

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const CreateMenu = ({ trigger }: { trigger: React.ReactNode }) => {
  const createLinks = useCreate();

  if (!createLinks.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
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
