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
import { LuInfo, LuMaximize, LuSearch } from "react-icons/lu";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useStore } from "zustand";
import { path } from "~/utils/path";
import type {
  ProjectElementLinkType,
  ProjectElementType,
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
import type { ElementBoxGraphNode } from "./graph/ElementBoxNode";
import { ElementBoxNode } from "./graph/ElementBoxNode";
import type { ElementCardGraphNode } from "./graph/ElementCardNode";
import { ElementCardNode } from "./graph/ElementCardNode";
import type { LinkEdgeData } from "./graph/LinkEdge";
import { LinkEdge, linkDash } from "./graph/LinkEdge";
import { getProjectGraphStore } from "./graph/store";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  countTraceLinks,
  highlightTraceLinks,
  layoutElementTree,
  type TraceHighlight,
  type TreeBox
} from "./graph/tree-layout";

const nodeTypes: NodeTypes = { box: ElementBoxNode, card: ElementCardNode };
const edgeTypes: EdgeTypes = { link: LinkEdge };
const proOptions = { hideAttribution: true };

type ElementGraphProps = {
  projectId: string;
  projectName: string;
  /** Every element: on this layout the type filter is a lens. */
  elements: ProjectElementListItem[];
  type: ProjectElementType | null;
  links: ProjectElementLink[];
  requirementStatus: Record<string, RequirementStatus>;
  commentCounts: Record<string, number>;
  canUpdate: boolean;
};

/** The trace link a card's count lights up: tests for a Requirement, requirements for a System or Function. */
function highlightLinkType(
  type: ProjectElementType
): TraceHighlight["linkType"] | null {
  if (type === "Requirement") return "verifies";
  if (type === "System" || type === "Function") return "satisfies";
  return null;
}

