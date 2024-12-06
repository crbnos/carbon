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
import { Empty, ItemThumbnail } from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
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
    taxPercent: 0,
    inventoryUnitOfMeasureCode: "",
    purchaseUnitOfMeasureCode: "",
  };

  const newSupplierQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SupplierQuoteLine | null>(null);
  const isDisabled = routeData?.quote?.status !== "Active";

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
                  leftIcon={<LuPlusCircle />}
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
                leftIcon={<LuPlusCircle />}
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
            itemReadableId: deleteLine?.itemReadableId ?? "",
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
    <VStack spacing={0}>
      <Link
        to={path.to.supplierQuoteLine(id, line.id!)}
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
          </HStack>
        </HStack>
      </Link>
    </VStack>
  );
}
