import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSimpleBezierPath
} from "@xyflow/react";
import { memo } from "react";
import type { LineageEdgeData } from "../utils";

type Props = EdgeProps & {
  data?: LineageEdgeData & {
    weight?: number;
    isReject?: boolean;
    isBackEdge?: boolean;
    highlighted?: boolean;
    points?: { x: number; y: number }[];
  };
};

function QuantityEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data
}: Props) {
  const [edgePath, labelX, labelY] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const isReject = !!data?.isReject;
  const isBackEdge = !!data?.isBackEdge;
  const dimmed = !!data?.dimmed;
  const highlighted = !!data?.highlighted;
  const strokeWidth = highlighted ? 2.5 : isReject ? 1.5 : 1;
  const stroke = highlighted
    ? "hsl(0 0% 92%)"
    : isReject
      ? "hsl(0 72% 55%)"
      : "hsl(0 0% 45%)";
  const baseOpacity = highlighted
    ? 1
    : isReject
      ? 0.85
      : isBackEdge
        ? 0.2
        : 0.4;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className="trace-edge-path"
        style={{
          stroke,
          strokeWidth,
          opacity: dimmed ? 0.08 : baseOpacity,
          strokeDasharray: isBackEdge ? "8 4" : undefined,
          fill: "none"
        }}
      />
      {!dimmed && data?.quantity != null && (
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
              isReject
                ? "bg-background text-[hsl(0_72%_55%)] border-[hsl(0_72%_55%)]"
                : highlighted
                  ? "bg-foreground text-background border-foreground"
                  : isBackEdge
                    ? "bg-background text-muted-foreground/60 border-border/40"
                    : "bg-background text-foreground border-border"
            }`}
          >
            {data.quantity}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const QuantityEdge = memo(QuantityEdgeImpl);
