// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSimpleBezierPath
} from "@xyflow/react";
import { memo } from "react";
import { type EdgeRoute, routePath } from "./layout";

type JobOperationEdgeData = {
  quantity: number;
  // Set when the edge detours through the gaps between nodes.
  route?: EdgeRoute;
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
  const { t } = useLingui();
  const d = data as unknown as JobOperationEdgeData | undefined;
  // A routed edge carries its quantity beside the source, where edges that
  // share a lane have not yet merged.
  const [edgePath, labelX, labelY] = d?.route
    ? [
        routePath(
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
          d.route
        ),
        d.route.exitX,
        sourceY
      ]
    : getSimpleBezierPath({
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
            className={`text-[0.6875rem] font-medium tabular-nums leading-none px-2 py-1 rounded-full border-2 ${
              dimmed
                ? "bg-background text-muted-foreground/60 border-border/40"
                : "bg-background text-foreground border-border"
            }`}
          >
            <span className="sr-only">{t`Quantity:`} </span>
            {d.quantity}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const JobOperationEdge = memo(JobOperationEdgeImpl);
