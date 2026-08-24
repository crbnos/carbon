import { OnshapeLogo } from "@carbon/ee";
import {
  Badge,
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
  Spinner,
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
import { OnshapeLinkPart } from "~/components/OnshapeLinkPart";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useOnshape } from "~/hooks/useOnshape";
import { useOnshapeImportStatus } from "~/hooks/useOnshapeImportStatus";
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
  const onshape = useOnshape();
  const onshapeLinkModal = useDisclosure();
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

  // Building a part out from Onshape is asynchronous: the bill of materials,
  // the models and the drawings land seconds to minutes after the part exists,
  // and the outcome only reaches the user as a notification when something
  // needs attention. Without this a clean import is indistinguishable from one
  // that never started. The create modal blocks on the same record; this is for
  // everyone who arrives at the part some other way.
  const onshapeImport = useOnshapeImportStatus(itemId, onshape.isConnected);

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
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
            {onshapeImport.running && (
              <Badge variant="outline" className="gap-1.5 shrink-0">
                <Spinner className="size-3" />
                <Trans>Importing from Onshape…</Trans>
              </Badge>
            )}
            {onshapeImport.justFinished && (
              <Badge
                variant={onshapeImport.attentionCount > 0 ? "yellow" : "green"}
                className="shrink-0"
              >
                {onshapeImport.attentionCount > 0 ? (
                  <Trans>Imported from Onshape — check notifications</Trans>
                ) : (
                  <Trans>Imported from Onshape</Trans>
                )}
              </Badge>
            )}
            {onshapeImport.failed && (
              <Badge variant="destructive" className="shrink-0">
                <Trans>Onshape import did not finish</Trans>
              </Badge>
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
                {onshape.isConnected && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!permissions.can("update", "parts")}
                      onClick={onshapeLinkModal.onOpen}
                    >
                      <DropdownMenuIcon
                        icon={<OnshapeLogo className="h-3.5 w-auto" />}
                      />
                      <Trans>Link to Onshape</Trans>
                    </DropdownMenuItem>
                  </>
                )}
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
        {onshape.isConnected && onshapeLinkModal.isOpen && (
          <OnshapeLinkPart
            itemId={itemId}
            readableIdWithRevision={
              routeData?.partSummary?.readableIdWithRevision ?? itemId
            }
            isOpen={onshapeLinkModal.isOpen}
            onClose={onshapeLinkModal.onClose}
          />
        )}
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
