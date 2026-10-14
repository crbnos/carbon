// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  LuCheckCheck,
  LuCircleStop,
  LuHandCoins,
  LuLoaderCircle,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { useNavigation, useParams, useSubmit } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { action as statusAction } from "~/routes/x+/warehouse-transfer+/$transferId.status";
import { path } from "~/utils/path";
import { isWarehouseTransferLocked } from "../../inventory.models";
import type { WarehouseTransfer, WarehouseTransferLine } from "../../types";
import WarehouseTransferStatus from "./WarehouseTransferStatus";

const SHIPPABLE_STATUSES = ["To Ship", "To Ship and Receive"];
const RECEIVABLE_STATUSES = ["To Receive", "To Ship and Receive"];

const WarehouseTransferHeader = () => {
  const { t } = useLingui();
  const { transferId } = useParams();
  if (!transferId) throw new Error("transferId not found");

  const routeData = useRouteData<{
    warehouseTransfer: WarehouseTransfer;
    warehouseTransferLines: WarehouseTransferLine[];
  }>(path.to.warehouseTransfer(transferId));

  const permissions = usePermissions();
  const submit = useSubmit();
  const navigation = useNavigation();
  const deleteDisclosure = useDisclosure();

  // Storage rules eval at every "go" status transition (Confirm/Ship/Receive/
  // Complete). Surface violations through the hook's modal rather than the
  // plain navigation path.
  const statusRules = useRuleViolations<typeof statusAction>({
    action: path.to.warehouseTransferStatus(transferId)
  });
  const statusFetcher = statusRules.fetcher;

  const warehouseTransfer = routeData?.warehouseTransfer;
  if (!warehouseTransfer) {
    throw new Error("Could not find warehouse transfer in routeData");
  }

  const status = warehouseTransfer.status;
  const isDraft = status === "Draft";
  const isLocked = isWarehouseTransferLocked(status);
  const canUpdate = permissions.can("update", "inventory");
  const isChangingStatus = statusFetcher.state !== "idle";
  const pendingStatus = statusFetcher.formData?.get("status");

  const hasShippedItems = (routeData?.warehouseTransferLines ?? []).some(
    (line) => (line.shippedQuantity ?? 0) > 0
  );
  const canShip = SHIPPABLE_STATUSES.includes(status);
  const isReceivable = RECEIVABLE_STATUSES.includes(status);
  const canReceive = isReceivable && hasShippedItems;

  const isCreating = (action: string) =>
    navigation.state !== "idle" && navigation.formAction === action;
  const isShipping = isCreating(path.to.newShipment);
  const isReceiving = isCreating(path.to.newReceipt);

  const setStatus = (next: WarehouseTransfer["status"]) => {
    const formData = new FormData();
    formData.set("status", next);
    statusRules.submit(formData);
  };

  // Ship and Receive each raise a new document from this transfer; the ones
  // already raised are listed under Documents.
  const createDocument = (
    sourceDocument: "Outbound Transfer" | "Inbound Transfer",
    action: string
  ) => {
    const formData = new FormData();
    formData.set("sourceDocument", sourceDocument);
    formData.set("sourceDocumentId", warehouseTransfer.id);
    submit(formData, { method: "post", action });
  };

  return (
    <>
      <DocumentPageHeader
        title={warehouseTransfer.transferId}
        status={<WarehouseTransferStatus status={status} />}
        meta={[
          <Trans key="created">
            Created{" "}
            <DateTime value={warehouseTransfer.createdAt} variant="relative" />{" "}
            by <EmployeeAvatar employeeId={warehouseTransfer.createdBy} />
          </Trans>
        ]}
        menuItems={
          <>
            <DropdownMenuItem
              disabled={isDraft || isChangingStatus || !canUpdate}
              onClick={() => {
                statusFetcher.submit(
                  { status: "Draft" },
                  {
                    method: "post",
                    action: path.to.warehouseTransferStatus(transferId)
                  }
                );
              }}
            >
              <DropdownMenuIcon icon={<LuLoaderCircle />} />
              <Trans>Reopen</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                ["Cancelled", "Completed"].includes(status) ||
                isChangingStatus ||
                !canUpdate
              }
              destructive
              onClick={() => setStatus("Cancelled")}
            >
              <DropdownMenuIcon icon={<LuCircleStop />} />
              <Trans>Cancel</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={
                isLocked ||
                !permissions.can("delete", "inventory") ||
                !permissions.is("employee")
              }
              destructive
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Warehouse Transfer</Trans>
            </DropdownMenuItem>
          </>
        }
        actions={
          <>
            {isDraft && (
              <Button
                type="button"
                variant="primary"
                leftIcon={<LuCheckCheck />}
                isDisabled={isChangingStatus || !canUpdate}
                isLoading={
                  isChangingStatus && pendingStatus === "To Ship and Receive"
                }
                onClick={() => setStatus("To Ship and Receive")}
              >
                <Trans>Confirm</Trans>
              </Button>
            )}
            {canShip && (
              <Button
                type="button"
                variant={canReceive ? "secondary" : "primary"}
                leftIcon={<LuTruck />}
                isDisabled={isShipping}
                isLoading={isShipping}
                onClick={() =>
                  createDocument("Outbound Transfer", path.to.newShipment)
                }
              >
                <Trans>Ship</Trans>
              </Button>
            )}
            {isReceivable && (
              <Button
                type="button"
                variant={canReceive ? "primary" : "secondary"}
                leftIcon={<LuHandCoins />}
                isDisabled={!canReceive || isReceiving}
                isLoading={isReceiving}
                onClick={() =>
                  createDocument("Inbound Transfer", path.to.newReceipt)
                }
              >
                <Trans>Receive</Trans>
              </Button>
            )}
          </>
        }
      />

      <statusRules.ViolationModal />
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteWarehouseTransfer(transferId)}
          isOpen={deleteDisclosure.isOpen}
          name={warehouseTransfer.transferId ?? "warehouse transfer"}
          text={t`Are you sure you want to delete ${warehouseTransfer.transferId}? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default WarehouseTransferHeader;
