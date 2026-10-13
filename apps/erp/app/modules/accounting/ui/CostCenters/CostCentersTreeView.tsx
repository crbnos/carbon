// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useViewport } from "@carbon/react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import { getLayoutedElements } from "~/modules/settings/ui/Companies/layout-utils";
import type { CostCenterTreeNode } from "../../types";
import { CostCenterNode } from "./CostCenterNode";

const nodeTypes: NodeTypes = {
  costCenter: CostCenterNode
};

interface CostCentersTreeViewProps {
  costCenters: CostCenterTreeNode[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

export function CostCentersTreeView({
  costCenters,
  onEdit,
  onDelete,
  onAddChild
}: CostCentersTreeViewProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = costCenters.map((costCenter) => ({
      id: costCenter.id!,
      type: "costCenter",
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        costCenter,
        onEdit,
        onDelete,
        onAddChild
      }
    }));

    const edges: Edge[] = costCenters
      .filter((c) => c.parentCostCenterId !== null)
      .map((costCenter) => ({
        id: `${costCenter.parentCostCenterId}-${costCenter.id}`,
        source: costCenter.parentCostCenterId!,
        target: costCenter.id!,
        type: "smoothstep",
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 }
      }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      "TB"
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [costCenters, onEdit, onDelete, onAddChild]);

  const { isPhone } = useViewport();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="h-[calc(100dvh-(var(--header-height))-61px)] w-full overflow-hidden max-md:h-[calc(100dvh-var(--topbar-height)-var(--content-inset,0px)-61px)] bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{
          padding: 0.3,
          maxZoom: 1.2,
          // Phones: never fit below a readable size; the user pans instead.
          minZoom: isPhone ? 0.75 : 0.3
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-sm max-md:!left-auto max-md:!right-0 max-md:[&>button]:!size-11 [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--border))"
        />
      </ReactFlow>
    </div>
  );
}
