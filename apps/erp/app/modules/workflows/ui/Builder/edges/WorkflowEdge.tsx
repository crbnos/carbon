import type { EdgeProps } from "@xyflow/react";
import { BaseEdge, getSmoothStepPath } from "@xyflow/react";
import { memo } from "react";

function WorkflowEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected
}: EdgeProps) {
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
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? "hsl(var(--foreground))" : "hsl(var(--border))",
        strokeWidth: selected ? 2 : 1.5,
        fill: "none"
      }}
    />
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);

export const edgeTypes = { workflow: WorkflowEdge };
