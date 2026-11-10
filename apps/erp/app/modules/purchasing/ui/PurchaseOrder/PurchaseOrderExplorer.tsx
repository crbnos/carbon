// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  PrefetchLink,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { distinctItemText, getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuCirclePlus,
  LuCopy,
  LuEllipsisVertical,
  LuPackageCheck,
  LuPackageX,
  LuSettings2,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import type { DragHandleBindings } from "~/components/LineReorder";
import {
  ReorderableLineList,
  ReorderableRow,
  ReorderEditBar,
  useLineOrderEditMode
} from "~/components/LineReorder";
import { Confirm } from "~/components/Modals";
import {
  useDrawerItem,
  useOptimisticLocation,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { itemType } from "~/modules/shared/shared.models";
import type { ItemType } from "~/modules/shared/types";
import { EXPLORER_SHORTCUTS } from "~/shortcuts";
import { useItems } from "~/stores";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { isPurchaseOrderEditLocked } from "../../purchasing.models";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "../../types";
import DeletePurchaseOrderLine from "./DeletePurchaseOrderLine";
import PurchaseOrderLineForm from "./PurchaseOrderLineForm";

export default function PurchaseOrderExplorer() {
  const { t } = useLingui();
  const { defaults } = useUser();
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const purchaseOrderData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    lines: PurchaseOrderLine[];
    supplier: Supplier;
  }>(path.to.purchaseOrder(orderId));
  const permissions = usePermissions();

  const purchaseOrderLineInitialValues = {
    purchaseOrderId: orderId,
    // "Item" is the picker's generic mode, not a member of the line-type enum.
    // Posting it made the validator fail with "Type is required" — an error
    // naming a field the modal doesn't show. Start from a real type; the item
    // picker overwrites it with the selected item's type on change.
    purchaseOrderLineType: "Part" as ItemType,
    purchaseQuantity: 1,
    supplierUnitPrice: 0,
    locationId:
      purchaseOrderData?.purchaseOrder?.locationId ?? defaults.locationId ?? "",
    supplierTaxAmount: 0,
    taxPercent: 0,
    supplierShippingCost: 0,
    exchangeRate: purchaseOrderData?.purchaseOrder?.exchangeRate ?? 1,
    requiredDate:
      purchaseOrderData?.purchaseOrder?.receiptRequestedDate ?? undefined,
    promisedDate:
      purchaseOrderData?.purchaseOrder?.receiptPromisedDate ?? undefined
  };

  const newPurchaseOrderLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<PurchaseOrderLine | null>(null);
  const duplicateLine = useDrawerItem<PurchaseOrderLine>();

  // A released order keeps its lines editable while it is not complete; an
  // edit above the approved amount sends it back for approval.
  const isDisabled = isPurchaseOrderEditLocked(
    purchaseOrderData?.purchaseOrder?.status
  );
  // A Planned PO is one planning created and nobody has sent yet, so a line
  // can still come off it, the same as on a Draft.
  const isDeleteDisabled = !["Draft", "Planned"].includes(
    purchaseOrderData?.purchaseOrder?.status ?? ""
  );

  const lines = useMemo(
    () => purchaseOrderData?.lines ?? [],
    [purchaseOrderData]
  );

  const canReorder =
    !isDisabled && permissions.can("update", "purchasing") && lines.length > 1;

  const editMode = useLineOrderEditMode<PurchaseOrderLine>({
    actionPath: path.to.purchaseOrderLineOrder(orderId),
    lines
  });

  const onDeleteLine = (line: PurchaseOrderLine) => {
    setDeleteLine(line);
    deleteLineDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    deleteLineDisclosure.onClose();
  };

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            editMode.isEditing ? (
              <ReorderableLineList<PurchaseOrderLine>
                lines={editMode.draft}
                activeLine={editMode.activeLine}
                onDragStart={editMode.handleDragStart}
                onDragEnd={editMode.handleDragEnd}
                renderRow={(line, dragHandle) => (
                  <PurchaseOrderLineBody line={line} dragHandle={dragHandle} />
                )}
                renderOverlay={(line) => (
                  <PurchaseOrderLineBody line={line} isOverlay />
                )}
              />
            ) : (
              lines.map((line) => (
                <PurchaseOrderLineItem
                  key={line.id}
                  isDeleteDisabled={isDeleteDisabled}
                  isDuplicateDisabled={isDisabled}
                  line={line}
                  onDelete={onDeleteLine}
                  onDuplicate={duplicateLine.open}
                />
              ))
            )
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={newPurchaseOrderLineDisclosure.onOpen}
                >
                  <Trans>Add Line Item</Trans>
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex border-t border-border p-4 gap-2">
          {editMode.isEditing ? (
            <ReorderEditBar
              isSaving={editMode.isSaving}
              isDirty={editMode.isDirty}
              onSave={editMode.save}
              onCancel={editMode.cancelEditMode}
            />
          ) : (
            <>
              <Button
                className="flex-1"
                shortcut={EXPLORER_SHORTCUTS.addLine}
                isDisabled={isDisabled || !permissions.can("update", "sales")}
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={newPurchaseOrderLineDisclosure.onOpen}
              >
                <Trans>Add Line Item</Trans>
              </Button>
              {canReorder && lines.length > 0 && (
                <IconButton
                  aria-label={t`Reorder lines`}
                  icon={<LuSettings2 />}
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={editMode.enterEditMode}
                />
              )}
            </>
          )}
        </div>
      </VStack>
      {newPurchaseOrderLineDisclosure.openCount > 0 && (
        <PurchaseOrderLineForm
          key={`newPurchaseOrderLineDisclosure-${newPurchaseOrderLineDisclosure.openCount}`}
          open={newPurchaseOrderLineDisclosure.isOpen}
          initialValues={purchaseOrderLineInitialValues}
          type="modal"
          onClose={newPurchaseOrderLineDisclosure.onClose}
        />
      )}
      {duplicateLine.item && (
        <PurchaseOrderLineForm
          key={`duplicateLine-${duplicateLine.key}`}
          open={duplicateLine.isOpen}
          initialValues={getDuplicateLineValues(duplicateLine.item)}
          type="modal"
          onClose={duplicateLine.close}
        />
      )}
      {deleteLine && (
        <DeletePurchaseOrderLine
          line={deleteLine}
          isOpen={deleteLineDisclosure.isOpen}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

function getDuplicateLineValues(line: PurchaseOrderLine) {
  return {
    purchaseOrderId: line.purchaseOrderId ?? "",
    purchaseOrderLineType: (line.purchaseOrderLineType ?? "Part") as "Part",
    itemId: line.itemId ?? "",
    accountId: line.accountId ?? "",
    assetId: line.assetId ?? "",
    conversionFactor: line.conversionFactor ?? 1,
    description: line.description ?? "",
    exchangeRate: line.exchangeRate ?? 1,
    inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode ?? "",
    jobId: line.jobId ?? "",
    jobOperationId: line.jobOperationId ?? "",
    locationId: line.locationId ?? "",
    purchaseQuantity: line.purchaseQuantity ?? 1,
    purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "",
    requiredDate: line.requiredDate ?? undefined,
    promisedDate: line.promisedDate ?? undefined,
    storageUnitId: line.storageUnitId ?? "",
    supplierPartId: line.supplierPartId ?? "",
    supplierShippingCost: line.supplierShippingCost ?? 0,
    supplierTaxAmount: line.supplierTaxAmount ?? 0,
    supplierUnitPrice: line.supplierUnitPrice ?? 0,
    costCenterId: line.costCenterId ?? "",
    taxPercent: line.taxPercent ?? 0,
    assetReadableId: line.assetReadableId ?? "",
    assetName: line.assetName ?? "",
    ...getCustomFields(line.customFields)
  };
}

function PurchaseOrderLineBody({
  line,
  dragHandle,
  isOverlay
}: {
  line: PurchaseOrderLine;
  dragHandle?: DragHandleBindings;
  isOverlay?: boolean;
}) {
  const [items] = useItems();
  const subtitle =
    line.purchaseOrderLineType === "G/L Account"
      ? "G/L Account"
      : line.purchaseOrderLineType === "Fixed Asset"
        ? (line as any).assetName || line.description
        : distinctItemText(
            getItemReadableId(items, line.itemId),
            line.description
          );
  return (
    <ReorderableRow dragHandle={dragHandle} isOverlay={isOverlay}>
      <HStack spacing={2} className="flex-grow min-w-0 p-2 pr-10">
        <ItemThumbnail thumbnailPath={line.thumbnailPath} type="Part" />
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold line-clamp-1">
            {line.purchaseOrderLineType === "G/L Account"
              ? line.description || "Indirect Expense"
              : line.purchaseOrderLineType === "Fixed Asset"
                ? (line as any).assetReadableId || "Fixed Asset"
                : getItemReadableId(items, line.itemId)}
          </span>
          {subtitle && (
            <span className="text-muted-foreground text-xs truncate line-clamp-1">
              {subtitle}
            </span>
          )}
        </VStack>
      </HStack>
    </ReorderableRow>
  );
}

type PurchaseOrderLineItemProps = {
  line: PurchaseOrderLine;
  isDeleteDisabled: boolean;
  isDuplicateDisabled: boolean;
  onDelete: (line: PurchaseOrderLine) => void;
  onDuplicate: (line: PurchaseOrderLine) => void;
};

function PurchaseOrderLineItem({
  line,
  isDeleteDisabled,
  isDuplicateDisabled,
  onDelete,
  onDuplicate
}: PurchaseOrderLineItemProps) {
  const { t } = useLingui();
  const [items] = useItems();
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const receivingDisclosure = useDisclosure();
  const location = useOptimisticLocation();
  const orderData = useRouteData<{ purchaseOrder: PurchaseOrder }>(
    path.to.purchaseOrder(orderId)
  );

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const isSelected =
    location.pathname === path.to.purchaseOrderLine(orderId, line.id!);

  const isReceivableLineType =
    line.purchaseOrderLineType !== "Comment" &&
    line.purchaseOrderLineType !== "G/L Account";
  const hasOutstandingQuantity = (line.quantityToReceive ?? 0) > 0;
  const orderStatus = orderData?.purchaseOrder?.status ?? "";
  const canUpdate = permissions.can("update", "purchasing");
  const canStopReceiving =
    canUpdate &&
    isReceivableLineType &&
    hasOutstandingQuantity &&
    !line.receivedComplete &&
    ["To Receive", "To Receive and Invoice"].includes(orderStatus);
  const canResumeReceiving =
    canUpdate &&
    isReceivableLineType &&
    hasOutstandingQuantity &&
    !!line.receivedComplete &&
    [
      "To Receive",
      "To Receive and Invoice",
      "To Invoice",
      "Completed"
    ].includes(orderStatus);

  const subtitle =
    line.purchaseOrderLineType === "G/L Account"
      ? "G/L Account"
      : line.purchaseOrderLineType === "Fixed Asset"
        ? line.assetName || line.description
        : distinctItemText(
            getItemReadableId(items, line.itemId),
            line.description
          );

  const lineName =
    line.purchaseOrderLineType === "G/L Account"
      ? line.description || "G/L Account"
      : line.purchaseOrderLineType === "Fixed Asset"
        ? (line as any).assetReadableId || "Fixed Asset"
        : getItemReadableId(items, line.itemId);

  return (
    <VStack spacing={0} className="border-b">
      <HStack
        className={cn(
          "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
          isSelected && "bg-accent/60 hover:bg-accent/50"
        )}
      >
        <PrefetchLink
          to={path.to.purchaseOrderLine(orderId, line.id!)}
          className="flex min-w-0 flex-grow outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail
              thumbnailPath={line.thumbnailPath}
              type="Part" // TODO
            />

            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">{lineName}</span>
              {subtitle && (
                <span className="text-muted-foreground text-xs truncate line-clamp-1">
                  {subtitle}
                </span>
              )}
            </VStack>
          </HStack>
        </PrefetchLink>
        <div className="absolute right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More actions for ${lineName}`}
                className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.duplicate}
                disabled={
                  isDuplicateDisabled ||
                  !permissions.can("create", "purchasing")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onDuplicate(line);
                }}
              >
                <DropdownMenuIcon icon={<LuCopy />} />
                <Trans>Duplicate Line</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.delete}
                destructive
                disabled={
                  isDeleteDisabled || !permissions.can("delete", "purchasing")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(line);
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete Line</Trans>
              </DropdownMenuItem>
              {(canStopReceiving || canResumeReceiving) && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    receivingDisclosure.onOpen();
                  }}
                >
                  <DropdownMenuIcon
                    icon={
                      canStopReceiving ? <LuPackageX /> : <LuPackageCheck />
                    }
                  />
                  {canStopReceiving ? (
                    <Trans>Stop Receiving</Trans>
                  ) : (
                    <Trans>Resume Receiving</Trans>
                  )}
                </DropdownMenuItem>
              )}
              {(itemType as readonly string[]).includes(
                line?.purchaseOrderLineType ?? ""
              ) && (
                <DropdownMenuItem shortcut={MENU_ITEM_SHORTCUTS.view} asChild>
                  <Link
                    to={getLinkToItemDetails(
                      line.purchaseOrderLineType as ItemType,
                      line.itemId!
                    )}
                  >
                    <DropdownMenuIcon
                      icon={<MethodItemTypeIcon type={"Part"} />}
                    />
                    <Trans>View Item Master</Trans>
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </HStack>
      <Confirm
        isOpen={receivingDisclosure.isOpen}
        action={path.to.purchaseOrderLineReceiving(orderId, line.id!)}
        title={canStopReceiving ? t`Stop Receiving` : t`Resume Receiving`}
        text={
          canStopReceiving
            ? t`The remaining ${line.quantityToReceive} ${
                line.purchaseUnitOfMeasureCode ?? ""
              } will no longer be expected. On-order supply and MRP will stop counting it. The ordered quantity and pricing are unchanged.`
            : t`The remaining ${line.quantityToReceive} ${
                line.purchaseUnitOfMeasureCode ?? ""
              } will be expected again and counted as incoming supply.`
        }
        confirmText={canStopReceiving ? t`Stop Receiving` : t`Resume Receiving`}
        onCancel={receivingDisclosure.onClose}
        onSubmit={receivingDisclosure.onClose}
      >
        <input
          type="hidden"
          name="intent"
          value={canStopReceiving ? "close" : "reopen"}
        />
      </Confirm>
    </VStack>
  );
}
