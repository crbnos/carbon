// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import type { DepartmentTreeNode } from "../../types";
import { DepartmentNode } from "./DepartmentNode";

const nodeTypes: NodeTypes = {
  department: DepartmentNode
};

interface DepartmentsTreeViewProps {
  departments: DepartmentTreeNode[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

export function DepartmentsTreeView({
  departments,
  onEdit,
  onDelete,
  onAddChild
}: DepartmentsTreeViewProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = departments.map((department) => ({
      id: department.id!,
      type: "department",
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        department,
        onEdit,
        onDelete,
        onAddChild
      }
    }));

    const edges: Edge[] = departments
      .filter((d) => d.parentDepartmentId !== null)
      .map((department) => ({
        id: `${department.parentDepartmentId}-${department.id}`,
        source: department.parentDepartmentId!,
        target: department.id!,
        type: "smoothstep",
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 }
      }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      "TB"
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [departments, onEdit, onDelete, onAddChild]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="h-[calc(100dvh-(var(--header-height))-61px)] w-full overflow-hidden bg-card">
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
          minZoom: 0.3
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
          className="!bg-card !border-border !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
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
