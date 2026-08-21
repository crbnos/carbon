import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuLayers } from "react-icons/lu";
import {
  isBatchableOperation,
  useBatchSelection
} from "../context/BatchSelectionContext";
import type { Item, OperationItem } from "../types";

// Column-header hint: when a work center holds 2+ unstarted operations on the
// same batchable process, surface the opportunity and let one click select the
// whole group (the floating bar then offers Create/Add). Renders nothing
// outside a BatchSelectionProvider (e.g. the dates board).
export function BatchOpportunity({ items }: { items: Item[] }) {
  const { t } = useLingui();
  const selection = useBatchSelection();
  if (!selection) return null;

  const groups = new Map<string, OperationItem[]>();
  for (const item of items) {
    if (!isBatchableOperation(item)) continue;
    const group = groups.get(item.columnType);
    if (group) group.push(item);
    else groups.set(item.columnType, [item]);
  }

  const opportunities = [...groups.values()].filter(
    (group) => group.length >= 2
  );
  if (opportunities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {opportunities.map((group) => (
        <button
          key={group[0].columnType}
          type="button"
          onClick={() => selection.selectMany(group)}
          className="focus-visible:ring-2 focus-visible:ring-ring rounded-full outline-none"
        >
          <Badge
            variant="secondary"
            className="cursor-pointer gap-1 font-normal hover:bg-primary/10"
          >
            <LuLayers className="size-3" />
            {t`Batch ${group.length} × ${group[0].processName ?? group[0].description ?? ""}`}
          </Badge>
        </button>
      ))}
    </div>
  );
}
