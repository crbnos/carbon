// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { useRuleViolations } from "@carbon/ee/rules";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuBarcode,
  LuCircleCheck,
  LuCirclePlay,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { PrintButton } from "~/components";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { useAuditLog } from "~/components/AuditLog";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import {
  isStockTransferLocked,
  type StockTransfer,
  type StockTransferLine
} from "~/modules/inventory";
import { path } from "~/utils/path";
import StockTransferCompleteModal from "./StockTransferCompleteModal";
import StockTransferStatus from "./StockTransferStatus";

const StockTransferHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  if (!routeData?.stockTransfer)
    throw new Error("Failed to load stockTransfer");
  const status = routeData.stockTransfer.status;

  const { t } = useLingui();
  const { company } = useUser();
  const permissions = usePermissions();
  const postModal = useDisclosure();
  const deleteModal = useDisclosure();
  const statusFetcher = useFetcher<Result>();
  // Storage rules fire on Release + Complete (the "go" transitions). Each gets
  // its own fetcher so Release's loading state doesn't disable Complete and
  // vice versa, and violations surface via a single shared modal.
  const releaseRules = useRuleViolations({
    action: path.to.stockTransferStatus(id)
  });
  const releaseFetcher = releaseRules.fetcher;
  const completeRules = useRuleViolations({
    action: path.to.stockTransferStatus(id)
  });
  const completeFetcher = completeRules.fetcher;
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "stockTransfer",
    entityId: id,
    companyId: company.id,
    variant: "dropdown"
  });

  const canComplete =
    routeData.stockTransferLines.length > 0 &&
    routeData.stockTransferLines.some(
      (line) => (line.pickedQuantity ?? 0) !== 0
    ) &&
    ["Released", "In Progress"].includes(status);

  const isCompleted = status === "Completed";
  const isLocked = isStockTransferLocked(status);

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "stockTransfer"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.stockTransfer?.assignee;

  const hasPickedItems = routeData?.stockTransferLines.some(
    (line) => line.pickedQuantity && line.pickedQuantity > 0
  );

  const hasTrackedLines = routeData?.stockTransferLines.some(
    (line) => !!line.trackedEntityId
  );

  const statusBadge = (
    <StockTransferStatus status={routeData?.stockTransfer?.status} />
  );

  const menuItems = (
    <>
      {auditLogTrigger}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={
          ["Draft"].includes(routeData?.stockTransfer?.status ?? "") ||
          statusFetcher.state !== "idle" ||
          !permissions.can("delete", "inventory")
        }
        onClick={() => {
          statusFetcher.submit(
            { status: "Draft" },
            {
              method: "post",
              action: path.to.stockTransferStatus(id)
            }
          );
        }}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          !permissions.can("delete", "inventory") ||
          !permissions.is("employee") ||
          !["Released", "Draft"].includes(status) ||
          hasPickedItems ||
          isLocked
        }
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Stock Transfer</Trans>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={routeData?.stockTransfer?.stockTransferId}
        copyValue={routeData?.stockTransfer?.stockTransferId ?? ""}
        menu={menuItems}
        status={statusBadge}
        actions={
          <>
            <RecordAction slot="overflow">
              <Assignee
                size="md"
                id={id}
                value={assignee ?? ""}
                table="stockTransfer"
                isReadOnly={!permissions.can("update", "inventory")}
              />
            </RecordAction>
            {hasTrackedLines && (
              <RecordAction slot="overflow">
                <PrintButton
                  sourceDocument="StockTransfer"
                  sourceDocumentId={id}
                  locationId={routeData?.stockTransfer?.locationId ?? undefined}
                  context="inventory"
                  fileRoutes={{
                    pdf: path.to.file.stockTransferLabelsPdf,
                    zpl: path.to.file.stockTransferLabelsZpl
                  }}
                />
              </RecordAction>
            )}
            <RecordAction slot="secondary">
              <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
                <a
                  target="_blank"
                  href={path.to.file.stockTransfer(id)}
                  rel="noreferrer"
                >
                  <Trans>Pick List</Trans>
                </a>
              </Button>
            </RecordAction>
            <RecordAction slot={status === "Draft" ? "primary" : "overflow"}>
              <Button
                type="button"
                leftIcon={<LuCirclePlay />}
                variant={status === "Draft" ? "primary" : "secondary"}
                isDisabled={
                  status !== "Draft" ||
                  releaseFetcher.state !== "idle" ||
                  !permissions.can("update", "inventory")
                }
                isLoading={releaseFetcher.state !== "idle"}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("status", "Released");
                  releaseRules.submit(fd);
                }}
              >
                <Trans>Release</Trans>
              </Button>
            </RecordAction>
            <releaseRules.ViolationModal />

            <RecordAction slot={status === "Draft" ? "overflow" : "primary"}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData();
                  fd.set("status", "Completed");
                  completeRules.submit(fd);
                }}
              >
                <Button
                  type="submit"
                  variant={
                    canComplete && !isCompleted ? "primary" : "secondary"
                  }
                  isDisabled={
                    !canComplete ||
                    isCompleted ||
                    !permissions.is("employee") ||
                    completeFetcher.state !== "idle"
                  }
                  leftIcon={<LuCircleCheck />}
                  isLoading={completeFetcher.state !== "idle"}
                >
                  <Trans>Complete</Trans>
                </Button>
              </form>
            </RecordAction>
            <completeRules.ViolationModal />
          </>
        }
      />

      {postModal.isOpen && (
        <StockTransferCompleteModal onClose={postModal.onClose} />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteStockTransfer(id)}
          isOpen={deleteModal.isOpen}
          name={routeData?.stockTransfer?.stockTransferId ?? "stockTransfer"}
          text={t`Are you sure you want to delete ${routeData?.stockTransfer?.stockTransferId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default StockTransferHeader;
