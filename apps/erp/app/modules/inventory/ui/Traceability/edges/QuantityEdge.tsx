import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSimpleBezierPath,
  getSmoothStepPath
} from "@xyflow/react";
import { memo } from "react";
import {
  EDGE_BORDER_RADIUS,
  EDGE_OFFSET,
  EDGE_STYLE,
  edgeLabelPoint,
  type LineageEdgeData
} from "../utils";

type Props = EdgeProps & {
  data?: LineageEdgeData & {
    weight?: number;
    isReject?: boolean;
    isBackEdge?: boolean;
    highlighted?: boolean;
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
  // Keep this in step with EDGE_STYLE — `edgeLabelPoint` samples the matching
  // geometry, so the two switch together and labels stay on the line.
  const [edgePath, midX, midY] =
    EDGE_STYLE === "bezier"
      ? getSimpleBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition
        })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: EDGE_BORDER_RADIUS,
          offset: EDGE_OFFSET
        });

  // Parallel edges between the same two ranks all put their label at the same
  // midpoint, so the pills stack. Layout resolves how far along each path the
  // label should sit; evaluate that here against the LIVE endpoints so the
  // label rides the path when a node is dragged.
  const labelPoint =
    data?.labelT === undefined
      ? null
      : edgeLabelPoint(
          data.labelT,
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition
        );
  const labelX = labelPoint?.x ?? midX;
  const labelY = labelPoint?.y ?? midY;

  const isReject = !!data?.isReject;
  const isBackEdge = !!data?.isBackEdge;
  const isMovement = data?.kind === "movement";
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
          // Movement edges dash to read as "passed through", not "ended here".
          strokeDasharray: isBackEdge ? "8 4" : isMovement ? "4 3" : undefined,
          fill: "none"
        }}
      />
      {!dimmed && (data?.labelText || data?.quantity != null) && (
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
            className={`text-[11px] font-medium leading-none px-2 py-1 rounded-full border-2 ${
              data.labelText ? "" : "tabular-nums"
            } ${
              isReject
                ? "bg-background text-[hsl(0_72%_55%)] border-[hsl(0_72%_55%)]"
                : highlighted
                  ? "bg-foreground text-background border-foreground"
                  : isBackEdge
                    ? "bg-background text-muted-foreground/60 border-border/40"
                    : "bg-background text-foreground border-border"
            }`}
          >
            {data.labelText ?? data.quantity}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const QuantityEdge = memo(QuantityEdgeImpl);
