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
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuSettings2,
  LuTrash
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import type { DragHandleBindings } from "~/components/LineReorder";
import {
  ReorderableLineList,
  ReorderableRow,
  ReorderEditBar,
  useLineOrderEditMode
} from "~/components/LineReorder";
import { usePermissions, useRouteData } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { isRfqLocked } from "../../purchasing.models";
import type { PurchasingRFQ, PurchasingRFQLine } from "../../types";
import DeletePurchasingRFQLine from "./DeletePurchasingRFQLine";
import PurchasingRFQLineForm from "./PurchasingRFQLineForm";

export default function PurchasingRFQExplorer() {
  const prettifyShortcut = usePrettifyShortcut();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const purchasingRfqData = useRouteData<{
    rfqSummary: PurchasingRFQ;
    lines: PurchasingRFQLine[];
  }>(path.to.purchasingRfq(rfqId));
  const permissions = usePermissions();

  const newPurchasingRFQLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<PurchasingRFQLine | null>(null);

  const onDeleteLine = (line: PurchasingRFQLine) => {
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

  const purchasingRfqLineInitialValues = {
    purchasingRfqId: rfqId,
    description: "",
    itemId: "",
    quantity: [1],
    order: 1,
    purchaseUnitOfMeasureCode: "EA",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 1,
    itemType: "Item" as MethodItemType
  };

  const isDisabled = isRfqLocked(purchasingRfqData?.rfqSummary.status);

  const lines = purchasingRfqData?.lines ?? [];

  const canReorder =
    !isDisabled && permissions.can("update", "purchasing") && lines.length > 1;

  const editMode = useLineOrderEditMode<PurchasingRFQLine>({
    actionPath: path.to.purchasingRfqLineOrder(rfqId),
    lines,
    getSortOrder: (line) => line.order ?? 0
  });

  return (
    <div data-purchasing-rfq-explorer>
      <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            editMode.isEditing ? (
              <ReorderableLineList<PurchasingRFQLine>
                lines={editMode.draft}
                activeLine={editMode.activeLine}
                onDragStart={editMode.handleDragStart}
                onDragEnd={editMode.handleDragEnd}
                renderRow={(line, dragHandle) => (
                  <PurchasingRFQLineBody line={line} dragHandle={dragHandle} />
                )}
                renderOverlay={(line) => (
                  <PurchasingRFQLineBody line={line} isOverlay />
                )}
              />
            ) : (
              lines.map((line) => (
                <PurchasingRFQLineItem
                  key={line.id}
                  line={line}
                  isDisabled={isDisabled}
                  onDelete={onDeleteLine}
                />
              ))
            )
          ) : (
            <Empty>
              {permissions.can("update", "purchasing") && (
                <Button
                  leftIcon={<LuCirclePlus />}
                  isDisabled={isDisabled}
                  variant="secondary"
                  onClick={newPurchasingRFQLineDisclosure.onOpen}
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
                      isDisabled || !permissions.can("update", "purchasing")
                    }
                    leftIcon={<LuCirclePlus />}
                    variant="secondary"
                    onClick={newPurchasingRFQLineDisclosure.onOpen}
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
      {newPurchasingRFQLineDisclosure.isOpen && (
        <PurchasingRFQLineForm
          initialValues={purchasingRfqLineInitialValues}
          type="modal"
          onClose={newPurchasingRFQLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeletePurchasingRFQLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </div>
  );
}

function PurchasingRFQLineBody({
  line,
  dragHandle,
  isOverlay
}: {
  line: PurchasingRFQLine;
  dragHandle?: DragHandleBindings;
  isOverlay?: boolean;
}) {
  return (
    <ReorderableRow dragHandle={dragHandle} isOverlay={isOverlay}>
      <HStack spacing={2} className="flex-grow min-w-0 p-2 pr-10">
        <ItemThumbnail
          thumbnailPath={line.thumbnailPath}
          type={line.itemType as MethodItemType}
        />
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold line-clamp-1">
            {line.itemReadableId || line.description || "Item"}
          </span>
          <span className="font-medium text-muted-foreground text-xs line-clamp-1">
            {line.description}
          </span>
        </VStack>
      </HStack>
    </ReorderableRow>
  );
}

type PurchasingRFQLineItemProps = {
  line: PurchasingRFQLine;
  isDisabled: boolean;
  onDelete: (line: PurchasingRFQLine) => void;
};

function PurchasingRFQLineItem({
  line,
  isDisabled,
  onDelete
}: PurchasingRFQLineItemProps) {
  const { t } = useLingui();
  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const permissions = usePermissions();

  const isSelected = lineId === line.id;

  return (
    <VStack spacing={0} className="border-b">
      <Link
        className="w-full"
        prefetch="intent"
        to={path.to.purchasingRfqLine(rfqId, line.id!)}
      >
        <HStack
          className={cn(
            "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
            isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail
              thumbnailPath={line.thumbnailPath}
              type={line.itemType as MethodItemType}
            />

            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">
                {line.itemReadableId || line.description || "Item"}
              </span>
              <span className="font-medium text-muted-foreground text-xs line-clamp-1">
                {line.description}
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
                  disabled={
                    isDisabled || !permissions.can("update", "purchasing")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(line);
                  }}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Line</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </HStack>
      </Link>
    </VStack>
  );
}
