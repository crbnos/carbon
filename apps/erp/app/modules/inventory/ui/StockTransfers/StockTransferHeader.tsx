// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { useRuleViolations } from "@carbon/ee/rules";
import {
  Badge,
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuLoaderCircle,
  LuScanQrCode,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { DateTime, EmployeeAvatar, PrintButton } from "~/components";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { DocumentPageHeader } from "~/components/DocumentPage";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import {
  isStockTransferLocked,
  type StockTransfer,
  type StockTransferLine
} from "~/modules/inventory";
import { path } from "~/utils/path";
import StockTransferStatus from "./StockTransferStatus";

const StockTransferHeader = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  const permissions = usePermissions();
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

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "stockTransfer"
  });

  const stockTransfer = routeData?.stockTransfer;
  if (!stockTransfer) throw new Error("Failed to load stockTransfer");

  const status = stockTransfer.status;
  const lines = routeData?.stockTransferLines ?? [];

  const isDraft = status === "Draft";
  const isCompleted = status === "Completed";
  const isLocked = isStockTransferLocked(status);

  const canComplete =
    lines.length > 0 &&
    lines.some((line) => (line.pickedQuantity ?? 0) !== 0) &&
    ["Released", "In Progress"].includes(status);

  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : stockTransfer.assignee;

  const hasPickedItems = lines.some(
    (line) => line.pickedQuantity && line.pickedQuantity > 0
  );

  const hasTrackedLines = lines.some((line) => !!line.trackedEntityId);

  return (
    <>
      <DocumentPageHeader
        title={stockTransfer.stockTransferId}
        status={<StockTransferStatus status={status} />}
        meta={[
          <Trans key="created">
            Created{" "}
            <DateTime value={stockTransfer.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={stockTransfer.createdBy} />
          </Trans>,
          stockTransfer.completedAt ? (
            <Trans key="completed">
              Completed{" "}
              <DateTime value={stockTransfer.completedAt} variant="relative" />
            </Trans>
          ) : null,
          stockTransfer.kanbanId ? (
            <Badge key="kanban" variant="outline">
              <Link
                to={path.to.kanban(stockTransfer.kanbanId)}
                className="flex flex-row items-center gap-1"
              >
                <LuScanQrCode />
                <Trans>Kanban</Trans>
              </Link>
            </Badge>
          ) : null
        ]}
        menuItems={
          <>
            {!isDraft && (
              <>
                <DropdownMenuItem
                  disabled={
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
              </>
            )}
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
        }
        actions={
          <>
            <Assignee
              size="md"
              id={id}
              value={assignee ?? ""}
              table="stockTransfer"
              isReadOnly={!permissions.can("update", "inventory")}
            />
            {hasTrackedLines && (
              <PrintButton
                sourceDocument="StockTransfer"
                sourceDocumentId={id}
                locationId={stockTransfer.locationId ?? undefined}
                context="inventory"
                fileRoutes={{
                  pdf: path.to.file.stockTransferLabelsPdf,
                  zpl: path.to.file.stockTransferLabelsZpl
                }}
              />
            )}
            {isDraft && (
              <Button
                type="button"
                leftIcon={<LuCirclePlay />}
                variant="primary"
                isDisabled={
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
            )}
            {!isCompleted && (
              // Release comes first: until then Complete is shown, but it is
              // not the next step.
              <Button
                type="button"
                variant={isDraft ? "secondary" : "primary"}
                isDisabled={
                  !canComplete ||
                  !permissions.is("employee") ||
                  completeFetcher.state !== "idle"
                }
                leftIcon={<LuCircleCheck />}
                isLoading={completeFetcher.state !== "idle"}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("status", "Completed");
                  completeRules.submit(fd);
                }}
              >
                <Trans>Complete</Trans>
              </Button>
            )}
          </>
        }
      />

      <releaseRules.ViolationModal />
      <completeRules.ViolationModal />
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteStockTransfer(id)}
          isOpen={deleteModal.isOpen}
          name={stockTransfer.stockTransferId ?? "stockTransfer"}
          text={t`Are you sure you want to delete ${stockTransfer.stockTransferId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default StockTransferHeader;
