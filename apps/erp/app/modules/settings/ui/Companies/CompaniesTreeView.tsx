import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { Company } from "../../types";
import { CompanyNode } from "./CompanyNode";
import { getLayoutedElements } from "./layout-utils";

const nodeTypes: NodeTypes = {
  subsidiary: CompanyNode
};

const fitViewOptions = {
  padding: 0.3,
  maxZoom: 1.2,
  minZoom: 0.3
};

interface CompaniesTreeViewProps {
  companies: Company[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CompaniesFlow({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
}) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  // `fitView` as a prop only fits once during init, and races the container /
  // node measurement — so the diagram lands off-center on save and on every
  // return to this tab (the tab content unmounts/remounts). `useNodesInitialized`
  // flips to true only after the nodes have real measured dimensions, and re-runs
  // whenever `nodes` changes, so re-fitting here reliably re-centers on mount,
  // on tab switch, and after adding/removing a company.
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return;
    fitView(fitViewOptions);
  }, [nodesInitialized, nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      fitView
      fitViewOptions={fitViewOptions}
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
  );
}

export function CompaniesTreeView({
  companies,
  onEdit,
  onDelete,
  onAddChild
}: CompaniesTreeViewProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = companies.map((company) => ({
      id: company.id!,
      type: "subsidiary",
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        company,
        isEliminationEntity: company.isEliminationEntity,
        onEdit,
        onDelete,
        onAddChild
      }
    }));

    const edges: Edge[] = companies
      .filter((c) => c.parentCompanyId !== null)
      .map((company) => ({
        id: `${company.parentCompanyId}-${company.id}`,
        source: company.parentCompanyId!,
        target: company.id!,
        type: "smoothstep",
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 }
      }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      "TB"
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [companies, onEdit, onDelete, onAddChild]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="h-[calc(100dvh-(var(--header-height))-61px)] w-full overflow-hidden">
      <ReactFlowProvider>
        <CompaniesFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
        />
      </ReactFlowProvider>
    </div>
  );
}
