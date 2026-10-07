// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NODE_DRAG_TYPE } from "./constants";
import { useBuilderStore } from "./context";
import { NODE_KIND_META, NODE_KIND_ORDER } from "./nodes/meta";

type NodePaletteProps = {
  /** Called after a step is added by tap (the phone sheet closes on it). */
  onAdd?: () => void;
};

export function NodePalette({ onAdd }: NodePaletteProps = {}) {
  const addNode = useBuilderStore((state) => state.addNode);

  return (
    <aside className="flex h-full flex-col gap-1 overflow-y-auto border-r bg-card p-2 max-md:border-r-0 max-md:bg-transparent max-md:p-0">
      {NODE_KIND_ORDER.map((type) => {
        const meta = NODE_KIND_META[type];

        return (
          <button
            type="button"
            key={type}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(NODE_DRAG_TYPE, type);
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => {
              addNode(type);
              onAdd?.();
            }}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent active:scale-[0.96] max-md:min-h-11 max-md:items-center max-md:gap-3 max-md:py-2"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <meta.Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5 max-md:pt-0">
              <div className="text-xs font-medium leading-none max-md:text-[15px] max-md:leading-tight">
                {meta.name}
              </div>
              {meta.description && (
                <div className="mt-0.5 truncate text-[10px] leading-snug text-muted-foreground max-md:text-[13px]">
                  {meta.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </aside>
  );
}
