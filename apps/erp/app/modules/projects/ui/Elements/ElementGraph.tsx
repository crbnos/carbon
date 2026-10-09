// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  ClientOnly,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type EdgeTypes,
  MarkerType,
  type NodeMouseHandler,
  type NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowRight,
  LuInfo,
  LuMaximize,
  LuSearch
} from "react-icons/lu";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useStore } from "zustand";
import { path } from "~/utils/path";
import type {
  ProjectElementLinkType,
  RequirementStatus
} from "../../projects.models";
import { canLink, projectElementLinkTypes } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectElementLink } from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useLinkTypeLabels } from "../Element/ElementLinks";
import { ElementTypeIcon } from "./ElementTypeIcon";
import type { ElementGraphNode } from "./graph/ElementNode";
import { ElementNode } from "./graph/ElementNode";
import type { LinkEdgeData } from "./graph/LinkEdge";
import { LinkEdge, linkDash } from "./graph/LinkEdge";
import { layoutElementGraph } from "./graph/layout";
import { getProjectGraphStore } from "./graph/store";

const nodeTypes: NodeTypes = { element: ElementNode };
const edgeTypes: EdgeTypes = { link: LinkEdge };
const proOptions = { hideAttribution: true };

type ElementGraphProps = {
  projectId: string;
  elements: ProjectElementListItem[];
  links: ProjectElementLink[];
  requirementStatus: Record<string, RequirementStatus>;
  canUpdate: boolean;
};

/**
 * The Tree layout: the element tree as a graph, read left to right, with the
 * trace links drawn over it. Drag from a handle to another element to add a
 * link.
 */
export function ElementGraph(props: ElementGraphProps) {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      }
    >
      {() => (
        <ReactFlowProvider>
          <ElementGraphCanvas {...props} />
        </ReactFlowProvider>
      )}
    </ClientOnly>
  );
}

