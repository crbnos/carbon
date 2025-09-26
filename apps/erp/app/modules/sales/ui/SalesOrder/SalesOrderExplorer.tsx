import {
  Button,
  cn,
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
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
import { Await, Link, useNavigate, useParams } from "@remix-run/react";
import { Suspense, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuCirclePlus,
  LuEllipsisVertical,
  LuSearch,
  LuTrash,
  LuTruck,
} from "react-icons/lu";
import {
  Empty,
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  MethodItemTypeIcon,
} from "~/components";
import { LevelLine } from "~/components/TreeView";
import {
  useOptimisticLocation,
  usePermissions,
  useRealtime,
  useRouteData,
  useUser,
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import type {
  Customer,
  SalesOrder,
  SalesOrderLine,
  SalesOrderRelatedItems,
} from "../../types";
import DeleteSalesOrderLine from "./DeleteSalesOrderLine";
import SalesOrderLineForm from "./SalesOrderLineForm";

// Define types for the related items
type RelatedItem = {
  id: string;
  documentReadableId: string;
  documentId?: string;
};

type RelatedItemNode = {
  key: "jobs" | "shipments";
  name: string;
  module: string;
  children: RelatedItem[];
};

function getRelatedItems(
  items: SalesOrderRelatedItems,
  lineId: string
): RelatedItemNode[] {
  return [
    {
      key: "jobs",
      name: "Jobs",
      module: "production",
      children: items.jobs
        .filter((job) => job.salesOrderLineId === lineId)
        .map((job) => ({
          id: job.id ?? "",
          documentReadableId: job.jobId ?? "",
          documentId: job.id ?? "",
        })),
    },
    {
      key: "shipments",
      name: "Shipments",
      module: "inventory",
      children: items.shipments
        .filter((shipment) =>
          shipment.shipmentLine.some(
            (line) => line.lineId === lineId && line.shippedQuantity > 0
          )
        )
        .map((shipment) => ({
          id: shipment.id ?? "",
          documentReadableId: shipment.shipmentId ?? "",
          documentId: shipment.id ?? "",
        })),
    },
  ];
}

export default function SalesOrderExplorer() {
  const { defaults } = useUser();
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const salesOrderData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
    customer: Customer;
  }>(path.to.salesOrder(orderId));
  const permissions = usePermissions();

  const salesOrderLineInitialValues = {
    salesOrderId: orderId,
    salesOrderLineType: "Part" as const,
    saleQuantity: 1,
    unitPrice: 0,
    addOnCost: 0,
    locationId:
      salesOrderData?.salesOrder?.locationId ?? defaults.locationId ?? "",
    taxPercent: salesOrderData?.customer?.taxPercent ?? 0,
    promisedDate:
      salesOrderData?.salesOrder?.receiptPromisedDate ??
      salesOrderData?.salesOrder?.receiptRequestedDate ??
      "",
    shippingCost: 0,
  };

  const newSalesOrderLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesOrderLine | null>(null);
  const isDisabled = salesOrderData?.salesOrder?.status !== "Draft";

  useRealtime(
    "modelUpload",
    `modelPath=in.(${salesOrderData?.lines.map((d) => d.modelPath).join(",")})`
  );

  const onDeleteLine = (line: SalesOrderLine) => {
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
          {salesOrderData?.lines && salesOrderData?.lines?.length > 0 ? (
            salesOrderData?.lines.map((line) => (
              <SalesOrderLineItem
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
                  onClick={newSalesOrderLineDisclosure.onOpen}
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
                onClick={newSalesOrderLineDisclosure.onOpen}
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
      {newSalesOrderLineDisclosure.isOpen && (
        <SalesOrderLineForm
          initialValues={salesOrderLineInitialValues}
          type="modal"
          onClose={newSalesOrderLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteSalesOrderLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type SalesOrderLineItemProps = {
  line: SalesOrderLine;
  isDisabled: boolean;
  onDelete: (line: SalesOrderLine) => void;
};

function SalesOrderLineItem({
  line,
  isDisabled,
  onDelete,
}: SalesOrderLineItemProps) {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const [items] = useItems();
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();
  const navigate = useNavigate();
  const searchDisclosure = useDisclosure();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const isSelected =
    location.pathname === path.to.salesOrderLine(orderId, line.id!);

  const onLineClick = () => {
    if (location.pathname !== path.to.salesOrderLine(orderId, line.id!)) {
      navigate(path.to.salesOrderLine(orderId, line.id!));
    }
  };

  return (
    <VStack spacing={0} className="border-b">
      <HStack
        className={cn(
          "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
          isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
        )}
        onClick={onLineClick}
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
          <HStack spacing={1}>
            <IconButton
              aria-label={disclosure.isOpen ? "Hide" : "Show"}
              className={cn(
                "animate opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100",
                disclosure.isOpen && "-rotate-180"
              )}
              icon={<LuChevronDown />}
              size="md"
              variant="solid"
              onClick={(e) => {
                e.stopPropagation();
                disclosure.onToggle();
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More"
                  className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                  icon={<LuEllipsisVertical />}
                  size="md"
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
                {methodItemType.includes(line?.salesOrderLineType ?? "") && (
                  <DropdownMenuItem
                    asChild
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      to={getLinkToItemDetails(
                        line.salesOrderLineType as MethodItemType,
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
                <DropdownMenuItem onClick={searchDisclosure.onOpen}>
                  <DropdownMenuIcon icon={<LuSearch />} />
                  Search
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
      </HStack>
      {disclosure.isOpen && (
        <VStack className="border-b border-border p-1">
          <RelatedItems
            lineId={line.id!}
            isSearchExpanded={searchDisclosure.isOpen}
          />
        </VStack>
      )}
    </VStack>
  );
}

function RelatedItems({
  lineId,
  isSearchExpanded,
}: {
  lineId: string;
  isSearchExpanded: boolean;
}) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrderData = useRouteData<{
    relatedItems: Promise<SalesOrderRelatedItems>;
  }>(path.to.salesOrder(orderId));

  return (
    <Suspense
      fallback={
        <div className="p-2 text-sm text-muted-foreground">
          Loading related items...
        </div>
      }
    >
      <Await resolve={salesOrderData?.relatedItems}>
        {(relatedItemsData) => {
          // Process the related items for this specific line
          // @ts-ignore
          const relatedItems = getRelatedItems(relatedItemsData, lineId);

          return (
            <SalesOrderLineRelatedItems
              relatedItems={relatedItems}
              isSearchExpanded={isSearchExpanded}
            />
          );
        }}
      </Await>
    </Suspense>
  );
}

type SalesOrderLineRelatedItemsProps = {
  relatedItems: RelatedItemNode[];
  isSearchExpanded: boolean;
};

// Component to display related items tree for a sales order line
function SalesOrderLineRelatedItems({
  relatedItems,
  isSearchExpanded,
}: SalesOrderLineRelatedItemsProps) {
  const [filterText, setFilterText] = useState("");

  return (
    <VStack className="w-full p-2">
      {isSearchExpanded && (
        <HStack className="w-full pb-2">
          <InputGroup size="sm" className="flex flex-grow">
            <InputLeftElement>
              <LuSearch className="h-4 w-4" />
            </InputLeftElement>
            <Input
              placeholder="Search related items..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </InputGroup>
        </HStack>
      )}
      <VStack spacing={0} className="w-full">
        {relatedItems.map((node) => (
          <RelatedItemTreeNode
            key={node.key}
            node={node}
            filterText={filterText}
          />
        ))}
      </VStack>
    </VStack>
  );
}

// Component to display a node in the related items tree
function RelatedItemTreeNode({
  node,
  filterText,
}: {
  node: RelatedItemNode;
  filterText: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  const filteredChildren = node.children.filter((child) =>
    child.documentReadableId.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <button
        className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-2 gap-2 text-sm hover:bg-muted/90 w-full font-medium"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="h-8 w-4 flex items-center justify-center">
          <LuChevronRight className={cn("size-4", isExpanded && "rotate-90")} />
        </div>
        <div className="flex flex-grow items-center justify-between gap-2">
          <span>{node.name}</span>
          {filteredChildren.length > 0 && (
            <Count count={filteredChildren.length} />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="flex flex-col w-full">
          {filteredChildren.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                No {node.name.toLowerCase()} found
              </div>
            </div>
          ) : (
            filteredChildren.map((child) => (
              <RelatedItemLink
                key={child.id}
                item={child}
                nodeType={node.key}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}

// Component to display a link to a related item
function RelatedItemLink({
  item,
  nodeType,
}: {
  item: RelatedItem;
  nodeType: "jobs" | "shipments";
}) {
  const getLinkForItem = (): string => {
    switch (nodeType) {
      case "jobs":
        return item.documentId ? path.to.job(item.documentId) : "#";
      case "shipments":
        return item.documentId ? path.to.shipment(item.documentId) : "#";
      default:
        return "#";
    }
  };

  const getIcon = () => {
    switch (nodeType) {
      case "jobs":
        return <MethodIcon type="Make" />;
      case "shipments":
        return <LuTruck className="text-indigo-600" />;
      default:
        return null;
    }
  };

  return (
    <Hyperlink
      to={getLinkForItem()}
      className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-muted/90 w-full font-medium whitespace-nowrap"
    >
      <LevelLine isSelected={false} className="mr-2" />
      <div className="mr-2">{getIcon()}</div>
      <span className="truncate">{item.documentReadableId}</span>
    </Hyperlink>
  );
}
