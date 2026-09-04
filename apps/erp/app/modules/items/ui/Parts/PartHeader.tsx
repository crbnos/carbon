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
import {
  LuEllipsisVertical,
  LuGitPullRequestArrow,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { DetailsTopbar } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { PartSummary } from "../../types";
import { CreateChangeNoticeModal } from "../ChangeNotice";
import { getItemLifecycleStatus } from "../Item/ItemSupersessionForm";
import { usePartNavigation } from "./usePartNavigation";

const PartHeader = () => {
  const { t } = useLingui();
  const links = usePartNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const changeNoticeModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "item",
    entityId: itemId,
    companyId: company.id,
    variant: "dropdown"
  });

  const routeData = useRouteData<{
    partSummary: PartSummary;
    supersession: {
      supersessionMode:
        | "Consume First"
        | "Prefer New"
        | "Stock Only"
        | "No Stock";
    } | null;
  }>(path.to.part(itemId));

  const lifecycleStatus = getItemLifecycleStatus(
    routeData?.supersession?.supersessionMode
  );

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <VStack spacing={0} className="flex-grow">
          <HStack>
            <Link to={path.to.partDetails(itemId)}>
              <Heading size="h4" className="flex items-center gap-2">
                {/* <ModuleIcon icon={<MethodItemTypeIcon type="Part" />} /> */}
                <span>{routeData?.partSummary?.readableIdWithRevision}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.partSummary?.readableIdWithRevision ?? ""} />
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
                  size="sm"
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!permissions.can("create", "parts")}
                  onClick={changeNoticeModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
                  <Trans>Create Change Notice</Trans>
                </DropdownMenuItem>
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
                  <Trans>Delete Part</Trans>
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
            name={routeData?.partSummary?.readableIdWithRevision ?? "part"}
            text={t`Are you sure you want to delete ${routeData?.partSummary?.readableIdWithRevision}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
            }}
            onSubmit={() => {
              deleteModal.onClose();
            }}
          />
        )}
      </div>
      {changeNoticeModal.isOpen && (
        <CreateChangeNoticeModal
          itemId={itemId}
          onClose={changeNoticeModal.onClose}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default PartHeader;