function ElementGraphCanvas({
  projectId,
  elements,
  links,
  requirementStatus,
  canUpdate
}: ElementGraphProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { elementId: openElementId } = useParams();
  const { fitView, setCenter, getNode } = useReactFlow();
  const labels = useLinkTypeLabels();
  const store = getProjectGraphStore(projectId);
  const collapsed = useStore(store, (s) => s.collapsed);
  const direction = useStore(store, (s) => s.direction);
  const toggleCollapsed = useStore(store, (s) => s.toggleCollapsed);
  const setDirection = useStore(store, (s) => s.setDirection);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<Connection | null>(null);
  const changeRequestId = useActiveChangeRequestId();

  const byId = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements]
  );

  const { nodes, edges } = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const element of elements) {
      if (!element.parentId || !byId.has(element.parentId)) continue;
      const list = children.get(element.parentId) ?? [];
      list.push(element.id);
      children.set(element.parentId, list);
    }
    // Hide every element below a collapsed one.
    const hidden = new Set<string>();
    const stack = collapsed.flatMap((id) => children.get(id) ?? []);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (hidden.has(id)) continue;
      hidden.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    const visible = elements.filter((element) => !hidden.has(element.id));
    const parentEdges = visible
      .filter((element) => element.parentId && byId.has(element.parentId))
      .map((element) => ({
        source: element.parentId as string,
        target: element.id
      }));
    const positions = layoutElementGraph(
      visible.map((element) => element.id),
      parentEdges,
      direction
    );

    const suspect = new Set<string>();
    for (const link of links) {
      if (!link.suspectSince) continue;
      suspect.add(link.fromElementId);
      suspect.add(link.toElementId);
    }

    const nodes: ElementGraphNode[] = visible.map((element) => ({
      id: element.id,
      type: "element",
      position: positions.get(element.id) ?? { x: 0, y: 0 },
      data: {
        readableId: element.readableId,
        name: element.name,
        type: element.type,
        state: element.state,
        status:
          element.type === "Requirement"
            ? (requirementStatus[element.id] ?? null)
            : null,
        isSuspect: suspect.has(element.id),
        isOpen: element.id === openElementId,
        childCount: children.get(element.id)?.length ?? 0,
        isCollapsed: collapsed.includes(element.id),
        direction,
        onToggle: toggleCollapsed
      }
    }));

    const edges: Edge[] = [
      ...parentEdges.map((edge) => ({
        id: `parent:${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        selectable: false,
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 }
      })),
      ...links
        .filter(
          (link) =>
            !hidden.has(link.fromElementId) &&
            !hidden.has(link.toElementId) &&
            byId.has(link.fromElementId) &&
            byId.has(link.toElementId)
        )
        .map(
          (link): Edge<LinkEdgeData> => ({
            id: link.id,
            source: link.fromElementId,
            target: link.toElementId,
            type: "link",
            selectable: false,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: link.suspectSince
                ? "rgb(245 158 11)"
                : "hsl(var(--primary))"
            },
            data: {
              linkType: link.linkType,
              label: labels[link.linkType].forward,
              isSuspect: !!link.suspectSince
            }
          })
        )
    ];
    return { nodes, edges };
  }, [
    elements,
    links,
    byId,
    collapsed,
    direction,
    requirementStatus,
    openElementId,
    toggleCollapsed,
    labels
  ]);

  // Fit the view when the direction or the set of nodes changes.
  const nodeSignature = `${direction}:${nodes.length}`;
  useEffect(() => {
    if (!nodeSignature) return;
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 200 }));
  }, [nodeSignature, fitView]);

  const query = searchParams.toString();
  const openElement = useCallback(
    (id: string) =>
      navigate(
        `${path.to.projectElement(projectId, id)}${query ? `?${query}` : ""}`
      ),
    [navigate, projectId, query]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      // The collapse button toggles; it does not open the element.
      if ((event.target as HTMLElement).closest("[data-graph-toggle]")) return;
      openElement(node.id);
    },
    [openElement]
  );

  const linkTypesFor = useCallback(
    (source: string, target: string) => {
      const from = byId.get(source);
      const to = byId.get(target);
      if (!from || !to) return [];
      return projectElementLinkTypes.filter(
        (type) => canLink(from, to, type, links).ok
      );
    },
    [byId, links]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      canUpdate &&
      !!connection.source &&
      !!connection.target &&
      linkTypesFor(connection.source, connection.target).length > 0,
    [canUpdate, linkTypesFor]
  );

  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    onSuccess: () => setPending(null),
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to add the link`)
  });
  const addLink = (type: ProjectElementLinkType) => {
    if (!pending?.source || !pending.target) return;
    fetcher.submit(
      {
        intent: "upsert",
        linkType: type,
        fromElementId: pending.source,
        toElementId: pending.target
      },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementLinks(projectId),
          changeRequestId
        )
      }
    );
  };

  const pendingFrom = pending ? byId.get(pending.source)?.readableId : "";
  const pendingTo = pending ? byId.get(pending.target)?.readableId : "";
  const pendingTypes =
    pending?.source && pending.target
      ? linkTypesFor(pending.source, pending.target)
      : [];

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={proOptions}
        nodesDraggable={false}
        nodesConnectable={canUpdate}
        isValidConnection={isValidConnection}
        onConnect={(connection) => setPending(connection)}
        onNodeClick={onNodeClick}
        minZoom={0.2}
        maxZoom={1.5}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Panel position="top-left" className="flex gap-1">
          <IconButton
            aria-label={t`Fit view`}
            icon={<LuMaximize />}
            variant="secondary"
            onClick={() => fitView({ padding: 0.15, duration: 200 })}
          />
          <IconButton
            aria-label={
              direction === "LR" ? t`Show top to bottom` : t`Show left to right`
            }
            icon={direction === "LR" ? <LuArrowDown /> : <LuArrowRight />}
            variant="secondary"
            onClick={() => setDirection(direction === "LR" ? "TB" : "LR")}
          />
          <IconButton
            aria-label={t`Search`}
            icon={<LuSearch />}
            variant="secondary"
            onClick={() => setSearching(true)}
          />
          <LinkLegend labels={labels} />
        </Panel>
        {pending && (
          <Panel position="top-center">
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm shadow-md">
              <span className="text-xs text-muted-foreground">
                <Trans>
                  Link {pendingFrom} to {pendingTo}
                </Trans>
              </span>
              <div className="flex flex-wrap gap-1">
                {pendingTypes.map((type) => (
                  <Button
                    key={type}
                    variant="secondary"
                    size="sm"
                    isDisabled={fetcher.state !== "idle"}
                    onClick={() => addLink(type)}
                  >
                    {labels[type].forward}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPending(null)}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
      <CommandDialog
        open={searching}
        onOpenChange={setSearching}
        title={t`Find an element`}
      >
        <CommandInput placeholder={t`Find an element`} />
        <CommandList>
          <CommandEmpty>
            <Trans>No element found</Trans>
          </CommandEmpty>
          <CommandGroup>
            {nodes.map((node) => (
              <CommandItem
                key={node.id}
                value={`${node.data.readableId} ${node.data.name}`}
                onSelect={() => {
                  setSearching(false);
                  const found = getNode(node.id);
                  if (found) {
                    setCenter(found.position.x + 120, found.position.y + 38, {
                      zoom: 1,
                      duration: 300
                    });
                  }
                }}
              >
                <ElementTypeIcon type={node.data.type} />
                <span className="font-mono text-xs text-muted-foreground">
                  {node.data.readableId}
                </span>
                <span className="truncate">{node.data.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

/** The legend of link types and their line styles. */
function LinkLegend({
  labels
}: {
  labels: ReturnType<typeof useLinkTypeLabels>;
}) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={t`Legend`}
          icon={<LuInfo />}
          variant="secondary"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-56 flex-col gap-2 text-sm"
      >
        <span className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="28"
              y2="4"
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />
          </svg>
          <Trans>Parent</Trans>
        </span>
        {projectElementLinkTypes.map((type) => (
          <span key={type} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden>
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                strokeDasharray={linkDash(type)}
              />
            </svg>
            {labels[type].forward}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="28"
              y2="4"
              stroke="rgb(245 158 11)"
              strokeWidth="1.5"
            />
          </svg>
          <Trans>Suspect</Trans>
        </span>
      </PopoverContent>
    </Popover>
  );
}
