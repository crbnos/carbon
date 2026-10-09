// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { DetailsTopbar } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useResolved } from "~/hooks/useResolved";
import { path } from "~/utils/path";
import type { Material } from "../../types";
import { getItemLifecycleStatus } from "../Item/ItemSupersessionForm";
import { useMaterialNavigation } from "./useMaterialNavigation";

const MaterialHeader = () => {
  const { t } = useLingui();
  const links = useMaterialNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const routeData = useRouteData<{
    materialSummary: Material;
    supersession: Promise<{
      supersessionMode:
        | "Consume First"
        | "Prefer New"
        | "Stock Only"
        | "No Stock";
    } | null>;
  }>(path.to.material(itemId));

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "item",
    entityId: itemId,
    companyId: company.id,
    variant: "dropdown",
    downloadable: true,
    downloadName:
      routeData?.materialSummary?.readableIdWithRevision ?? undefined
  });

  const supersession = useResolved(routeData?.supersession, null, itemId);
  const lifecycleStatus = getItemLifecycleStatus(
    supersession?.supersessionMode
  );

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <VStack spacing={0} className="flex-grow">
          <HStack>
            <Link to={path.to.materialDetails(itemId)}>
              <Heading size="h4" className="flex items-center gap-2">
                {/* <ModuleIcon icon={<MethodItemTypeIcon type="Material" />} /> */}
                <span>
                  {routeData?.materialSummary?.readableIdWithRevision}
                </span>
              </Heading>
            </Link>
            <Copy
              text={routeData?.materialSummary?.readableIdWithRevision ?? ""}
            />
            {lifecycleStatus && (
              <Status color={lifecycleStatus.color}>
                {lifecycleStatus.label}
              </Status>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  disabled={
                    !permissions.can("delete", "parts") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Material</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>
        <VStack spacing={0} className="flex-shrink justify-center items-end">
          <DetailsTopbar links={links} />
        </VStack>
        {deleteModal.isOpen && (
          <ConfirmDelete
            action={path.to.deleteItem(itemId)}
            isOpen={deleteModal.isOpen}
            name={
              routeData?.materialSummary?.readableIdWithRevision ?? "material"
            }
            text={t`Are you sure you want to delete ${routeData?.materialSummary?.readableIdWithRevision}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
            }}
            onSubmit={() => {
              deleteModal.onClose();
            }}
          />
        )}
      </div>
      {auditLogDrawer}
    </>
  );
};

export default MaterialHeader;
