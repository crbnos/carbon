import {
  Badge,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuBraces,
  LuChevronDown,
  LuChevronRight,
  LuDownload,
  LuEllipsisVertical,
  LuExternalLink,
  LuSearch,
  LuTable
} from "react-icons/lu";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { OnshapeSync } from "~/components/OnshapeSync";
import type { FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { MethodItemType } from "~/modules/shared";
import { generateBomIds } from "~/utils/bom";
import { path } from "~/utils/path";
import type { MakeMethod, Method, MethodOperation } from "../../types";
import { getLinkToItemDetails } from "./ItemForm";

type BoMExplorerProps = {
  itemType: MethodItemType;
  makeMethod: MakeMethod;
  methods: FlatTreeItem<Method>[];
  methodId?: string;
  operations?: MethodOperation[];
  selectedId?: string;
  filterText?: string;
  hideSearch?: boolean;
};

const BoMExplorer = ({
  itemType,
  makeMethod,
  methods,
  methodId: methodIdProp,
  selectedId,
  filterText: filterTextProp,
  hideSearch
}: BoMExplorerProps) => {
  const [filterTextInternal, setFilterTextInternal] = useState("");
  const filterText = filterTextProp ?? filterTextInternal;
  const parentRef = useRef<HTMLDivElement>(null);
  const integrations = useIntegrations();
  const params = useParams();

  const {
    id: makeMethodId,
    version: makeMethodVersion,
    status: makeMethodStatus
  } = makeMethod;

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleExpandNode,
    expandAllBelowDepth,
    collapseAllBelowDepth,
    deselectAllNodes,
    selectNode,
    virtualizer
  } = useTree({
    tree: methods,
    selectedId,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
    onSelectedIdChanged: () => {},
    estimatedRowHeight: () => 40,
    parentRef,
    filter: {
      value: { text: filterText },
      fn: (value, node) => {
        if (value.text === "") return true;
        if (
          node.data.description.toLowerCase().includes(value.text.toLowerCase())
        ) {
          return true;
        }
        return false;
      }
    },
    isEager: true
  });

  // Generate hierarchical BOM IDs (1, 1.1, 1.1.1, etc.)
  const bomIds = useMemo(() => generateBomIds(methods), [methods]);
  const bomIdMap = useMemo(
    () => new Map(methods.map((node, index) => [node.id, bomIds[index]])),
    [methods, bomIds]
  );

  const navigate = useNavigate();
  const location = useOptimisticLocation();

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");
  const methodId = methodIdProp ?? params.methodId;
  if (!methodId) throw new Error("methodId not found");

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMaterialId = searchParams.get("materialId");
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!selectedMaterialId) {
      deselectAllNodes();
      return;
    }

    if (selectedMaterialId) {
      const node = methods.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      if (node?.id) selectNode(node?.id);
    } else if (params.methodId) {
      const node = methods.find(
        (m) => m.data.materialMakeMethodId === params.methodId
      );
      if (node?.id) selectNode(node?.id);
    }
  }, [selectedMaterialId, params.methodId]);

  const importBomDisclosure = useDisclosure();

  return (
    <>
      <VStack className="h-full">
        {!hideSearch && (
          <HStack className="w-full justify-between flex-shrink-0">
            <InputGroup size="sm" className="flex flex-grow">
              <InputLeftElement>
                <LuSearch className="h-4 w-4" />
              </InputLeftElement>
              <Input
                placeholder="Search..."
                value={filterText}
                onChange={(e) => setFilterTextInternal(e.target.value)}
              />
            </InputGroup>

            <DropdownMenu>
              <DropdownMenuTrigger>
                <IconButton
                  aria-label="Actions"
                  variant="secondary"
                  size="sm"
                  icon={<LuEllipsisVertical />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <DropdownMenuIcon icon={<LuDownload />} />
                    Export
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild>
                      <a
                        href={path.to.api.billOfMaterialsCsv(
                          makeMethodId,
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
                        href={path.to.api.billOfMaterialsCsv(
                          makeMethodId,
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
                        href={path.to.api.billOfMaterials(makeMethodId, false)}
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
                        href={path.to.api.billOfMaterials(makeMethodId, true)}
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
                {/* <DropdownMenuItem onClick={importBomDisclosure.onOpen}>
                <DropdownMenuIcon icon={<LuUpload />} />
                Import
              </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        )}
        {integrations.has("onshape") && (
          <div className="flex flex-shrink-0 w-full">
            <OnshapeSync
              makeMethodId={makeMethodId}
              itemId={itemId}
              isDisabled={makeMethodStatus !== "Draft"}
            />
          </div>
        )}
        <div className="flex flex-1 min-h-0 w-full">
          <TreeView
            parentRef={parentRef}
            virtualizer={virtualizer}
            autoFocus
            tree={methods}
            nodes={nodes}
            getNodeProps={getNodeProps}
            getTreeProps={getTreeProps}
            parentClassName="h-full"
            renderNode={({ node, state }) => {
              return (
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <div
                      key={node.id}
                      className={cn(
                        "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1 group/node",
                        state.selected
                          ? "bg-muted hover:bg-muted/90"
                          : "bg-transparent hover:bg-muted/90"
                      )}
                      onClick={() => {
                        selectNode(node.id, false);
                        const nodePath = node.data.isRoot
                          ? getRootLink(itemType, itemId, methodId)
                          : getMaterialLink(
                              itemType,
                              itemId,
                              methodId,
                              node.data.methodType === "Make"
                                ? node.data.materialMakeMethodId
                                : node.data.makeMethodId,
                              node
                            );

                        const separator = nodePath.includes("?") ? "&" : "?";
                        const fullPath = `${nodePath}${separator}materialId=${node.data.methodMaterialId}`;
                        const nodePathname = nodePath.split("?")[0];

                        if (location.pathname !== nodePathname) {
                          navigate(fullPath, { replace: true });
                        } else {
                          setSearchParams((prev) => {
                            prev.set("materialId", node.data.methodMaterialId);
                            return prev;
                          });
                        }
                      }}
                    >
                      <div className="flex h-8 items-center">
                        {Array.from({ length: node.level }).map((_, index) => (
                          <LevelLine key={index} isSelected={state.selected} />
                        ))}
                        <div
                          className={cn(
                            "flex h-8 w-4 items-center",
                            node.hasChildren && "hover:bg-accent"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.altKey) {
                              if (state.expanded) {
                                collapseAllBelowDepth(node.level);
                              } else {
                                expandAllBelowDepth(node.level);
                              }
                            } else {
                              toggleExpandNode(node.id);
                            }
                          }}
                        >
                          {node.hasChildren ? (
                            state.expanded ? (
                              <LuChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 ml-1" />
                            ) : (
                              <LuChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 ml-1" />
                            )
                          ) : (
                            <div className="h-8 w-4" />
                          )}
                        </div>
                      </div>

                      <div className="flex w-full items-center justify-between gap-2">
                        <div className="flex items-center gap-2 overflow-x-hidden">
                          {bomIdMap.get(node.id) && (
                            <Badge variant="outline">
                              {bomIdMap.get(node.id)}
                            </Badge>
                          )}
                          <NodeText node={node} />
                        </div>
                        <div className="flex items-center gap-1">
                          {node.data.isRoot ? (
                            <Badge variant="outline">
                              V{makeMethodVersion}
                            </Badge>
                          ) : (
                            <NodeData node={node} />
                          )}
                        </div>
                      </div>
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent side="right">
                    <NodePreview node={node} />
                  </HoverCardContent>
                </HoverCard>
              );
            }}
          />
        </div>
      </VStack>
      {importBomDisclosure.isOpen && (
        <ImportCSVModal
          table={"methodMaterial"}
          onClose={() => importBomDisclosure.onClose()}
        />
      )}
    </>
  );
};

export default BoMExplorer;

export function BoMActions({ makeMethodId }: { makeMethodId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <IconButton
          aria-label="Actions"
          variant="secondary"
          size="sm"
          icon={<LuEllipsisVertical />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DropdownMenuIcon icon={<LuDownload />} />
            Export
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem asChild>
              <a
                href={path.to.api.billOfMaterialsCsv(makeMethodId, false)}
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
                href={path.to.api.billOfMaterialsCsv(makeMethodId, true)}
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
                href={path.to.api.billOfMaterials(makeMethodId, false)}
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
                href={path.to.api.billOfMaterials(makeMethodId, true)}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex items-start gap-1">
      <span className="text-sm truncate font-medium">
        {node.data.description || node.data.itemReadableId}
      </span>
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<Method> }) {
  const integrations = useIntegrations();
  const onShapeState = integrations.has("onshape")
    ? // @ts-expect-error
      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      node.data.externalId?.["onshapeData"]?.["State"]
    : null;

  return (
    <HStack spacing={1}>
      <Badge className="text-xs" variant="outline">
        <MethodIcon
          type={
            // node.data.isRoot ? "Method" :
            node.data.methodType
          }
          isKit={node.data.kit}
          className="mr-2"
        />
        {node.data.quantity}
      </Badge>
      {onShapeState && <OnshapeStatus status={onShapeState} />}
    </HStack>
  );
}

function NodePreview({ node }: { node: FlatTreeItem<Method> }) {
  const integrations = useIntegrations();
  const onShapeState = integrations.has("onshape")
    ? // @ts-expect-error
      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      node.data.externalId?.["onshapeData"]?.["State"]
    : null;

  return (
    <VStack className="w-full text-sm">
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Item ID
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.itemReadableId}</span>
          <HStack spacing={1}>
            <Copy text={node.data.itemReadableId} />
            <Link
              to={getLinkToItemDetails(
                node.data.itemType as "Part",
                node.data.itemId
              )}
            >
              <IconButton
                aria-label="View Item Master"
                size="sm"
                variant="secondary"
                icon={<LuExternalLink />}
              />
            </Link>
          </HStack>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Description
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.description}</span>
          <Copy text={node.data.description} />
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Quantity
        </span>
        <HStack className="w-full justify-between">
          <span>
            {node.data.quantity} {node.data.unitOfMeasureCode}
          </span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Method
        </span>
        <HStack className="w-full">
          <MethodIcon type={node.data.methodType} />
          <span>{node.data.methodType}</span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Item Type
        </span>
        <HStack className="w-full">
          <MethodItemTypeIcon type={node.data.itemType} />
          <span>{node.data.itemType}</span>
        </HStack>
      </VStack>
      {node.data.methodType === "Make" && node.data.version && (
        <VStack spacing={1}>
          <span className="text-xs text-muted-foreground font-medium">
            Make Method Version
          </span>
          <HStack className="w-full">
            <Badge variant="outline">V{node.data.version}</Badge>
          </HStack>
        </VStack>
      )}
      {onShapeState && (
        <VStack spacing={1}>
          <span className="text-xs text-muted-foreground font-medium">
            Onshape Status
          </span>
          <HStack className="w-full">
            <OnshapeStatus status={onShapeState} />
            <span>{onShapeState}</span>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}

function getRootLink(
  itemType: MethodItemType,
  itemId: string,
  methodId: string
) {
  switch (itemType) {
    case "Part":
      return `${path.to.partDetails(itemId)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolDetails(itemId)}?methodId=${methodId}`;
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

function getMaterialLink(
  itemType: MethodItemType,
  itemId: string,
  methodId: string,
  makeMethodId: string,
  node: FlatTreeItem<Method>
) {
  switch (itemType) {
    case "Part":
      return `${path.to.partMake(itemId, makeMethodId)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolMake(itemId, makeMethodId)}?methodId=${methodId}`;
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}
