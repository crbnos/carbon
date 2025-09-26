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
  VStack,
} from "@carbon/react";
import { getItemReadableId, prettifyKeyboardShortcut } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuCirclePlus, LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import {
  useOptimisticLocation,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { Supplier } from "~/modules/purchasing/types";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../../types";
import DeletePurchaseInvoiceLine from "./DeletePurchaseInvoiceLine";
import PurchaseInvoiceLineForm from "./PurchaseInvoiceLineForm";

export default function PurchaseInvoiceExplorer() {
  const { defaults } = useUser();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");
  const purchaseInvoiceData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
    supplier: Supplier;
  }>(path.to.purchaseInvoice(invoiceId));
  const permissions = usePermissions();

  const purchaseInvoiceLineInitialValues = {
    invoiceId: invoiceId,
    invoiceLineType: "Item" as MethodItemType,
    purchaseQuantity: 1,
    locationId:
      purchaseInvoiceData?.purchaseInvoice?.locationId ??
      defaults.locationId ??
      "",
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    supplierTaxAmount: 0,
    exchangeRate: purchaseInvoiceData?.purchaseInvoice?.exchangeRate ?? 1,
  };

  const newPurchaseInvoiceLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<PurchaseInvoiceLine | null>(
    null
  );
  const isDisabled = purchaseInvoiceData?.purchaseInvoice?.status !== "Draft";

  const onDeleteLine = (line: PurchaseInvoiceLine) => {
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
          {purchaseInvoiceData?.purchaseInvoiceLines?.length ? (
            purchaseInvoiceData.purchaseInvoiceLines.map((line) => (
              <PurchaseInvoiceLineItem
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
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={newPurchaseInvoiceLineDisclosure.onOpen}
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
                onClick={newPurchaseInvoiceLineDisclosure.onOpen}
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
      {newPurchaseInvoiceLineDisclosure.isOpen && (
        <PurchaseInvoiceLineForm
          initialValues={purchaseInvoiceLineInitialValues}
          type="modal"
          onClose={newPurchaseInvoiceLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeletePurchaseInvoiceLine
          line={deleteLine!}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

type PurchaseInvoiceLineItemProps = {
  line: PurchaseInvoiceLine;
  isDisabled: boolean;
  onDelete: (line: PurchaseInvoiceLine) => void;
};

function PurchaseInvoiceLineItem({
  line,
  isDisabled,
  onDelete,
}: PurchaseInvoiceLineItemProps) {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");
  const permissions = usePermissions();
  const location = useOptimisticLocation();
  const [items] = useItems();

  const isSelected =
    location.pathname === path.to.purchaseInvoiceLine(invoiceId, line.id!);

  return (
    <VStack spacing={0} className="border-b">
      <Link
        to={path.to.purchaseInvoiceLine(invoiceId, line.id!)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
            "border-b border-border",
            isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
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
                      View Item Master
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
