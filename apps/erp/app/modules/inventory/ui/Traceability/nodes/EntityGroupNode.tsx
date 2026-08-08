import { cn } from "@carbon/react";
import { Handle, type NodeProps, Position, useStore } from "@xyflow/react";
import { memo } from "react";
import { NODE_RADIUS, NODE_SIZE } from "../constants";
import { entityStatusMeta } from "../metadata";
import type { EntityGroupNodeData } from "../utils";

type Props = NodeProps & {
  data: EntityGroupNodeData & {
    selected?: boolean;
  };
};

/**
 * A fan of identical serial siblings drawn as one node. Same 44px footprint as
 * EntityNode so the worker's dagre layout needs no special case; the stacked
 * circles behind it are what say "this is many".
 *
 * No expand toggles: expanding a 50-member group would fetch 50 lineages.
 * Members are reached through the sidebar's list instead.
 */
function EntityGroupNodeImpl({
  data,
  selected,
  sourcePosition,
  targetPosition
}: Props) {
  const cluster = data.cluster;
  const count = cluster.members.length;

  const zoomedIn = useStore((s) => s.transform[2] > 0.5);
  const showLabel = zoomedIn || selected;

  const meta = entityStatusMeta(cluster.status);
  const Icon = meta.icon;
  const isRejected = cluster.status === "Rejected";
  const radius = NODE_RADIUS;
  const size = NODE_SIZE;
  const iconSize = 18;

  const range = cluster.readableIdRange;
  const rangeLabel =
    range && range[0] !== range[1] ? `${range[0]}…${range[1]}` : range?.[0];

  return (
    <div
      className={cn("relative", data.dimmed && "opacity-15")}
      style={{ width: size, height: size, zIndex: 10 }}
    >
      <Handle
        type="target"
        position={targetPosition ?? Position.Top}
        className="!opacity-0 !pointer-events-none !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-1 !h-1 !min-w-0 !min-h-0 !border-0"
      />
      <Handle
        type="source"
        position={sourcePosition ?? Position.Bottom}
        className="!opacity-0 !pointer-events-none !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-1 !h-1 !min-w-0 !min-h-0 !border-0"
      />
      <svg
        width={size}
        height={size}
        className="absolute inset-0 overflow-visible"
        aria-hidden
      >
        {selected && (
          <circle
            cx={radius}
            cy={radius}
            r={radius + 6}
            fill={meta.color}
            opacity={0.2}
          />
        )}
        {isRejected && (
          <circle
            cx={radius}
            cy={radius}
            r={radius + 3}
            fill="none"
            stroke="hsl(0 84% 60%)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
        {/* Stack effect: two offset copies peeking out behind the face. */}
        <circle
          cx={radius + 6}
          cy={radius - 6}
          r={radius}
          fill={meta.color}
          opacity={0.3}
          stroke="hsl(var(--background))"
          strokeWidth={1.5}
        />
        <circle
          cx={radius + 3}
          cy={radius - 3}
          r={radius}
          fill={meta.color}
          opacity={0.55}
          stroke="hsl(var(--background))"
          strokeWidth={1.5}
        />
        <circle
          cx={radius}
          cy={radius}
          r={radius}
          fill={meta.color}
          stroke={selected ? "hsl(var(--foreground))" : "transparent"}
          strokeWidth={selected ? 2 : 0}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white drop-shadow-sm">
        <Icon style={{ width: iconSize, height: iconSize }} />
      </div>
      <div
        className="absolute -bottom-1 -right-1 rounded-full bg-card border border-border text-[9px] tabular-nums px-1 leading-tight pointer-events-none font-medium"
        title={`${count} identical ${cluster.status.toLowerCase()} serials`}
      >
        ×{count}
      </div>
      {showLabel && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none flex flex-col items-center",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
          style={{ top: size + 4 }}
        >
          <span
            className={cn(
              "text-[11px] tracking-tight px-1.5 py-px rounded bg-background",
              selected && "font-medium"
            )}
          >
            {cluster.headline}
          </span>
          {rangeLabel && (
            <span className="text-[10px] tracking-tight px-1.5 rounded bg-background text-muted-foreground tabular-nums">
              {rangeLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const EntityGroupNode = memo(EntityGroupNodeImpl);