/**
 * The Tree layout: one box per parent holds its children as cards, read left
 * to right, with the trace links drawn over it. Drag from a card's handle to
 * another card to add a link.
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
  projectName,
  elements,
  type,
  links,
  requirementStatus,
  commentCounts,
  canUpdate
}: ElementGraphProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { elementId: openElementId } = useParams();
  const { fitView, setCenter } = useReactFlow();
  const labels = useLinkTypeLabels();
  const store = getProjectGraphStore(projectId);
  const collapsed = useStore(store, (s) => s.collapsed);
  const toggleCollapsed = useStore(store, (s) => s.toggleCollapsed);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<Connection | null>(null);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);
  const changeRequestId = useActiveChangeRequestId();
  const rootId = searchParams.get("root");

  const byId = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements]
  );

  const setRoot = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("root", id);
      else next.delete("root");
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  const toggleHighlight = useCallback(
    (id: string) => {
      const element = byId.get(id);
      const linkType = element ? highlightLinkType(element.type) : null;
      setHighlight((current) =>
        current?.elementId === id || !linkType
          ? null
          : { elementId: id, linkType }
      );
    },
    [byId]
  );

  const { layout, boxById, nodes, cardNodes, edges } = useMemo(() => {
    const layout = layoutElementTree({
      elements,
      rootId,
      collapsed: new Set(collapsed),
      type
    });
    const counts = countTraceLinks(links);
    const lit = highlight ? highlightTraceLinks(links, highlight) : null;

    const suspect = new Set<string>();
    for (const link of links) {
      if (!link.suspectSince) continue;
      suspect.add(link.fromElementId);
      suspect.add(link.toElementId);
    }

    const boxById = new Map<string, TreeBox>(
      layout.boxes.map((box) => [box.id, box])
    );
    const visibleCards = new Set(layout.cards.map((card) => card.id));
    const topBoxId = layout.boxes[0]?.id;
    const emptyText = layout.rootId ? t`No child elements` : t`No elements yet`;

    const boxNodes: ElementBoxGraphNode[] = layout.boxes.map((box) => {
      const owner = box.ownerId ? byId.get(box.ownerId) : undefined;
      const isTop = box.id === topBoxId;
      return {
        id: box.id,
        type: "box",
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        selectable: false,
        draggable: false,
        connectable: false,
        data: {
          ownerId: box.ownerId,
          label: owner?.name ?? projectName,
          type: owner?.type ?? null,
          isTop,
          cardCount: box.cardIds.length,
          collapsedCount: box.collapsedCount,
          hiddenCount: box.hiddenCount,
          emptyText: isTop ? emptyText : null,
          onFocus: setRoot,
          onExpand: toggleCollapsed
        }
      };
    });

    const cardNodes: ElementCardGraphNode[] = layout.cards.flatMap((card) => {
      const element = byId.get(card.id);
      if (!element) return [];
      const count = counts.get(card.id);
      return [
        {
          id: card.id,
          type: "card",
          parentId: card.boxId,
          extent: "parent",
          position: { x: card.x, y: card.y },
          draggable: false,
          data: {
            readableId: element.readableId,
            name: element.name,
            type: element.type,
            state: element.state,
            ownerId: element.ownerId,
            status:
              element.type === "Requirement"
                ? (requirementStatus[element.id] ?? null)
                : null,
            commentCount: commentCounts[element.id] ?? 0,
            linkCount:
              element.type === "Requirement"
                ? { kind: "tests", count: count?.tests ?? 0 }
                : element.type === "System" || element.type === "Function"
                  ? { kind: "reqs", count: count?.reqs ?? 0 }
                  : null,
            isSuspect: suspect.has(element.id),
            isOpen: element.id === openElementId,
            isDimmed: !!lit && !lit.elementIds.has(element.id),
            isHighlighted: highlight?.elementId === element.id,
            hasChildren: card.descendantCount > 0,
            isCollapsed: card.isCollapsed,
            onToggle: toggleCollapsed,
            onHighlight: toggleHighlight
          }
        }
      ];
    });

    const edges: Edge[] = [
      ...layout.edges.map(
        (edge): Edge => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: "in",
          type: "default",
          selectable: false,
          zIndex: 1,
          style: {
            stroke: "hsl(var(--border))",
            strokeWidth: 1.5,
            opacity: lit ? 0.3 : 1
          }
        })
      ),
      ...links
        .filter(
          (link) =>
            visibleCards.has(link.fromElementId) &&
            visibleCards.has(link.toElementId)
        )
        .map(
          (link): Edge<LinkEdgeData> => ({
            id: link.id,
            source: link.fromElementId,
            sourceHandle: "link-out",
            target: link.toElementId,
            targetHandle: "link-in",
            type: "link",
            selectable: false,
            zIndex: 1,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: link.suspectSince
                ? "rgb(245 158 11)"
                : "hsl(var(--primary))"
            },
            data: {
              linkType: link.linkType,
              label: labels[link.linkType].forward,
              isSuspect: !!link.suspectSince,
              isDimmed: !!lit && !lit.linkIds.has(link.id)
            }
          })
        )
    ];

    // A parent renders before its children: boxes first, then the cards.
    const nodes = [...boxNodes, ...cardNodes];
    return { layout, boxById, nodes, cardNodes, edges };
  }, [
    elements,
    rootId,
    collapsed,
    type,
    links,
    highlight,
    byId,
    projectName,
    t,
    setRoot,
    toggleCollapsed,
    toggleHighlight,
    requirementStatus,
    commentCounts,
    openElementId,
    labels
  ]);

  // Fit the view when the root, the lens or the set of nodes changes.
  const nodeSignature = `${layout.rootId}:${type}:${nodes.length}`;
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
      // An in-node button (collapse, focus, highlight) acts; it does not open
      // the element.
      if ((event.target as HTMLElement).closest("[data-graph-action]")) return;
      if (node.type !== "card") return;
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
        onPaneClick={() => setHighlight(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setHighlight(null);
        }}
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
            {cardNodes.map((node) => (
              <CommandItem
                key={node.id}
                value={`${node.data.readableId} ${node.data.name}`}
                onSelect={() => {
                  setSearching(false);
                  const box = node.parentId
                    ? boxById.get(node.parentId)
                    : undefined;
                  if (box) {
                    setCenter(
                      box.x + node.position.x + CARD_WIDTH / 2,
                      box.y + node.position.y + CARD_HEIGHT / 2,
                      { zoom: 1, duration: 300 }
                    );
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
