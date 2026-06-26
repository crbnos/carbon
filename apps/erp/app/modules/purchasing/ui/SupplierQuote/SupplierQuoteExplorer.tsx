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
  useMount,
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
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isSupplierQuoteLocked } from "../../purchasing.models";
import type { Supplier, SupplierQuote, SupplierQuoteLine } from "../../types";
import DeleteSupplierQuoteLine from "./DeleteSupplierQuoteLine";
import SupplierQuoteLineForm from "./SupplierQuoteLineForm";

export default function SupplierQuoteExplorer() {
  const prettifyShortcut = usePrettifyShortcut();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const routeData = useRouteData<{
    quote: SupplierQuote;
    lines: SupplierQuoteLine[];
    supplier: Supplier;
  }>(path.to.supplierQuote(id));
  const permissions = usePermissions();

  const supplierQuoteLineInitialValues = {
    supplierQuoteId: id,
    supplierQuoteLineType: "Part" as const,
    status: "Draft" as const,
    itemType: "Part" as const,
    description: "",
    itemId: "",
    quantity: [1],
    inventoryUnitOfMeasureCode: "",
    purchaseUnitOfMeasureCode: ""
  };

  const newSupplierQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SupplierQuoteLine | null>(null);
  const isLocked = isSupplierQuoteLocked(routeData?.quote?.status);
  const isDisabled = !permissions.can("delete", "purchasing") || isLocked;

  const onDeleteLine = (line: SupplierQuoteLine) => {
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

  const lines = routeData?.lines ?? [];
  const canReorder =
    !isDisabled && permissions.can("update", "purchasing") && lines.length > 1;

  const editMode = useLineOrderEditMode<SupplierQuoteLine>({
    actionPath: path.to.supplierQuoteLineOrder(id),
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
              <ReorderableLineList<SupplierQuoteLine>
                lines={editMode.draft}
                activeLine={editMode.activeLine}
                onDragStart={editMode.handleDragStart}
                onDragEnd={editMode.handleDragEnd}
                renderRow={(line, dragHandle) => (
                  <SupplierQuoteLineBody line={line} dragHandle={dragHandle} />
                )}
                renderOverlay={(line) => (
                  <SupplierQuoteLineBody line={line} isOverlay />
                )}
              />
            ) : (
              lines.map((line) => (
                <SupplierQuoteLineItem
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
                  onClick={newSupplierQuoteLineDisclosure.onOpen}
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
                    onClick={newSupplierQuoteLineDisclosure.onOpen}
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
      {newSupplierQuoteLineDisclosure.isOpen && (
        <SupplierQuoteLineForm
          initialValues={supplierQuoteLineInitialValues}
          type="modal"
          onClose={newSupplierQuoteLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && deleteLine?.id && (
        <DeleteSupplierQuoteLine
          line={{
            itemId: deleteLine?.itemId ?? "",
            id: deleteLine.id
          }}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

function SupplierQuoteLineBody({
  line,
  dragHandle,
  isOverlay
}: {
  line: SupplierQuoteLine;
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
            {line.supplierQuoteLineType === "G/L Account"
              ? line.description || "Indirect Expense"
              : getItemReadableId(items, line.itemId)}
          </span>
          <span className="text-muted-foreground text-xs truncate line-clamp-1">
            {line.supplierQuoteLineType === "G/L Account"
              ? "G/L Account"
              : line.description}
          </span>
        </VStack>
      </HStack>
    </ReorderableRow>
  );
}

type SupplierQuoteLineItemProps = {
  line: SupplierQuoteLine;
  isDisabled: boolean;
  onDelete: (line: SupplierQuoteLine) => void;
};

function SupplierQuoteLineItem({
  line,
  isDisabled,
  onDelete
}: SupplierQuoteLineItemProps) {
  const { t } = useLingui();
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  const [items] = useItems();
  const itemType = items.find((i) => i.id === line.itemId)?.type;
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const isSelected =
    location.pathname === path.to.supplierQuoteLine(id, line.id!);

  return (
    <VStack spacing={0} className="border-b">
      <Link
        to={path.to.supplierQuoteLine(id, line.id!)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
            isSelected && "bg-accent/60 hover:bg-accent/50"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail
              thumbnailPath={line.thumbnailPath}
              type="Part" // TODO
            />

            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">
                {line.supplierQuoteLineType === "G/L Account"
                  ? line.description || "Indirect Expense"
                  : getItemReadableId(items, line.itemId)}
              </span>
              <span className="text-muted-foreground text-xs truncate line-clamp-1">
                {line.supplierQuoteLineType === "G/L Account"
                  ? "G/L Account"
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

                {itemType &&
                  methodItemType.includes(itemType as MethodItemType) && (
                    <DropdownMenuItem
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to={getLinkToItemDetails(
                          itemType as MethodItemType,
                          line.itemId!
                        )}
                      >
                        <DropdownMenuIcon
                          icon={
                            <MethodItemTypeIcon
                              type={itemType as MethodItemType}
                            />
                          }
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
