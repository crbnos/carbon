// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ShortcutKey,
  useShortcutSequence
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowRightLeft,
  LuBlocks,
  LuCirclePlay,
  LuClipboardList,
  LuContainer,
  LuLayers,
  LuListChecks,
  LuShieldX,
  LuShoppingCart,
  LuSquareUser,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { Link, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { CREATE_PREFIX, CREATE_SHORTCUTS } from "~/shortcuts";
import type { Route } from "~/types";
import { path } from "~/utils/path";

type CreateLink = Route<{ shortcut: string }>;

export function useCreate(): CreateLink[] {
  const permissions = usePermissions();
  const { t } = useLingui();

  const result = useMemo(() => {
    const links: CreateLink[] = [];
    if (permissions.can("create", "parts")) {
      links.push({
        name: t`Part`,
        to: path.to.newPart,
        shortcut: CREATE_SHORTCUTS.part,
        icon: <LuBlocks />
      });
    }

    if (permissions.can("create", "quality")) {
      links.push({
        name: t`Issue`,
        to: path.to.newIssue,
        shortcut: CREATE_SHORTCUTS.issue,
        icon: <LuShieldX />
      });
    }

    if (permissions.can("create", "production")) {
      links.push({
        name: t`Job`,
        to: path.to.newJob,
        shortcut: CREATE_SHORTCUTS.job,
        icon: <LuCirclePlay />
      });
    }

    if (permissions.can("update", "production")) {
      links.push({
        name: t`Batch`,
        to: path.to.newOperationBatch,
        shortcut: CREATE_SHORTCUTS.batch,
        icon: <LuLayers />
      });
    }

    if (permissions.can("create", "inventory")) {
      links.push({
        name: t`Picking List`,
        to: path.to.pickingSchedule,
        shortcut: CREATE_SHORTCUTS.pickingList,
        icon: <LuClipboardList />
      });
      links.push({
        name: t`Stock Transfer`,
        to: path.to.stockTransfersNew,
        shortcut: CREATE_SHORTCUTS.stockTransfer,
        icon: <LuListChecks />
      });
      links.push({
        name: t`Warehouse Transfer`,
        to: path.to.newWarehouseTransfer,
        shortcut: CREATE_SHORTCUTS.warehouseTransfer,
        icon: <LuArrowRightLeft />
      });
    }

    if (permissions.can("create", "production")) {
      links.push({
        name: t`Maintenance`,
        to: path.to.newMaintenanceDispatch,
        shortcut: CREATE_SHORTCUTS.maintenance,
        icon: <LuWrench />
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: t`Purchase Order`,
        to: path.to.newPurchaseOrder,
        shortcut: CREATE_SHORTCUTS.purchaseOrder,
        icon: <LuShoppingCart />
      });
    }

    if (permissions.can("create", "purchasing")) {
      links.push({
        name: t`Supplier`,
        to: path.to.newSupplier,
        shortcut: CREATE_SHORTCUTS.supplier,
        icon: <LuContainer />
      });
    }

    if (permissions.can("create", "sales")) {
      links.push({
        name: t`Customer`,
        to: path.to.newCustomer,
        shortcut: CREATE_SHORTCUTS.customer,
        icon: <LuSquareUser />
      });
      links.push({
        name: t`RFQ`,
        to: path.to.newSalesRFQ,
        shortcut: CREATE_SHORTCUTS.rfq,
        icon: <RiProgress2Line />
      });
      links.push({
        name: t`Quote`,
        to: path.to.newQuote,
        shortcut: CREATE_SHORTCUTS.quote,
        icon: <RiProgress4Line />
      });
      links.push({
        name: t`Sales Order`,
        to: path.to.newSalesOrder,
        shortcut: CREATE_SHORTCUTS.salesOrder,
        icon: <RiProgress8Line />
      });
    }

    if (permissions.can("create", "users")) {
      links.push({
        name: t`Employee`,
        to: path.to.newEmployee,
        shortcut: CREATE_SHORTCUTS.employee,
        icon: <LuUsers />
      });
    }

    return links;
  }, [permissions, t]);

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * c-then-letter opens the matching Create menu item from any page. Bind it
 * once (the Topbar) — the menu itself renders in several places.
 */
export function useCreateShortcuts() {
  const createLinks = useCreate();
  const navigate = useNavigate();
  const map = useMemo(
    () =>
      Object.fromEntries(
        createLinks.map((link) => [link.shortcut, () => navigate(link.to)])
      ),
    [createLinks, navigate]
  );
  useShortcutSequence({ prefix: CREATE_PREFIX, map });
}

const CreateMenu = ({
  trigger,
  open,
  onOpenChange
}: {
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const { t } = useLingui();
  const createLinks = useCreate();

  if (!createLinks.length) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="min-w-56"
        aria-label={t`Create`}
      >
        {createLinks.map((link) => (
          <DropdownMenuItem key={link.to} asChild className="whitespace-nowrap">
            <Link to={link.to}>
              {link.icon && <DropdownMenuIcon icon={link.icon} />}
              {link.name}
              <span aria-hidden className="ml-auto flex items-center pl-4">
                <ShortcutKey
                  shortcut={CREATE_PREFIX}
                  variant="small"
                  className="ml-0 mr-0.5"
                />
                <ShortcutKey
                  shortcut={link.shortcut}
                  variant="small"
                  className="mx-0"
                />
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CreateMenu;
