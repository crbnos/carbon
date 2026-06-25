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
import { path } from "~/utils/path";
import type { Tool } from "../../types";
import { getItemLifecycleStatus } from "../Item/ItemSupersessionForm";
import { useToolNavigation } from "./useToolNavigation";

const ToolHeader = () => {
  const { t } = useLingui();
  const links = useToolNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "item",
    entityId: itemId,
    companyId: company.id,
    variant: "dropdown"
  });

  const routeData = useRouteData<{
    toolSummary: Tool;
    supersession: {
      supersessionMode:
        | "Consume First"
        | "Prefer New"
        | "Stock Only"
        | "No Stock";
    } | null;
  }>(path.to.tool(itemId));

  const lifecycleStatus = getItemLifecycleStatus(
    routeData?.supersession?.supersessionMode
  );

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <VStack spacing={0} className="flex-grow">
          <HStack>
            <Link to={path.to.toolDetails(itemId)}>
              <Heading size="h4" className="flex items-center gap-2">
                {/* <ModuleIcon icon={<MethodItemTypeIcon type="Tool" />} /> */}
                <span>{routeData?.toolSummary?.readableIdWithRevision}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.toolSummary?.readableIdWithRevision ?? ""} />
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
                  disabled={
                    !permissions.can("delete", "parts") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Tool</Trans>
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
            name={routeData?.toolSummary?.readableIdWithRevision ?? "tool"}
            text={t`Are you sure you want to delete ${routeData?.toolSummary?.readableIdWithRevision}? This cannot be undone.`}
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

export default ToolHeader;
