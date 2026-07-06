import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSimpleBezierPath
} from "@xyflow/react";
import { memo } from "react";

type JobOperationEdgeData = {
  quantity: number;
};

function JobOperationEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data
}: EdgeProps) {
  const d = data as unknown as JobOperationEdgeData | undefined;
  const [edgePath, labelX, labelY] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const dimmed = d?.quantity === 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: "hsl(0 0% 55%)",
          strokeWidth: 1.2,
          opacity: 0.5,
          fill: "none"
        }}
      />
      {d?.quantity != null && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              minWidth: 22,
              textAlign: "center",
              zIndex: 1000
            }}
            className={`text-[11px] font-medium tabular-nums leading-none px-2 py-1 rounded-full border-2 ${
              dimmed
                ? "bg-background text-muted-foreground/60 border-border/40"
                : "bg-background text-foreground border-border"
            }`}
          >
            {d.quantity}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const JobOperationEdge = memo(JobOperationEdgeImpl);
