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
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useKeyboardShortcuts,
  VStack,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useDroppable } from "@dnd-kit/core";
import { Link, useFetchers, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuCirclePlus, LuEllipsisVertical, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import { Empty, ItemThumbnail } from "~/components";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { salesRfqDragValidator } from "../../sales.models";
import type { SalesRFQ, SalesRFQLine } from "../../types";
import DeleteSalesRFQLine from "./DeleteSalesRFQLine";
import SalesRFQLineForm from "./SalesRFQLineForm";
import { useOptimisticDocumentDrag } from "./useOptimiticDocumentDrag";

export default function SalesRFQExplorer() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const salesRfqData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
  }>(path.to.salesRfq(rfqId));
  const permissions = usePermissions();

  useRealtime(
    "modelUpload",
    `modelPath=in.(${salesRfqData?.lines.map((d) => d.modelPath).join(",")})`
  );

  const newSalesRFQLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesRFQLine | null>(null);

  const onDeleteLine = (line: SalesRFQLine) => {
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
    },
  });

  const salesRfqLineInitialValues = {
    salesRfqId: rfqId,
    customerPartId: "",
    customerPartRevision: "",
    description: "",
    itemId: "",
    quantity: [1],
    order: 1,
    unitOfMeasureCode: "EA",
  };

  const isDisabled = ["Ready for Quote"].includes(
    salesRfqData?.rfqSummary.status ?? ""
  );

  const { setNodeRef: setExplorerRef, isOver: isOverExplorer } = useDroppable({
    id: "sales-rfq-explorer",
  });

  const linesByCustomerPartId = new Map<
    string,
    SalesRFQLine | z.infer<typeof salesRfqDragValidator>
  >(salesRfqData?.lines.map((line) => [line.customerPartId!, line]));
  const pendingItems = useOptimisticDocumentDrag();

  // merge pending items and existing items
  for (let pendingItem of pendingItems) {
    let item = linesByCustomerPartId.get(pendingItem.customerPartId!);
    let merged = item
      ? { ...item, ...pendingItem }
      : { ...pendingItem, salesRfqId: rfqId };
    linesByCustomerPartId.set(pendingItem.customerPartId!, merged);
  }

  const lines = Array.from(linesByCustomerPartId.values());

  return (
    <div
      ref={setExplorerRef}
      data-sales-rfq-explorer
      className={cn(
        "transition-colors duration-200",
        isOverExplorer && "bg-primary/10 border-2 border-dashed border-primary"
      )}
    >
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {(salesRfqData?.lines && salesRfqData?.lines?.length > 0) ||
          lines.length > 0 ? (
            lines.map((line) =>
              !isSalesRFQLine(line) ? (
                <OptimisticSalesRFQLineItem
                  key={line.id}
                  line={line as z.infer<typeof salesRfqDragValidator>}
                />
              ) : (
                <DroppableSalesRFQLineItem
                  key={line.id}
                  line={line as SalesRFQLine}
                  isDisabled={isDisabled}
                  onDelete={onDeleteLine}
                />
              )
            )
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  leftIcon={<LuCirclePlus />}
                  isDisabled={isDisabled}
                  variant="secondary"
                  onClick={newSalesRFQLineDisclosure.onOpen}
                >
                  Add Line Item
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex flex-0 sm:flex-row border-t border-border p-4 sm:justify-start sm:space-x-2">
          <Tooltip>
            <TooltipTrigger className="w-full">
              <Button
                ref={newButtonRef}
                className="w-full"
                isDisabled={isDisabled || !permissions.can("update", "sales")}
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={newSalesRFQLineDisclosure.onOpen}
              >
                Add Line Item
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>
                <span>New Line Item</span>
                <Kbd>{prettifyKeyboardShortcut("Command+Shift+l")}</Kbd>
              </HStack>
            </TooltipContent>
          </Tooltip>
        </div>
      </VStack>
      {newSalesRFQLineDisclosure.isOpen && (
        <SalesRFQLineForm
          initialValues={salesRfqLineInitialValues}
          type="modal"
          onClose={newSalesRFQLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteSalesRFQLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </div>
  );
}

function isSalesRFQLine(
  line: SalesRFQLine | z.infer<typeof salesRfqDragValidator>
) {
  return "id" in line && "order" in line && "unitOfMeasureCode" in line;
}

type DroppableSalesRFQLineItemProps = {
  line: SalesRFQLine;
  isDisabled: boolean;
  onDelete: (line: SalesRFQLine) => void;
};

function OptimisticSalesRFQLineItem({
  line,
}: {
  line: z.infer<typeof salesRfqDragValidator>;
}) {
  return (
    <VStack spacing={0} className="border-b">
      <HStack className="w-full p-2 items-center justify-between hover:bg-accent/30 cursor-pointer">
        <HStack spacing={2}>
          <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-2">
            <Spinner className="w-6 h-6 text-muted-foreground" />
          </div>

          <VStack spacing={0}>
            <span className="font-semibold line-clamp-1">
              {line.customerPartId}
            </span>
          </VStack>
        </HStack>
        <HStack spacing={0}></HStack>
      </HStack>
    </VStack>
  );
}

function DroppableSalesRFQLineItem({
  line,
  isDisabled,
  onDelete,
}: DroppableSalesRFQLineItemProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `sales-rfq-line-${line.id}`,
    data: { lineId: line.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-colors duration-200 w-full",
        isOver && "bg-primary/20 border-2 border-dashed border-primary"
      )}
    >
      <SalesRFQLineItem
        line={line}
        isDisabled={isDisabled}
        onDelete={onDelete}
      />
    </div>
  );
}

type SalesRFQLineItemProps = {
  line: SalesRFQLine;
  isDisabled: boolean;
  onDelete: (line: SalesRFQLine) => void;
};

function SalesRFQLineItem({
  line,
  isDisabled,
  onDelete,
}: SalesRFQLineItemProps) {
  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const permissions = usePermissions();

  const isSelected = lineId === line.id;

  return (
    <VStack spacing={0} className="border-b">
      <Link
        className="w-full"
        prefetch="intent"
        to={path.to.salesRfqLine(rfqId, line.id!)}
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
                {line.customerPartId}
                {line.customerPartRevision && `-${line.customerPartRevision}`}
              </span>
              <span className="font-medium text-muted-foreground text-xs line-clamp-1">
                {line.itemReadableId}
              </span>
            </VStack>
          </HStack>
          <div className="absolute right-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More"
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
                  Delete Line
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </HStack>
      </Link>
    </VStack>
  );
}

export function useOptimisticSalesRFQLineDrag() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  const { rfqId } = useParams();
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.salesRfqDrag(rfqId!);
    })
    .reduce<z.infer<typeof salesRfqDragValidator>[]>((acc, fetcher) => {
      const payload = fetcher?.formData?.get("payload");
      if (payload) {
        try {
          const parsedPayload = salesRfqDragValidator.parse(
            JSON.parse(payload as string)
          );
          return [...acc, parsedPayload];
        } catch {
          // nothing
        }
      }
      return acc;
    }, []);
}
