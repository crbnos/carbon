import {
  Badge,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  VStack,
  cn,
} from "@carbon/react";
import { useFetchers, useNavigate } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuSearch } from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { path } from "~/utils/path";
import type { QuoteMethod } from "../../types";

type QuoteBoMExplorerProps = {
  methods: FlatTree<QuoteMethod>;
};

const QuoteBoMExplorer = ({ methods }: QuoteBoMExplorerProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useOptimisticLocation();

  const fetchers = useFetchers();
  const getMethodFetcher = fetchers.find(
    (f) => f.formAction === path.to.quoteMethodGet
  );

  const [filterText, setFilterText] = useState("");

  const isLoading =
    getMethodFetcher?.state === "loading" &&
    getMethodFetcher.formData?.get("quoteLineId") ===
      methods?.[0].data.quoteLineId;

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
    // selectedId,
    // collapsedIds,
    onSelectedIdChanged: () => {},
    estimatedRowHeight: () => 32,
    parentRef,
    filter: {
      value: { text: filterText },
      fn: (value, node) => {
        if (value.text === "") return true;
        if (
          node.data.itemReadableId
            .toLowerCase()
            .includes(value.text.toLowerCase())
        ) {
          return true;
        }
        return false;
      },
    },
    isEager: true,
  });

  return (
    <VStack>
      {isLoading ? (
        <div className="flex items-center justify-center py-8 w-full">
          <Spinner className="w-4 h-4" />
        </div>
      ) : (
        <>
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
          <TreeView
            parentRef={parentRef}
            virtualizer={virtualizer}
            autoFocus
            tree={methods}
            nodes={nodes}
            getNodeProps={getNodeProps}
            getTreeProps={getTreeProps}
            renderNode={({ node, state }) => (
              <div
                key={node.id}
                className={cn(
                  "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1",
                  getNodePath(node) === location.pathname
                    ? "bg-muted hover:bg-muted/90"
                    : "bg-transparent hover:bg-muted/90"
                )}
                onClick={(e) => {
                  selectNode(node.id);
                  navigate(getNodePath(node), { replace: true });
                }}
              >
                <div className="flex h-8 items-center">
                  {Array.from({ length: node.level }).map((_, index) => (
                    <LevelLine
                      key={index}
                      isSelected={getNodePath(node) === location.pathname}
                    />
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
                        <LuChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0 ml-1" />
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
            )}
          />
        </>
      )}
    </VStack>
  );
};

export default QuoteBoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<QuoteMethod> }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-medium truncate">
        {node.data.itemReadableId}
      </span>
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<QuoteMethod> }) {
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

function getNodePath(node: FlatTreeItem<QuoteMethod>) {
  return node.data.isRoot
    ? path.to.quoteLineMethod(
        node.data.quoteId,
        node.data.quoteLineId,
        node.data.quoteMaterialMakeMethodId
      )
    : node.data.methodType === "Make"
    ? path.to.quoteLineMakeMethod(
        node.data.quoteId,
        node.data.quoteLineId,
        node.data.quoteMaterialMakeMethodId,
        node.data.methodMaterialId
      )
    : path.to.quoteLineMethodMaterial(
        node.data.quoteId,
        node.data.quoteLineId,
        node.data.methodType.toLowerCase(),
        node.data.quoteMakeMethodId,
        node.data.methodMaterialId
      );
}
