import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { Link, useNavigate, useParams } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import {
  LuBraces,
  LuChevronDown,
  LuCirclePlus,
  LuDownload,
  LuEllipsisVertical,
  LuSearch,
  LuTable,
  LuTrash,
} from "react-icons/lu";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import { QuoteLineStatusIcon } from "~/components/Icons";
import type { Tree } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import {
  useOptimisticLocation,
  usePermissions,
  useRealtime,
  useRouteData,
  useUser,
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type {
  Customer,
  Quotation,
  QuotationLine,
  QuoteMethod,
} from "../../types";
import DeleteQuoteLine from "./DeleteQuoteLine";
import QuoteBoMExplorer from "./QuoteBoMExplorer";
import QuoteLineForm from "./QuoteLineForm";

type QuoteExplorerProps = {
  methods: Tree<QuoteMethod>[];
};

export default function QuoteExplorer({ methods }: QuoteExplorerProps) {
  const { defaults } = useUser();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const quoteData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    customer: Customer;
  }>(path.to.quote(quoteId));

  const permissions = usePermissions();
  const { id: userId } = useUser();
  const quoteLineInitialValues = {
    quoteId,
    description: "",
    estimatorId: userId,
    itemId: "",
    locationId: quoteData?.quote?.locationId ?? defaults.locationId ?? "",
    methodType: "Make" as const,
    status: "Not Started" as const,
    quantity: [1],
    unitOfMeasureCode: "",
    taxPercent: quoteData?.customer?.taxPercent ?? 0,
  };

  useRealtime(
    "modelUpload",
    `modelPath=in.(${quoteData?.lines.map((d) => d.modelPath).join(",")})`
  );

  const newQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<QuotationLine | null>(null);
  const isDisabled =
    !permissions.can("delete", "sales") || quoteData?.quote?.status !== "Draft";

  const onDeleteLine = (line: QuotationLine) => {
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
          {quoteData?.lines && quoteData?.lines?.length > 0 ? (
            quoteData?.lines.map((line) => (
              <QuoteLineItem
                key={line.id}
                isDisabled={isDisabled}
                line={line}
                onDelete={onDeleteLine}
                methods={methods}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={newQuoteLineDisclosure.onOpen}
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
                onClick={newQuoteLineDisclosure.onOpen}
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
      {newQuoteLineDisclosure.isOpen && (
        <QuoteLineForm
          initialValues={quoteLineInitialValues}
          type="modal"
          onClose={newQuoteLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteQuoteLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type QuoteLineItemProps = {
  line: QuotationLine;
  isDisabled: boolean;
  onDelete: (line: QuotationLine) => void;
  methods: Tree<QuoteMethod>[];
};

function QuoteLineItem({
  line,
  isDisabled,
  onDelete,
  methods,
}: QuoteLineItemProps) {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const permissions = usePermissions();

  const navigate = useNavigate();
  const location = useOptimisticLocation();

  const disclosure = useDisclosure();
  const searchDisclosure = useDisclosure();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const methodTree = methods.find((m) => m.data.quoteLineId === line.id);
  const flattenedMethods = useMemo(
    () => (methodTree ? flattenTree(methodTree) : []),
    [methodTree]
  );

  const isSelected = lineId === line.id;
  const onLineClick = (line: QuotationLine) => {
    if (line.methodType === "Make") {
      disclosure.onOpen();
    }

    if (location.pathname !== path.to.quoteLine(quoteId, line.id!)) {
      // navigate to line
      navigate(path.to.quoteLine(quoteId, line.id!));
    }
  };

  return (
    <VStack spacing={0} className="border-b">
      <HStack
        className={cn(
          "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
          isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
        )}
        onClick={() => onLineClick(line)}
      >
        <HStack spacing={2} className="flex-grow min-w-0 pr-10">
          <ItemThumbnail
            thumbnailPath={line.thumbnailPath}
            type={line.itemType as MethodItemType}
          />

          <VStack spacing={0} className="min-w-0">
            <HStack>
              <span className="font-semibold line-clamp-1">
                {line.itemReadableId}
              </span>
              <div className="ml-auto">
                <QuoteLineStatusIcon status={line.status ?? "Not Started"} />
              </div>
            </HStack>
            <span className="font-medium text-muted-foreground text-xs line-clamp-1">
              {line.customerPartId}
              {line.customerPartRevision && `-${line.customerPartRevision}`}
            </span>
          </VStack>
        </HStack>
        <div className="absolute right-2">
          <HStack spacing={1}>
            {line.methodType === "Make" &&
              permissions.can("update", "sales") &&
              line.status !== "No Quote" && (
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
              )}
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
                <DropdownMenuItem asChild>
                  <Link
                    to={getLinkToItemDetails(
                      line.itemType as MethodItemType,
                      line.itemId!
                    )}
                  >
                    <DropdownMenuIcon
                      icon={
                        <MethodItemTypeIcon
                          type={line.itemType as MethodItemType}
                        />
                      }
                    />
                    View Item Master
                  </Link>
                </DropdownMenuItem>
                {line.methodType === "Make" && (
                  <>
                    <DropdownMenuItem onClick={searchDisclosure.onOpen}>
                      <DropdownMenuIcon icon={<LuSearch />} />
                      Search
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <DropdownMenuIcon icon={<LuDownload />} />
                        Download
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem asChild>
                          <a
                            href={path.to.api.quoteBillOfMaterialsCsv(
                              line.id!,
                              false
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <DropdownMenuIcon icon={<LuTable />} />
                            <div className="flex flex-grow items-center gap-4 justify-between">
                              <span>BoM</span>
                              <Badge variant="green" className="text-xs">
                                CSV
                              </Badge>
                            </div>
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a
                            href={path.to.api.quoteBillOfMaterialsCsv(
                              line.id!,
                              true
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <DropdownMenuIcon icon={<LuTable />} />
                            <div className="flex flex-grow items-center gap-4 justify-between">
                              <span>BoM + BoP</span>
                              <Badge variant="green" className="text-xs">
                                CSV
                              </Badge>
                            </div>
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a
                            href={path.to.api.quoteBillOfMaterials(
                              line.id!,
                              false
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <DropdownMenuIcon icon={<LuBraces />} />
                            <div className="flex flex-grow items-center gap-4 justify-between">
                              <span>BoM</span>
                              <Badge variant="outline" className="text-xs">
                                JSON
                              </Badge>
                            </div>
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a
                            href={path.to.api.quoteBillOfMaterials(
                              line.id!,
                              true
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <DropdownMenuIcon icon={<LuBraces />} />
                            <div className="flex flex-grow items-center gap-4 justify-between">
                              <span>BoM + BoP</span>
                              <Badge variant="outline" className="text-xs">
                                JSON
                              </Badge>
                            </div>
                          </a>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
                <DropdownMenuSeparator />
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
          </HStack>
        </div>
      </HStack>
      {disclosure.isOpen &&
        line.methodType === "Make" &&
        permissions.can("update", "sales") &&
        line.status !== "No Quote" && (
          <VStack className="border-b border-border p-1">
            <QuoteBoMExplorer
              methods={flattenedMethods}
              isSearchExpanded={searchDisclosure.isOpen}
            />
          </VStack>
        )}
    </VStack>
  );
}
