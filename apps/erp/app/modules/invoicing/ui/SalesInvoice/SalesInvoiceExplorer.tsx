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
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useKeyboardShortcuts,
  usePrettifyShortcut,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
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
import {
  useOptimisticLocation,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { Supplier } from "~/modules/purchasing/types";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isSalesInvoiceLocked } from "../../invoicing.models";
import type { SalesInvoice, SalesInvoiceLine } from "../../types";
import DeleteSalesInvoiceLine from "./DeleteSalesInvoiceLine";
import SalesInvoiceLineForm from "./SalesInvoiceLineForm";

export default function SalesInvoiceExplorer() {
  const prettifyShortcut = usePrettifyShortcut();
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");
  const salesInvoiceData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    supplier: Supplier;
  }>(path.to.salesInvoice(invoiceId));
  const permissions = usePermissions();

  const salesInvoiceLineInitialValues = {
    invoiceId: invoiceId,
    invoiceLineType: "Item" as MethodItemType,
    quantity: 1,
    locationId:
      salesInvoiceData?.salesInvoice?.locationId ?? defaults.locationId ?? "",
    unitOfMeasureCode: "",
    taxPercent: 0,
    unitPrice: 0,
    shippingCost: 0,
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    taxAmount: 0,
    exchangeRate: salesInvoiceData?.salesInvoice?.exchangeRate ?? 1
  };

  const newSalesInvoiceLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesInvoiceLine | null>(null);
  const isLocked = isSalesInvoiceLocked(salesInvoiceData?.salesInvoice?.status);
  const isDisabled = isLocked
    ? true
    : salesInvoiceData?.salesInvoice?.status !== "Draft";

  const onDeleteLine = (line: SalesInvoiceLine) => {
    setDeleteLine(line);
    deleteLineDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setDeleteLine(null);
    deleteLineDisclosure.onClose();
  };

  const newButtonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+l": (event: KeyboardEvent) => {
      event.stopPropagation();
      newButtonRef.current?.click();
    }
  });

  const lines = salesInvoiceData?.salesInvoiceLines ?? [];
  const canReorder =
    !isDisabled && permissions.can("update", "invoicing") && lines.length > 1;

  const editMode = useLineOrderEditMode<SalesInvoiceLine>({
    actionPath: path.to.salesInvoiceLineOrder(invoiceId),
    lines
  });

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            editMode.isEditing ? (
              <ReorderableLineList<SalesInvoiceLine>
                lines={editMode.draft}
                activeLine={editMode.activeLine}
                onDragStart={editMode.handleDragStart}
                onDragEnd={editMode.handleDragEnd}
                renderRow={(line, dragHandle) => (
                  <SalesInvoiceLineBody line={line} dragHandle={dragHandle} />
                )}
                renderOverlay={(line) => (
                  <SalesInvoiceLineBody line={line} isOverlay />
                )}
              />
            ) : (
              lines.map((line) => (
                <SalesInvoiceLineItem
                  key={line.id}
                  isDisabled={isDisabled}
                  line={line}
                  onDelete={onDeleteLine}
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
                  onClick={newSalesInvoiceLineDisclosure.onOpen}
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
              <Tooltip>
                <TooltipTrigger className="flex-1">
                  <Button
                    ref={newButtonRef}
                    className="w-full"
                    isDisabled={
                      isDisabled || !permissions.can("update", "sales")
                    }
                    leftIcon={<LuCirclePlus />}
                    variant="secondary"
                    onClick={newSalesInvoiceLineDisclosure.onOpen}
                  >
                    <Trans>Add Line Item</Trans>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <HStack>
                    <span>
                      <Trans>New Line Item</Trans>
                    </span>
                    <Kbd>{prettifyShortcut("Command+Shift+l")}</Kbd>
                  </HStack>
                </TooltipContent>
              </Tooltip>
              {canReorder && lines.length > 0 && (
                <IconButton
                  aria-label="Reorder lines"
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
      {newSalesInvoiceLineDisclosure.isOpen && (
        <SalesInvoiceLineForm
          // @ts-ignore
          initialValues={salesInvoiceLineInitialValues}
          type="modal"
          onClose={newSalesInvoiceLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteSalesInvoiceLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

function SalesInvoiceLineBody({
  line,
  dragHandle,
  isOverlay
}: {
  line: SalesInvoiceLine;
  dragHandle?: DragHandleBindings;
  isOverlay?: boolean;
}) {
  const [items] = useItems();
  return (
    <ReorderableRow dragHandle={dragHandle} isOverlay={isOverlay}>
      <HStack spacing={2} className="flex-grow min-w-0 p-2 pr-10">
        <ItemThumbnail thumbnailPath={line.thumbnailPath} type="Part" />
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold line-clamp-1">
            {getItemReadableId(items, line.itemId) ?? ""}
          </span>
          <span className="text-muted-foreground text-xs truncate line-clamp-1">
            {line.description}
          </span>
        </VStack>
      </HStack>
    </ReorderableRow>
  );
}

type SalesInvoiceLineItemProps = {
  line: SalesInvoiceLine;
  isDisabled: boolean;
  onDelete: (line: SalesInvoiceLine) => void;
};

function SalesInvoiceLineItem({
  line,
  isDisabled,
  onDelete
}: SalesInvoiceLineItemProps) {
  const { t } = useLingui();
  const [items] = useItems();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");
  const permissions = usePermissions();
  const location = useOptimisticLocation();

  const isSelected =
    location.pathname === path.to.salesInvoiceLine(invoiceId, line.id!);

  return (
    <VStack spacing={0} className="border-b">
      <Link
        to={path.to.salesInvoiceLine(invoiceId, line.id!)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
            "border-b border-border",
            isSelected && "bg-accent/60 hover:bg-accent/50"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail thumbnailPath={line.thumbnailPath} type="Part" />
            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">
                {line.invoiceLineType === "Fixed Asset"
                  ? (line as any).assetReadableId || "Fixed Asset"
                  : (getItemReadableId(items, line.itemId) ?? "")}
              </span>
              <span className="text-muted-foreground text-xs truncate line-clamp-1">
                {line.invoiceLineType === "Fixed Asset"
                  ? (line as any).assetName || line.description
                  : line.description}
              </span>
            </VStack>
          </HStack>
          <div className="absolute right-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More`}
                  className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                  icon={<LuEllipsisVertical />}
                  variant="solid"
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  destructive
                  disabled={isDisabled || !permissions.can("update", "sales")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(line);
                  }}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Line</Trans>
                </DropdownMenuItem>
                {/* @ts-expect-error */}
                {methodItemType.includes(line.invoiceLineType ?? "") && (
                  <DropdownMenuItem
                    asChild
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      to={getLinkToItemDetails(
                        line.invoiceLineType as MethodItemType,
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
      </Link>
    </VStack>
  );
}
