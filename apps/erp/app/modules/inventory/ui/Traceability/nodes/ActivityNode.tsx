import { cn } from "@carbon/react";
import { Handle, type NodeProps, Position, useStore } from "@xyflow/react";
import { memo } from "react";
import { ACTIVITY_KIND_META, activityKindFor } from "../activityIcons";
import type { ActivityNodeData } from "../utils";

type Props = NodeProps & {
  data: ActivityNodeData & {
    selected?: boolean;
    isRoot?: boolean;
  };
};

function ActivityNodeImpl({ data, selected }: Props) {
  const activity = data.activity;
  const kind = activityKindFor(activity.type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  const label = activity.type ?? meta.label;

  const zoom = useStore((s) => s.transform[2]);
  const showLabel = zoom > 0.5 || data.isRoot || selected;

  const half = 22;
  const size = half * 2;
  const iconSize = 18;

  return (
    <div
      className={cn("relative transition-opacity", data.dimmed && "opacity-15")}
      style={{ width: size, height: size, zIndex: 10 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!opacity-0 !pointer-events-none !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-1 !h-1 !min-w-0 !min-h-0 !border-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0 !pointer-events-none !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-1 !h-1 !min-w-0 !min-h-0 !border-0"
      />
      <svg
        width={size}
        height={size}
        className="absolute inset-0 overflow-visible"
        aria-hidden
      >
        {(selected || data.isRoot) && (
          <rect
            x={-7}
            y={-7}
            width={size + 14}
            height={size + 14}
            rx={8}
            fill={meta.color}
            opacity={0.2}
            transform={`rotate(45 ${half} ${half})`}
          />
        )}
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={5}
          fill={meta.color}
          stroke={
            selected || data.isRoot ? "hsl(var(--foreground))" : "transparent"
          }
          strokeWidth={selected || data.isRoot ? 2 : 0}
          transform={`rotate(45 ${half} ${half})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white drop-shadow-sm">
        <Icon style={{ width: iconSize, height: iconSize }} />
      </div>
      {showLabel && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none",
            data.isRoot || selected
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          style={{ top: size + 8 }}
        >
          <span
            className={cn(
              "text-[11px] tracking-tight",
              (data.isRoot || selected) && "font-medium"
            )}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

export const ActivityNode = memo(ActivityNodeImpl);
