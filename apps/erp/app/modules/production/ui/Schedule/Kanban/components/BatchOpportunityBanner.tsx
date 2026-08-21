import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuLayers } from "react-icons/lu";
import {
  isBatchableOperation,
  useBatchSelection
} from "../context/BatchSelectionContext";
import type { Item, OperationItem } from "../types";

// Board-level batch opportunities: eligible same-process operations spread
// across DIFFERENT work-center columns. The per-column chip (BatchOpportunity in
// ColumnCard) already covers a single column, so this banner only surfaces
// groups spanning >=2 columns — the ones a planner scanning column headers would
// miss. One click selects the whole group; the floating bar then offers
// Create/Add. Renders nothing outside a BatchSelectionProvider.
export function BatchOpportunityBanner({ items }: { items: Item[] }) {
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

  const opportunities = [...groups.values()]
    .map((group) => ({
      group,
      columnCount: new Set(group.map((item) => item.columnId)).size
    }))
    .filter(({ group, columnCount }) => group.length >= 2 && columnCount >= 2);
  if (opportunities.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 shadow-lg">
        {opportunities.map(({ group, columnCount }) => (
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
              {t`Batch ${group.length} × ${
                group[0].processName ?? group[0].description ?? ""
              } across ${columnCount} work centers`}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
