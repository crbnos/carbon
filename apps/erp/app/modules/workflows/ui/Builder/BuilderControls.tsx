import { cn, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { MiniMap, Panel, useReactFlow } from "@xyflow/react";
import {
  LuHand,
  LuMaximize,
  LuMaximize2,
  LuMinimize2,
  LuMinus,
  LuMousePointer2,
  LuPlus
} from "react-icons/lu";
import { useBuilderStore, useBuilderStoreApi } from "./context";

type Props = {
  panOnScroll: boolean;
  onTogglePanOnScroll: () => void;
};

export function BuilderControls({ panOnScroll, onTogglePanOnScroll }: Props) {
  const { t } = useLingui();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Read on click, don't subscribe — `nodes` changes on every drag frame.
  const store = useBuilderStoreApi();
  const expandAll = (expanded: boolean) => {
    const { nodes, setNodeExpanded } = store.getState();
    for (const n of nodes) setNodeExpanded(n.id, expanded);
  };

  // A boolean selector only re-renders when the answer flips, so subscribing here
  // survives the per-frame `nodes` churn.
  const allExpanded = useBuilderStore((s) =>
    s.nodes.every((n) => n.expanded !== false)
  );

  return (
    // One Panel owns the whole bottom-right overlay. The minimap is a Panel of its
    // own by default, so `!static !m-0` drops it into this column instead.
    <Panel position="bottom-right" className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
        <IconButton
          aria-label={t`Zoom in`}
          icon={<LuPlus />}
          variant="ghost"
          size="sm"
          onClick={() => zoomIn()}
        />
        <IconButton
          aria-label={t`Zoom out`}
          icon={<LuMinus />}
          variant="ghost"
          size="sm"
          onClick={() => zoomOut()}
        />
        <IconButton
          aria-label={t`Fit view`}
          icon={<LuMaximize />}
          variant="ghost"
          size="sm"
          onClick={() => fitView({ duration: 300 })}
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          aria-label={allExpanded ? t`Collapse all` : t`Expand all`}
          icon={allExpanded ? <LuMinimize2 /> : <LuMaximize2 />}
          variant="ghost"
          size="sm"
          aria-pressed={!allExpanded}
          className={cn(!allExpanded && "bg-muted")}
          onClick={() => expandAll(!allExpanded)}
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          aria-label={
            panOnScroll ? t`Switch to select mode` : t`Switch to pan mode`
          }
          icon={panOnScroll ? <LuHand /> : <LuMousePointer2 />}
          variant="ghost"
          size="sm"
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
