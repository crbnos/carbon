import {
  Badge,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuBraces,
  LuChevronDown,
  LuChevronRight,
  LuChevronsUpDown,
  LuEllipsisVertical,
  LuExternalLink,
  LuSearch,
  LuTable
} from "react-icons/lu";
import {
  Link,
  useFetchers,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { generateBomIds } from "~/utils/bom";
import { path } from "~/utils/path";
import type { JobMethod } from "../../production.service";
import type { ItemOrderStatus } from "../../types";
import { JobOrderStatusBadge } from "./JobOrderStatus";

// Keyed by material id (= the tree node's methodMaterialId); built by the loader.
export type JobOrderStatusData = Record<string, ItemOrderStatus>;

const OrderStatusContext = createContext<JobOrderStatusData>({});

type JobBoMExplorerProps = {
  method: FlatTree<JobMethod>;
  orderStatus?: Promise<JobOrderStatusData>;
};

const JobBoMExplorer = ({ method, orderStatus }: JobBoMExplorerProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useLingui();
  const location = useOptimisticLocation();
  const [filterText, setFilterText] = useState("");
  // Single shared "which node's preview is open" so only one hover card shows at
  // a time (opening one row closes the others).
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const { jobId, methodId } = useParams();

  const [orderStatusData, setOrderStatusData] =
    useState<JobOrderStatusData | null>(null);

  // Streamed as a promise so the tree renders before the badges resolve.
  useEffect(() => {
    if (!orderStatus) return;
    const promise = orderStatus;
    let active = true;
    async function resolveOrderStatus() {
      try {
        const data = await promise;
        if (active) setOrderStatusData(data);
      } catch {
        // Ignore — purchased items simply render without an order badge.
      }
    }
    resolveOrderStatus();
    return () => {
      active = false;
    };
  }, [orderStatus]);

  const fetchers = useFetchers();
  const getMethodFetcher = fetchers.find(
    (f) => f.formAction === path.to.jobMethodGet
  );

  const isLoading = getMethodFetcher?.state === "loading";

  // Generate hierarchical BOM IDs (1, 1.1, 1.1.1, etc.)
  const bomIds = useMemo(() => generateBomIds(method), [method]);

  const bomIdMap = useMemo(
    () => new Map(method.map((node, index) => [node.id, bomIds[index]])),
    [method, bomIds]
  );

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleExpandNode,
    expandAllBelowDepth,
    selectNode,
    collapseAllBelowDepth,
    deselectAllNodes,
    virtualizer
  } = useTree({
    tree: method,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
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
      }
    },
    isEager: true
  });

  const allExpanded = useMemo(
    () => method.every((m) => !m.hasChildren || nodes[m.id]?.expanded),
    [method, nodes]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMaterialId = searchParams.get("materialId");
  const isDetailsRoute =
    jobId && location.pathname === path.to.jobDetails(jobId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: supress
  useEffect(() => {
    if (!selectedMaterialId) {
      if (isDetailsRoute) {
        const rootNode = method.find((m) => m.data.isRoot);
        if (rootNode) {
          selectNode(rootNode.id);
          return;
        }
      }
      deselectAllNodes();
      return;
    }

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
  }, [selectedMaterialId, methodId, location.pathname, jobId]);

  return (
    <OrderStatusContext.Provider value={orderStatusData ?? {}}>
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
                  placeholder={t`Search...`}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
              </InputGroup>
              {jobId && (
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <IconButton
                      aria-label={t`Actions`}
                      variant="ghost"
                      size="sm"
                      icon={<LuEllipsisVertical />}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        if (allExpanded) {
                          collapseAllBelowDepth(1);
                        } else {
                          expandAllBelowDepth(0);
                        }
                      }}
                    >
                      <DropdownMenuIcon icon={<LuChevronsUpDown />} />
                      {allExpanded ? (
                        <Trans>Collapse all</Trans>
                      ) : (
                        <Trans>Expand all</Trans>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
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
                  <JobBoMTreeNode
                    node={node}
                    state={state}
                    bomId={bomIdMap.get(node.id)}
                    openNodeId={openNodeId}
                    setOpenNodeId={setOpenNodeId}
                    selectNode={selectNode}
                    toggleExpandNode={toggleExpandNode}
                    collapseAllBelowDepth={collapseAllBelowDepth}
                    expandAllBelowDepth={expandAllBelowDepth}
                    navigate={navigate}
                    setSearchParams={setSearchParams}
                    location={location}
                  />
                )}
              />
            </div>
          </>
        )}
      </VStack>
    </OrderStatusContext.Provider>
  );
};

export default JobBoMExplorer;

