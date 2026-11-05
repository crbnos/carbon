// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath
} from "@xyflow/react";
import { memo } from "react";
import type { ProjectElementLinkType } from "../../../projects.models";

export type LinkEdgeData = {
  linkType: ProjectElementLinkType;
  label: string;
  isSuspect: boolean;
  /** Another card's links are lit up: this one fades out. */
  isDimmed?: boolean;
};

/** The line style of each link type: dashed for relates to, dotted for feeds. */
export function linkDash(linkType: ProjectElementLinkType) {
  if (linkType === "relates to") return "6 4";
  if (linkType === "feeds") return "2 3";
  return undefined;
}

/**
 * A trace link on the Tree layout, labelled with its type. It is amber while
 * the link is suspect.
 */
function LinkEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data
}: EdgeProps & { data?: LinkEdgeData }) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
  const color = data?.isSuspect
    ? "rgb(245 158 11)"
    : "hsl(var(--primary) / 0.7)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 1.5,
          strokeDasharray: data ? linkDash(data.linkType) : undefined,
          opacity: data?.isDimmed ? 0.15 : 1
        }}
      />
      {data && !data.isDimmed && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded border bg-card px-1.5 py-0.5 text-[10px] font-medium",
              data.isSuspect
                ? "border-amber-500/60 text-amber-600 dark:text-amber-500"
                : "border-border text-muted-foreground"
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const LinkEdge = memo(LinkEdgeImpl);
