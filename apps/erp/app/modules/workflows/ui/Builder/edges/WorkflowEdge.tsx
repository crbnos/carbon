import type { EdgeProps } from "@xyflow/react";
import { getSmoothStepPath, useStore } from "@xyflow/react";
import { memo } from "react";

function WorkflowEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  source,
  target
}: EdgeProps) {
  const isNodeSelected = useStore((s) =>
    s.nodes.some((n) => n.selected && (n.id === source || n.id === target))
  );
  const anySelected = useStore((s) => s.nodes.some((n) => n.selected));
  const highlighted = selected || isNodeSelected;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12
  });

  return (
    <path
      id={id}
      d={edgePath}
      fill="none"
      stroke="hsl(var(--primary))"
      strokeWidth={highlighted ? 2.5 : 1.75}
      strokeLinecap="round"
      strokeDasharray="8 4"
      strokeOpacity={anySelected ? (highlighted ? 1 : 0.28) : 0.85}
      className="workflow-edge-animated"
    />
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);

export const edgeTypes = { workflow: WorkflowEdge };
