import { Badge, HStack, VStack, cn } from "@carbon/react";
import { useRef } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import type { FlatTreeItem } from "~/components/TreeView/TreeView";
import { TreeView, useTree } from "~/components/TreeView/TreeView";
import type { Method } from "~/modules/items/types";
import { MethodIcon, MethodItemTypeIcon } from "~/modules/shared";

type QuoteBoMExplorerProps = {
  methods: FlatTreeItem<Method>[];
};

const QuoteBoMExplorer = ({ methods }: QuoteBoMExplorerProps) => {
  const parentRef = useRef<HTMLDivElement>(null);

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
    isEager: true,
  });

  return (
    <VStack className="p-2">
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
              "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2",
              state.selected
                ? "bg-muted hover:bg-muted/90"
                : "bg-transparent hover:bg-muted/90"
            )}
            onClick={() => {
              selectNode(node.id);
              alert("navigating to " + node.id);
            }}
          >
            <div className="flex h-8 items-center">
              {Array.from({ length: node.level }).map((_, index) => (
                <TaskLine key={index} isSelected={state.selected} />
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
                    <LuChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <LuChevronUp className="h-4 w-4 text-gray-400" />
                  )
                ) : (
                  <div className="h-8 w-4" />
                )}
              </div>
            </div>

            <div className="flex w-full items-center justify-between gap-2">
              <div
                className={cn(
                  "flex items-center gap-2 overflow-x-hidden",
                  node.level > 1 && "opacity-50"
                )}
              >
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
    </VStack>
  );
};

export default QuoteBoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-mono">{node.data.itemReadableId}</span>
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

function TaskLine({ isSelected }: { isSelected: boolean }) {
  return (
    <div
      className={cn(
        "h-8 w-2 border-r border-border",
        isSelected && "border-foreground/30"
      )}
    />
  );
}
