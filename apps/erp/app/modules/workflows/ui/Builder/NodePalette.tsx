import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { NODE_DRAG_TYPE } from "./constants";
import { useBuilderStore } from "./context";
import { NODE_KIND_META, NODE_KIND_ORDER } from "./nodes/meta";

export function NodePalette() {
  const addNode = useBuilderStore((state) => state.addNode);
  const hasTrigger = useBuilderStore((state) =>
    state.nodes.some((node) => node.type === "trigger")
  );

  return (
    <aside className="flex h-full flex-col gap-1 overflow-y-auto border-r bg-background p-2">
      <p className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Trans>Add</Trans>
      </p>
      {NODE_KIND_ORDER.map((type) => {
        const meta = NODE_KIND_META[type];
        const disabled = type === "trigger" && hasTrigger;

        const button = (
          <button
            type="button"
            key={type}
            disabled={disabled}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData(NODE_DRAG_TYPE, type);
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => addNode(type)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              disabled
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-accent active:scale-[0.96]"
            )}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <meta.Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-xs font-medium leading-none">
                {meta.name}
              </div>
              {meta.description && (
                <div className="mt-0.5 truncate text-[10px] leading-snug text-muted-foreground">
                  {meta.description}
                </div>
              )}
            </div>
          </button>
        );

        return disabled ? (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>A workflow can only have one trigger</Trans>
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        );
      })}
    </aside>
  );
}
