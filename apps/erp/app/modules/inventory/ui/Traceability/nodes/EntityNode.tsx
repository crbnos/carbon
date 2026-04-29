import { cn } from "@carbon/react";
import { Handle, type NodeProps, Position, useStore } from "@xyflow/react";
import { memo } from "react";
import { LuChevronDown, LuChevronUp, LuMinus } from "react-icons/lu";
import { NODE_RADIUS, NODE_SIZE } from "../constants";
import { entityStatusMeta } from "../metadata";
import { type EntityNodeData, entityHeadline } from "../utils";

type Props = NodeProps & {
  data: EntityNodeData & {
    selected?: boolean;
    isRoot?: boolean;
    isExpanded?: boolean;
    canExpandUp?: boolean;
    canExpandDown?: boolean;
    containmentStatus?: "Contained" | "Uncontained";
    onExpand?: (id: string, direction: "up" | "down" | "both") => void;
    onCollapse?: (id: string) => void;
  };
};

function EntityNodeImpl({ data, selected, id }: Props) {
  const entity = data.entity;
  const headline = entityHeadline(entity, 8);

  const zoomedIn = useStore((s) => s.transform[2] > 0.5);
  const showLabel = zoomedIn || data.isRoot || selected;

  const meta = entityStatusMeta(entity.status);
  const Icon = meta.icon;
  const isRejected = entity.status === "Rejected";
  const containmentStatus = data.containmentStatus;
  const radius = NODE_RADIUS;
  const size = NODE_SIZE;
  const iconSize = 18;

  return (
    <div
      className={cn("relative", data.dimmed && "opacity-15")}
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
        {!isRejected && containmentStatus && (
          <circle
            cx={radius}
            cy={radius}
            r={radius + 3}
            fill="none"
            stroke={
              containmentStatus === "Uncontained"
                ? "hsl(0 84% 60%)"
                : "hsl(38 95% 53%)"
            }
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
        <circle
          cx={radius}
          cy={radius}
          r={radius}
          fill={meta.color}
          stroke={
            selected || data.isRoot ? "hsl(var(--foreground))" : "transparent"
          }
          strokeWidth={selected || data.isRoot ? 2 : 0}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white drop-shadow-sm">
        <Icon style={{ width: iconSize, height: iconSize }} />
      </div>
      <div
        className="absolute -top-1 -right-1 rounded-full bg-card border border-border text-[9px] tabular-nums px-1 leading-tight pointer-events-none"
        title={`Quantity ${entity.quantity}`}
      >
        {formatQuantity(entity.quantity)}
      </div>
      {data.isExpanded ? (
        <NodeExpandToggle
          kind="collapse"
          onClick={() => data.onCollapse?.(id)}
        />
      ) : (
        <>
          {data.canExpandUp && (
            <NodeExpandToggle
              kind="up"
              onClick={() => data.onExpand?.(id, "up")}
            />
          )}
          {data.canExpandDown && (
            <NodeExpandToggle
              kind="down"
              onClick={() => data.onExpand?.(id, "down")}
            />
          )}
        </>
      )}
      {showLabel && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none flex flex-col items-center",
            data.isRoot || selected
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          style={{ top: size + 4 }}
        >
          <span
            className={cn(
              "text-[11px] tracking-tight px-1.5 py-px rounded bg-background",
              (data.isRoot || selected) && "font-medium"
            )}
          >
            {headline}
          </span>
        </div>
      )}
    </div>
  );
}

function formatQuantity(q: number): string {
  if (q >= 1000) return `${(q / 1000).toFixed(1)}k`;
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(1);
}

const TOGGLE_META = {
  collapse: { icon: LuMinus, title: "Collapse", anchor: "top" },
  up: { icon: LuChevronUp, title: "Expand upstream", anchor: "top" },
  down: { icon: LuChevronDown, title: "Expand downstream", anchor: "bottom" }
} as const;

function NodeExpandToggle({
  kind,
  onClick
}: {
  kind: keyof typeof TOGGLE_META;
  onClick: () => void;
}) {
  const { icon: Icon, title, anchor } = TOGGLE_META[kind];
  return (
    <button
      type="button"
      className={cn(
        "nodrag absolute left-1/2 -translate-x-1/2 w-[18px] h-[18px] rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 flex items-center justify-center ring-1 ring-background shadow-sm z-20 transition-colors",
        anchor === "top" ? "-top-2" : "-bottom-2"
      )}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon className="w-3 h-3" strokeWidth={2.5} />
    </button>
  );
}

export const EntityNode = memo(EntityNodeImpl);
