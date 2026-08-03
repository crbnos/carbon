import { cn, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { MiniMap, Panel, useReactFlow } from "@xyflow/react";
import {
  LuChevronsDownUp,
  LuChevronsUpDown,
  LuHand,
  LuMaximize,
  LuMinus,
  LuPlus
} from "react-icons/lu";
import { useBuilderStoreApi } from "./context";

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
          aria-label={t`Collapse all`}
          icon={<LuChevronsDownUp />}
          variant="ghost"
          size="sm"
          onClick={() => expandAll(false)}
        />
        <IconButton
          aria-label={t`Expand all`}
          icon={<LuChevronsUpDown />}
          variant="ghost"
          size="sm"
          onClick={() => expandAll(true)}
        />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          aria-label={t`Toggle pan mode`}
          icon={<LuHand />}
          variant="ghost"
          size="sm"
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
