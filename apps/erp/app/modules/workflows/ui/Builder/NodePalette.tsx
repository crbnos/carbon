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
    <aside className="flex w-[118px] shrink-0 flex-col gap-1 border-r bg-background p-2">
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
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              disabled
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-accent active:scale-[0.96]"
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: meta.accent }}
            />
            {meta.name}
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
