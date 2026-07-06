import { PulsingDot, ScrollArea, ScrollBar } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import type {
  PickingDisplaySettings,
  PickingScheduleItem
} from "./PickingItemCard";
import { PickingItemCard } from "./PickingItemCard";

type PickingKanbanProps = {
  data: PickingScheduleItem[];
  displaySettings: PickingDisplaySettings;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
};

const UNASSIGNED = "__unassigned__";

const PickingKanban = memo(
  ({ data, displaySettings, selectedIds, onToggle }: PickingKanbanProps) => {
    // Group operations into work-center columns (cards = ops needing picking).
    const columns = useMemo(() => {
      const byWorkCenter = new Map<
        string,
        { id: string; title: string; items: PickingScheduleItem[] }
      >();

      for (const item of data) {
        const key = item.workCenterId ?? UNASSIGNED;
        if (!byWorkCenter.has(key)) {
          byWorkCenter.set(key, {
            id: key,
            title: item.workCenterName ?? "Unassigned",
            items: []
          });
        }
        byWorkCenter.get(key)!.items.push(item);
      }

      return Array.from(byWorkCenter.values()).sort((a, b) =>
        a.title.localeCompare(b.title)
      );
    }, [data]);

    if (data.length === 0) {
      return (
        <div className="flex flex-1 py-24 justify-center items-center w-full">
          <p className="text-muted-foreground">
            <Trans>No operations require picking at this location</Trans>
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ScrollArea className="flex-1">
          <div className="flex gap-0 items-start flex-row justify-start">
            {columns.map((column) => (
              <div
                key={column.id}
                className="w-[350px] max-w-full flex flex-col flex-shrink-0 bg-card/30 border-r border-border h-[calc(100dvh-var(--header-height)*2)]"
              >
                <div className="p-4 w-full font-semibold text-left flex flex-row items-center gap-2 sticky top-0 z-1 border-b border-border bg-card">
                  <PulsingDot inactive className="mt-1" />
                  <div className="flex flex-col flex-grow">
                    <span className="truncate">{column.title}</span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {column.items.length}{" "}
                      {column.items.length === 1 ? "operation" : "operations"}
                    </span>
                  </div>
                </div>

                <ScrollArea className="flex-grow">
                  <div className="flex flex-col gap-2 p-2">
                    {column.items.map((item) => (
                      <PickingItemCard
                        key={item.jobOperationId}
                        item={item}
                        isSelected={selectedIds.has(item.jobOperationId)}
                        onToggle={onToggle}
                        displaySettings={displaySettings}
                      />
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    );
  }
);

PickingKanban.displayName = "PickingKanban";
export default PickingKanban;
