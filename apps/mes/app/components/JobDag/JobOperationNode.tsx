import { BarProgress, cn } from "@carbon/react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useNavigate } from "react-router";
import { path } from "~/utils/path";

type JobOperationNodeData = {
  id: string;
  description: string;
  itemId: string | null;
  status: string;
  quantityComplete: number;
  targetQuantity: number;
  quantityReworked: number;
  quantityScrapped: number;
  isRework: boolean;
  direction: "LR" | "TB";
};

const STATUS_COLORS: Record<string, { border: string; bar: string }> = {
  Done: { border: "border-green-500", bar: "bg-green-500" },
  "In Progress": { border: "border-blue-500", bar: "bg-blue-500" },
  Ready: { border: "border-teal-500", bar: "bg-teal-500" },
  Waiting: { border: "border-gray-400", bar: "bg-gray-400" },
  Todo: { border: "border-gray-300", bar: "bg-gray-300" },
  Paused: { border: "border-amber-500", bar: "bg-amber-500" },
  Canceled: { border: "border-red-500", bar: "bg-red-500" }
};

function JobOperationNodeImpl({ data }: NodeProps) {
  const d = data as unknown as JobOperationNodeData;
  const colors = STATUS_COLORS[d.status] ?? STATUS_COLORS.Todo;
  const isHorizontal = d.direction === "LR";
  const navigate = useNavigate();

  return (
    <>
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="invisible"
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(path.to.operation(d.id))}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(path.to.operation(d.id));
        }}
        className={cn(
          "w-[200px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm cursor-pointer hover:bg-accent/50 transition-colors",
          colors.border
        )}
      >
        {d.itemId && (
          <div className="truncate text-[11px] text-muted-foreground leading-tight">
            {d.itemId}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium leading-tight">
            {d.description}
          </span>
          {d.isRework && (
            <span className="shrink-0 text-[10px] font-semibold text-red-600 bg-red-100 rounded px-1">
              Rework
            </span>
          )}
        </div>
        <BarProgress
          segments={[
            { value: d.quantityComplete, className: "bg-emerald-500" },
            { value: d.quantityReworked, className: "bg-yellow-500" },
            { value: d.quantityScrapped, className: "bg-red-500" }
          ]}
          progress={d.quantityComplete}
          max={d.targetQuantity || 1}
          value={`${d.quantityComplete}/${d.targetQuantity}`}
          className="mt-1"
        />
        {d.quantityScrapped > 0 && (
          <div className="mt-0.5 text-right text-[11px] text-red-500">
            {d.quantityScrapped} scrapped
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="invisible"
      />
    </>
  );
}

export const JobOperationNode = memo(JobOperationNodeImpl);
