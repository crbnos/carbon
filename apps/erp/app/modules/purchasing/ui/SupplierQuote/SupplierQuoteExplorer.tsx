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
import { getItemReadableId, prettifyKeyboardShortcut } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuCirclePlus, LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { Supplier, SupplierQuote, SupplierQuoteLine } from "../../types";
import DeleteSupplierQuoteLine from "./DeleteSupplierQuoteLine";
import SupplierQuoteLineForm from "./SupplierQuoteLineForm";

export default function SupplierQuoteExplorer() {
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
    status: "Draft" as const,
    itemType: "Part" as const,
    description: "",
    itemId: "",
    quantity: [1],
    inventoryUnitOfMeasureCode: "",
    purchaseUnitOfMeasureCode: "",
  };

  const newSupplierQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SupplierQuoteLine | null>(null);
  const isDisabled =
    !permissions.can("delete", "purchasing") ||
    routeData?.quote?.status !== "Active";

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
    },
  });

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {routeData?.lines && routeData?.lines?.length > 0 ? (
            routeData?.lines.map((line) => (
              <SupplierQuoteLineItem
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
                  onClick={newSupplierQuoteLineDisclosure.onOpen}
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
                onClick={newSupplierQuoteLineDisclosure.onOpen}
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
            id: deleteLine.id,
          }}
          onCancel={onDeleteCancel}
        />
      )}
    </>
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
  onDelete,
}: SupplierQuoteLineItemProps) {
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  const [items] = useItems();
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
            isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail
              thumbnailPath={line.thumbnailPath}
              type="Part" // TODO
            />

            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">
                {getItemReadableId(items, line.itemId)}
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

                <DropdownMenuItem asChild onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={getLinkToItemDetails(
                      line.itemType as MethodItemType,
                      line.itemId!
                    )}
                  >
                    <DropdownMenuIcon
                      icon={<MethodItemTypeIcon type="Part" />}
                    />
                    View Item Master
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </HStack>
      </Link>
    </VStack>
  );
}
