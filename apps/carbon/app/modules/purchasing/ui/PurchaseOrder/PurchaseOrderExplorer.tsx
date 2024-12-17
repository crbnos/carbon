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
  VStack,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuMoreVertical, LuPlusCircle, LuTrash } from "react-icons/lu";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import {
  useOptimisticLocation,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "../../types";
import DeletePurchaseOrderLine from "./DeletePurchaseOrderLine";
import PurchaseOrderLineForm from "./PurchaseOrderLineForm";

export default function PurchaseOrderExplorer() {
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
    purchaseOrderLineType: "Part" as const,
    purchaseQuantity: 1,
    supplierUnitPrice: 0,
    locationId:
      purchaseOrderData?.purchaseOrder?.locationId ?? defaults.locationId ?? "",
    supplierTaxAmount: 0,
    supplierShippingCost: 0,
    exchangeRate: purchaseOrderData?.purchaseOrder?.exchangeRate ?? 1,
  };

  const newPurchaseOrderLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<PurchaseOrderLine | null>(null);
  const isDisabled = purchaseOrderData?.purchaseOrder?.status !== "Draft";

  const onDeleteLine = (line: PurchaseOrderLine) => {
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

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {purchaseOrderData?.lines && purchaseOrderData?.lines?.length > 0 ? (
            purchaseOrderData?.lines.map((line) => (
              <PurchaseOrderLineItem
                key={line.id}
                isDisabled={isDisabled}
                line={line}
                onDelete={onDeleteLine}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuPlusCircle />}
                  variant="secondary"
                  onClick={newPurchaseOrderLineDisclosure.onOpen}
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
                leftIcon={<LuPlusCircle />}
                variant="secondary"
                onClick={newPurchaseOrderLineDisclosure.onOpen}
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
      {newPurchaseOrderLineDisclosure.isOpen && (
        <PurchaseOrderLineForm
          initialValues={purchaseOrderLineInitialValues}
          type="modal"
          onClose={newPurchaseOrderLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeletePurchaseOrderLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type PurchaseOrderLineItemProps = {
  line: PurchaseOrderLine;
  isDisabled: boolean;
  onDelete: (line: PurchaseOrderLine) => void;
};

function PurchaseOrderLineItem({
  line,
  isDisabled,
  onDelete,
}: PurchaseOrderLineItemProps) {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const isSelected =
    location.pathname === path.to.purchaseOrderLine(orderId, line.id!);

  return (
    <VStack spacing={0}>
      <Link
        to={path.to.purchaseOrderLine(orderId, line.id!)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "w-full p-2 items-center justify-between hover:bg-accent/30 cursor-pointer",
            !disclosure.isOpen && "border-b border-border",
            isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
          )}
        >
          <HStack spacing={2}>
            <ItemThumbnail
              thumbnailPath={line.thumbnailPath}
              type="Part" // TODO
            />

            <VStack spacing={0}>
              <span className="font-semibold line-clamp-1">
                {line.itemReadableId}
              </span>
              <span className="text-muted-foreground text-xs truncate line-clamp-1">
                {line.description}
              </span>
            </VStack>
          </HStack>
          <HStack spacing={0}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More"
                  icon={<LuMoreVertical />}
                  variant="ghost"
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
                {/* @ts-expect-error */}
                {methodItemType.includes(line?.purchaseOrderLineType ?? "") && (
                  <DropdownMenuItem asChild>
                    <Link
                      to={getLinkToItemDetails(
                        line.purchaseOrderLineType as MethodItemType,
                        line.itemId!
                      )}
                    >
                      <DropdownMenuIcon
                        icon={<MethodItemTypeIcon type={"Part"} />}
                      />
                      View Item Master
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </HStack>
      </Link>
    </VStack>
  );
}
