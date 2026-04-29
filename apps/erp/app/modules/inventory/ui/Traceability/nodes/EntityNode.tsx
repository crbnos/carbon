import { cn } from "@carbon/react";
import { Handle, type NodeProps, Position, useStore } from "@xyflow/react";
import { memo } from "react";
import type { IconType } from "react-icons";
import {
  LuChevronDown,
  LuChevronUp,
  LuMinus,
  LuPackageCheck,
  LuPackageMinus,
  LuPackageOpen,
  LuPackageX,
  LuPause
} from "react-icons/lu";
import type { EntityNodeData } from "../utils";

type Props = NodeProps & {
  data: EntityNodeData & {
    selected?: boolean;
    isRoot?: boolean;
    isExpanded?: boolean;
    canExpandUp?: boolean;
    canExpandDown?: boolean;
  };
};

const STATUS_META: Record<
  string,
  { color: string; icon: IconType; label: string }
> = {
  Available: {
    color: "hsl(142 71% 45%)",
    icon: LuPackageCheck,
    label: "Available"
  },
  Reserved: {
    color: "hsl(220 9% 46%)",
    icon: LuPackageOpen,
    label: "Reserved"
  },
  "On Hold": { color: "hsl(25 95% 53%)", icon: LuPause, label: "On Hold" },
  Rejected: { color: "hsl(0 84% 60%)", icon: LuPackageX, label: "Rejected" },
  Consumed: {
    color: "hsl(217 91% 60%)",
    icon: LuPackageMinus,
    label: "Consumed"
  }
};

function EntityNodeImpl({ data, selected }: Props) {
  const entity = data.entity;
  const headline =
    entity.sourceDocumentReadableId ??
    entity.readableId ??
    entity.id.slice(0, 8);

  const zoom = useStore((s) => s.transform[2]);
  const showLabel = zoom > 0.5 || data.isRoot || selected;

  const meta = STATUS_META[entity.status ?? ""] ?? STATUS_META.Consumed;
  const Icon = meta.icon;
  const isRejected = entity.status === "Rejected";
  const radius = 22;
  const size = radius * 2;
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
      {data.isExpanded && (
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center pointer-events-none shadow-sm"
          title="Click to collapse"
        >
          <LuMinus className="w-2.5 h-2.5" />
        </div>
      )}
      {!data.isExpanded && data.canExpandUp && (
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border border-border text-muted-foreground flex items-center justify-center pointer-events-none shadow-sm"
          title="More upstream available"
        >
          <LuChevronUp className="w-2.5 h-2.5" />
        </div>
      )}
      {!data.isExpanded && data.canExpandDown && (
        <div
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border border-border text-muted-foreground flex items-center justify-center pointer-events-none shadow-sm"
          title="More downstream available"
        >
          <LuChevronDown className="w-2.5 h-2.5" />
        </div>
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

export const EntityNode = memo(EntityNodeImpl);
