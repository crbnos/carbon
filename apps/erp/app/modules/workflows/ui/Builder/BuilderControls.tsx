import { cn, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useReactFlow } from "@xyflow/react";
import {
  LuChevronsDownUp,
  LuChevronsUpDown,
  LuHand,
  LuMaximize,
  LuMinus,
  LuPlus
} from "react-icons/lu";
import { useBuilderStore } from "./context";

type Props = {
  panOnScroll: boolean;
  onTogglePanOnScroll: () => void;
};

export function BuilderControls({ panOnScroll, onTogglePanOnScroll }: Props) {
  const { t } = useLingui();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const nodes = useBuilderStore((s) => s.nodes);
  const setNodeExpanded = useBuilderStore((s) => s.setNodeExpanded);

  return (
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
        onClick={() => {
          for (const n of nodes) setNodeExpanded(n.id, false);
        }}
      />
      <IconButton
        aria-label={t`Expand all`}
        icon={<LuChevronsUpDown />}
        variant="ghost"
        size="sm"
        onClick={() => {
          for (const n of nodes) setNodeExpanded(n.id, true);
        }}
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
  );
}
