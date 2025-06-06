import {
  Badge,
  Copy,
  HStack,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  cn,
  useMount,
} from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { Link, useNavigate, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuExternalLink,
  LuSearch,
} from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import type { FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useIntegrations } from "~/hooks/useIntegrations";
import { OnshapeSync } from "~/integrations/onshape/lib/OnshapeSync";
import { type MethodItemType } from "~/modules/shared";
import { useBom } from "~/stores";
import { path } from "~/utils/path";
import type { Method } from "../../types";
import { getLinkToItemDetails } from "./ItemForm";

type BoMExplorerProps = {
  itemType: MethodItemType;
  makeMethodId: string;
  makeMethodVersion: string;
  methods: FlatTreeItem<Method>[];
  selectedId?: string;
};

const BoMExplorer = ({
  itemType,
  makeMethodId,
  makeMethodVersion,
  methods,
  selectedId,
}: BoMExplorerProps) => {
  const [filterText, setFilterText] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const integrations = useIntegrations();
  const params = useParams();
  const {
    nodes,
    getTreeProps,
    getNodeProps,
    // toggleNodeSelection,
    toggleExpandNode,
    expandAllBelowDepth,
    // toggleExpandLevel,
    collapseAllBelowDepth,
    selectNode,
    scrollToNode,
    virtualizer,
  } = useTree({
    tree: methods,
    selectedId,
    // collapsedIds,
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
      },
    },
    isEager: true,
  });

  const navigate = useNavigate();
  const location = useOptimisticLocation();

  const { itemId, methodId } = params;
  if (!itemId) throw new Error("itemId not found");
  if (!methodId) throw new Error("methodId not found");

  const [selectedMaterialId, setSelectedMaterialId] = useBom();
  useMount(() => {
    if (selectedMaterialId) {
      const node = methods.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      selectNode(node?.id ?? methods[0].id);
    } else if (params.makeMethodId) {
      const node = methods.find(
        (m) => m.data.materialMakeMethodId === params.makeMethodId
      );
      selectNode(node?.id ?? methods[0].id);
    } else if (methods?.length > 0) {
      selectNode(methods[0].id);
    }
  });

  return (
    <VStack>
      <HStack className="w-full">
        <InputGroup size="sm" className="flex flex-grow">
          <InputLeftElement>
            <LuSearch className="h-4 w-4" />
          </InputLeftElement>
          <Input
            placeholder="Search..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </InputGroup>
      </HStack>
      {integrations.has("onshape") && (
        <OnshapeSync makeMethodId={makeMethodId} itemId={itemId} />
      )}
      <TreeView
        parentRef={parentRef}
        virtualizer={virtualizer}
        autoFocus
        tree={methods}
        nodes={nodes}
        getNodeProps={getNodeProps}
        getTreeProps={getTreeProps}
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
                    selectNode(node.id);
                    setSelectedMaterialId(node.data.methodMaterialId);
                    if (node.data.isRoot) {
                      if (
                        location.pathname !==
                        getRootLink(itemType, itemId, methodId)
                      ) {
                        navigate(getRootLink(itemType, itemId, methodId));
                      }
                    } else {
                      if (
                        location.pathname !==
                        getMaterialLink(
                          itemType,
                          itemId,
                          methodId,
                          node.data.methodType === "Make"
                            ? node.data.materialMakeMethodId
                            : node.data.makeMethodId
                        )
                      ) {
                        navigate(
                          getMaterialLink(
                            itemType,
                            itemId,
                            methodId,
                            node.data.methodType === "Make"
                              ? node.data.materialMakeMethodId
                              : node.data.makeMethodId
                          )
                        );
                      }
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
                        scrollToNode(node.id);
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
                      <MethodIcon
                        type={
                          // node.data.isRoot ? "Method" :
                          node.data.methodType
                        }
                        isKit={node.data.kit}
                        className="h-4 min-h-4 w-4 min-w-4 flex-shrink-0"
                      />
                      <NodeText node={node} />
                    </div>
                    <div className="flex items-center gap-1">
                      {node.data.isRoot ? (
                        <Badge variant="outline" className="text-xs">
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
    </VStack>
  );
};

export default BoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex items-start gap-1">
      <span className="text-sm truncate font-medium">
        {node.data.description || node.data.itemReadableId}
      </span>
      {node.data.revision && node.data.revision !== "0" && (
        <Badge variant="outline" className="text-xs opacity-0">
          {node.data.revision}
        </Badge>
      )}
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<Method> }) {
  const integrations = useIntegrations();
  const onShapeState = integrations.has("onshape")
    ? // @ts-expect-error
      node.data.externalId?.["onshapeData"]?.["State"]
    : null;

  return (
    <HStack spacing={1}>
      <Badge className="text-xs" variant="outline">
        {node.data.quantity}
      </Badge>

      {onShapeState ? (
        <OnshapeStatus status={onShapeState} />
      ) : (
        <Badge variant="secondary">
          <MethodItemTypeIcon type={node.data.itemType} />
        </Badge>
      )}
    </HStack>
  );
}

function NodePreview({ node }: { node: FlatTreeItem<Method> }) {
  const integrations = useIntegrations();
  const onShapeState = integrations.has("onshape")
    ? // @ts-expect-error
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
      return path.to.partMakeMethod(itemId, methodId);
    case "Tool":
      return path.to.toolMakeMethod(itemId, methodId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

function getMaterialLink(
  itemType: MethodItemType,
  itemId: string,
  methodId: string,
  makeMethodId: string
) {
  switch (itemType) {
    case "Part":
      return path.to.partManufacturingMaterial(itemId, methodId, makeMethodId);
    case "Tool":
      return path.to.toolManufacturingMaterial(itemId, methodId, makeMethodId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}
