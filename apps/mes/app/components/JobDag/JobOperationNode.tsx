// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, BarProgress, cn } from "@carbon/react";
import { round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { Link, useLocation } from "react-router";
import { withOrigin } from "~/utils/origin";
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
  // Readable id of the live batch the operation runs in, or null.
  batchReadableId?: string | null;
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
  const location = useLocation();
  const { t } = useLingui();

  // One readable name for the link instead of its run-together text.
  const name = d.itemId ? `${d.itemId} — ${d.description}` : d.description;
  const percent = d.targetQuantity
    ? round((d.quantityComplete / d.targetQuantity) * 100, 0)
    : 0;
  const label = [
    t`${name}, ${d.status}, ${percent}% complete`,
    d.isRework ? t`Rework` : null,
    d.batchReadableId ? t`Batch ${d.batchReadableId}` : null,
    d.quantityScrapped > 0 ? t`${d.quantityScrapped} scrapped` : null
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="invisible"
      />
      <Link
        to={withOrigin(path.to.operation(d.id), location)}
        // A native link drag would fight the canvas pan.
        draggable={false}
        aria-label={label}
        className={cn(
          "block w-[200px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm cursor-pointer hover:bg-accent/50 transition-colors",
          colors.border
        )}
      >
        {d.itemId && (
          <div className="truncate text-[0.6875rem] text-muted-foreground leading-tight">
            {d.itemId}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium leading-tight">
            {d.description}
          </span>
          {/* The status is otherwise only the border colour. */}
          <span className="sr-only">{d.status}</span>
          {d.isRework && (
            <span className="shrink-0 text-[0.625rem] font-semibold text-red-600 bg-red-100 rounded px-1">
              <Trans>Rework</Trans>
            </span>
          )}
          {d.batchReadableId && (
            <Badge variant="blue" className="shrink-0 px-1 text-[0.625rem]">
              {d.batchReadableId}
            </Badge>
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
          <div className="mt-0.5 text-right text-[0.6875rem] text-red-500">
            <Trans>{d.quantityScrapped} scrapped</Trans>
          </div>
        )}
      </Link>
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="invisible"
      />
    </>
  );
}

export const JobOperationNode = memo(JobOperationNodeImpl);
