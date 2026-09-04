import {
  cn,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { MiniMap, Panel, useReactFlow } from "@xyflow/react";
import type { ComponentProps } from "react";
import {
  LuHand,
  LuMaximize,
  LuMaximize2,
  LuMinimize2,
  LuMinus,
  LuMousePointer2,
  LuNetwork,
  LuPlus
} from "react-icons/lu";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { FIT_VIEW_OPTIONS } from "./useCanvasState";

type Props = {
  panOnScroll: boolean;
  onTogglePanOnScroll: () => void;
};

/** Icon-only, so the label the screen reader already gets is also the tooltip —
 * one string, no second copy to fall out of step. */
function ControlButton({
  "aria-label": label,
  ...props
}: ComponentProps<typeof IconButton>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton aria-label={label} variant="ghost" size="sm" {...props} />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function BuilderControls({ panOnScroll, onTogglePanOnScroll }: Props) {
  const { t } = useLingui();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Read on click, don't subscribe — `nodes` changes on every drag frame.
  const store = useBuilderStoreApi();
  const expandAll = (expanded: boolean) => {
    store.getState().setAllNodesExpanded(expanded);
  };

  const autoArrange = () => {
    store.getState().arrangeNodes();
    // Let the moved cards paint before framing them.
    requestAnimationFrame(() =>
      fitView({ ...FIT_VIEW_OPTIONS, duration: 300 })
    );
  };

  // A boolean selector only re-renders when the answer flips, so subscribing here
  // survives the per-frame `nodes` churn.
  const allExpanded = useBuilderStore((s) =>
    s.nodes.every((n) => n.expanded !== false)
  );
  const canChangeDefinition = useBuilderStore((s) => s.canChangeDefinition);
  const canMoveNodes = useBuilderStore((s) => s.canMoveNodes);

  return (
    // One Panel owns the whole bottom-right overlay. The minimap is a Panel of its
    // own by default, so `!static !m-0` drops it into this column instead.
    <Panel position="bottom-right" className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
        <ControlButton
          aria-label={t`Zoom in`}
          icon={<LuPlus />}
          onClick={() => zoomIn()}
        />
        <ControlButton
          aria-label={t`Zoom out`}
          icon={<LuMinus />}
          onClick={() => zoomOut()}
        />
        <ControlButton
          aria-label={t`Fit view`}
          icon={<LuMaximize />}
          onClick={() => fitView({ ...FIT_VIEW_OPTIONS, duration: 300 })}
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <ControlButton
          aria-label={t`Auto arrange`}
          icon={<LuNetwork />}
          isDisabled={!canMoveNodes}
          onClick={autoArrange}
        />
        <ControlButton
          aria-label={allExpanded ? t`Collapse all` : t`Expand all`}
          icon={allExpanded ? <LuMinimize2 /> : <LuMaximize2 />}
          aria-pressed={!allExpanded}
          className={cn(!allExpanded && "bg-muted")}
          // `expanded` is part of the persisted definition, so this is an edit.
          isDisabled={!canChangeDefinition}
          onClick={() => expandAll(!allExpanded)}
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <ControlButton
          aria-label={
            panOnScroll ? t`Switch to select mode` : t`Switch to pan mode`
          }
          icon={panOnScroll ? <LuHand /> : <LuMousePointer2 />}
          aria-pressed={panOnScroll}
          className={cn(panOnScroll && "bg-muted")}
          onClick={onTogglePanOnScroll}
        />
      </div>
      <MiniMap
        pannable
        zoomable
        className="!static !m-0 rounded-lg border shadow-sm"
        style={{ width: 180, height: 120 }}
      />
    </Panel>
  );
}
