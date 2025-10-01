import {
  Badge,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  VStack,
  cn,
} from "@carbon/react";
import { Link, useFetchers, useNavigate, useParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import {
  LuBraces,
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuExternalLink,
  LuSearch,
  LuTable,
} from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { useBom } from "~/stores";
import { path } from "~/utils/path";
import type { JobMethod } from "../../production.service";

type JobBoMExplorerProps = {
  method: FlatTree<JobMethod>;
};

const JobBoMExplorer = ({ method }: JobBoMExplorerProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useOptimisticLocation();
  const [filterText, setFilterText] = useState("");
  const { jobId, methodId } = useParams();

  const fetchers = useFetchers();
  const getMethodFetcher = fetchers.find(
    (f) => f.formAction === path.to.jobMethodGet
  );

  const isLoading = getMethodFetcher?.state === "loading";

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleExpandNode,
    expandAllBelowDepth,
    selectNode,
    collapseAllBelowDepth,
    scrollToNode,
    virtualizer,
  } = useTree({
    tree: method,
    onSelectedIdChanged: () => {},
    estimatedRowHeight: () => 32,
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

  const [selectedMaterialId, setSelectedMaterialId] = useBom();
  useEffect(() => {
    if (selectedMaterialId) {
      const node = method.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      if (node) {
        selectNode(node.id);
      }
    } else if (methodId) {
      const node = method.find(
        (m) => m.data.jobMaterialMakeMethodId === methodId
      );
      if (node) {
        selectNode(node.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialId, methodId]);

  return (
    <VStack className="flex-1 h-full w-full">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 w-full">
          <Spinner className="w-4 h-4" />
        </div>
      ) : (
        <>
          <HStack className="w-full flex-shrink-0">
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
            {jobId && (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <IconButton
                    aria-label="Actions"
                    variant="ghost"
                    size="sm"
                    icon={<LuEllipsisVertical />}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a
                      href={path.to.api.jobBillOfMaterialsCsv(jobId, false)}
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
                      href={path.to.api.jobBillOfMaterialsCsv(jobId, true)}
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
                      href={path.to.api.jobBillOfMaterials(jobId, false)}
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
                      href={path.to.api.jobBillOfMaterials(jobId, true)}
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
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </HStack>
          <div className="flex flex-1 min-h-0 w-full">
            <TreeView
              parentRef={parentRef}
              virtualizer={virtualizer}
              autoFocus
              tree={method}
              nodes={nodes}
              getNodeProps={getNodeProps}
              getTreeProps={getTreeProps}
              renderNode={({ node, state }) => (
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
                      onClick={(e) => {
                        selectNode(node.id);
                        setSelectedMaterialId(node.data.methodMaterialId);
                        if (location.pathname !== getNodePath(node)) {
                          navigate(getNodePath(node));
                        }
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
                            type={node.data.methodType}
                            isKit={node.data.kit}
                            className="h-4 min-h-4 w-4 min-w-4 flex-shrink-0"
                          />
                          <NodeText node={node} />
                        </div>
                        <div className="flex items-center gap-1">
                          {node.data.isRoot ? (
                            <Badge variant="outline" className="text-xs">
                              V{node.data.version}
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
              )}
            />
          </div>
        </>
      )}
    </VStack>
  );
};

export default JobBoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<JobMethod> }) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-medium text-sm truncate">
        {node.data.description || node.data.itemReadableId}
      </span>
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<JobMethod> }) {
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

function NodePreview({ node }: { node: FlatTreeItem<JobMethod> }) {
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
          <span>{node.data.quantity}</span>
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
      {node.data.methodType === "Make" && (
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

function getNodePath(node: FlatTreeItem<JobMethod>) {
  return node.data.isRoot
    ? path.to.jobMethod(node.data.jobId, node.data.jobMaterialMakeMethodId)
    : node.data.methodType === "Make"
    ? path.to.jobMakeMethod(node.data.jobId, node.data.jobMaterialMakeMethodId)
    : path.to.jobMakeMethod(node.data.jobId, node.data.jobMakeMethodId);
}