function JobBoMTreeNode({
  node,
  state,
  bomId,
  openNodeId,
  setOpenNodeId,
  selectNode,
  toggleExpandNode,
  collapseAllBelowDepth,
  expandAllBelowDepth,
  navigate,
  setSearchParams,
  location
}: {
  node: FlatTreeItem<JobMethod>;
  state: { selected: boolean; expanded: boolean };
  bomId: string | undefined;
  openNodeId: string | null;
  setOpenNodeId: Dispatch<SetStateAction<string | null>>;
  selectNode: (id: string, scrollIntoView?: boolean) => void;
  toggleExpandNode: (id: string) => void;
  collapseAllBelowDepth: (depth: number) => void;
  expandAllBelowDepth: (depth: number) => void;
  navigate: ReturnType<typeof useNavigate>;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  location: { pathname: string };
}) {
  // Suppress the preview while the pointer is over the status badge, so its
  // own tooltip is readable without the large preview card overlapping it.
  const [isBadgeHovered, setIsBadgeHovered] = useState(false);

  return (
    <HoverCard
      open={openNodeId === node.id && !isBadgeHovered}
      onOpenChange={(nextOpen) => {
        // Opening this node becomes the single open node (closing any other);
        // closing only clears if this node is still the open one.
        setOpenNodeId((current) =>
          nextOpen ? node.id : current === node.id ? null : current
        );
      }}
      openDelay={500}
      closeDelay={150}
    >
      <HoverCardTrigger asChild>
        <div
          key={node.id}
          className={cn(
            "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1",
            state.selected
              ? "bg-muted hover:bg-accent"
              : "bg-transparent hover:bg-accent"
          )}
          onClick={() => {
            selectNode(node.id, false);
            const nodePath = getNodePath(node);

            if (location.pathname !== nodePath) {
              navigate(`${nodePath}?materialId=${node.data.methodMaterialId}`, {
                replace: true
              });
            } else {
              setSearchParams({
                materialId: node.data.methodMaterialId
              });
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

          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <div className="flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              {bomId && (
                <Badge variant="outline" className="flex-shrink-0">
                  {bomId}
                </Badge>
              )}
              <NodeText node={node} />
            </div>
            <div
              className="flex flex-shrink-0 items-center gap-1"
              onPointerEnter={() => setIsBadgeHovered(true)}
              onPointerLeave={() => setIsBadgeHovered(false)}
            >
              {node.data.isRoot ? (
                <Badge variant="outline">V{node.data.version}</Badge>
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
}

function NodeText({ node }: { node: FlatTreeItem<JobMethod> }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
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
      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      node.data.externalId?.["onshapeData"]?.["State"]
    : null;

  const orderStatusByMaterialId = useContext(OrderStatusContext);
  // Show the procurement badge for any material that has order status —
  // purchased, pulled from inventory, or a buy-and-make part. Materials with no
  // shortfall and no PO (e.g. a make-to-order part) render nothing.
  const orderStatus = node.data.methodMaterialId
    ? orderStatusByMaterialId[node.data.methodMaterialId]
    : undefined;

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
      <JobOrderStatusBadge status={orderStatus} />
    </HStack>
  );
}

function NodePreview({ node }: { node: FlatTreeItem<JobMethod> }) {
  const { t } = useLingui();
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
          <Trans>Item ID</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.itemReadableId}</span>
          <HStack spacing={1}>
            <Copy text={node.data.itemReadableId} tooltipClassName="z-[110]" />
            <Link
              to={getLinkToItemDetails(
                node.data.itemType as "Part",
                node.data.itemId
              )}
              target="_blank"
            >
              <IconButton
                aria-label={t`View Item Master`}
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
          <Trans>Description</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.description}</span>
          <Copy text={node.data.description} tooltipClassName="z-[110]" />
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Quantity</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.quantity}</span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Method</Trans>
        </span>
        <HStack className="w-full">
          <MethodIcon type={node.data.methodType} />
          <span>{node.data.methodType}</span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Item Type</Trans>
        </span>
        <HStack className="w-full">
          <MethodItemTypeIcon type={node.data.itemType} />
          <span>{node.data.itemType}</span>
        </HStack>
      </VStack>
      {node.data.methodType === "Make to Order" && (
        <VStack spacing={1}>
          <span className="text-xs text-muted-foreground font-medium">
            <Trans>Make Method Version</Trans>
          </span>
          <HStack className="w-full">
            <Badge variant="outline">V{node.data.version}</Badge>
          </HStack>
        </VStack>
      )}
      {onShapeState && (
        <VStack spacing={1}>
          <span className="text-xs text-muted-foreground font-medium">
            <Trans>Onshape Status</Trans>
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
    ? path.to.jobDetails(node.data.jobId)
    : node.data.methodType === "Make to Order"
      ? path.to.jobMakeMethod(
          node.data.jobId,
          node.data.jobMaterialMakeMethodId
        )
      : path.to.jobMakeMethod(node.data.jobId, node.data.jobMakeMethodId);
}
