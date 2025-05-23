import {
  Badge,
  Copy,
  HStack,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  cn,
  useMount,
} from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { useNavigate, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuSearch } from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import type { FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useIntegrations } from "~/hooks/useIntegrations";
import { OnshapeSync } from "~/integrations/onshape/lib/OnshapeSync";
import { type MethodItemType } from "~/modules/shared";
import { useBom } from "~/stores";
import { path } from "~/utils/path";
import type { Method } from "../../types";

type BoMExplorerProps = {
  itemType: MethodItemType;
  makeMethodId: string;
  methods: FlatTreeItem<Method>[];
  selectedId?: string;
};

const BoMExplorer = ({
  itemType,
  makeMethodId,
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

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");

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
                    "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1",
                    state.selected
                      ? "bg-muted hover:bg-muted/90"
                      : "bg-transparent hover:bg-muted/90"
                  )}
                  onClick={() => {
                    selectNode(node.id);
                    setSelectedMaterialId(node.data.methodMaterialId);
                    if (node.data.isRoot) {
                      if (location.pathname !== getRootLink(itemType, itemId)) {
                        navigate(getRootLink(itemType, itemId));
                      }
                    } else {
                      if (
                        location.pathname !==
                        getMaterialLink(
                          itemType,
                          itemId,
                          node.data.methodType === "Make"
                            ? node.data.materialMakeMethodId
                            : node.data.makeMethodId
                        )
                      ) {
                        navigate(
                          getMaterialLink(
                            itemType,
                            itemId,
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
                          Method
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
    <div className="flex flex-col items-start gap-0">
      <span className="text-sm truncate font-medium">
        {node.data.description || node.data.itemReadableId}
      </span>
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <HStack spacing={1}>
      <Badge className="text-xs" variant="outline">
        {node.data.quantity}
      </Badge>

      <Badge variant="secondary">
        <MethodItemTypeIcon type={node.data.itemType} />
      </Badge>
    </HStack>
  );
}

function NodePreview({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <VStack className="w-full text-sm">
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Item ID
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.itemReadableId}</span>
          <Copy text={node.data.itemReadableId} />
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
    </VStack>
  );
}

function getRootLink(itemType: MethodItemType, itemId: string) {
  switch (itemType) {
    case "Part":
      return path.to.partMakeMethod(itemId);
    case "Tool":
      return path.to.toolMakeMethod(itemId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

function getMaterialLink(
  itemType: MethodItemType,
  itemId: string,
  makeMethodId: string
) {
  switch (itemType) {
    case "Part":
      return path.to.partManufacturingMaterial(itemId, makeMethodId);
    case "Tool":
      return path.to.toolManufacturingMaterial(itemId, makeMethodId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}
