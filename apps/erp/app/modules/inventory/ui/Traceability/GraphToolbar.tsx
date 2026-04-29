import {
  cn,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { useReactFlow } from "@xyflow/react";
import {
  LuFocus,
  LuMaximize,
  LuMinus,
  LuMove,
  LuMoveDown,
  LuMoveRight,
  LuNetwork,
  LuPlus,
  LuSearch,
  LuTable
} from "react-icons/lu";
import type { LayoutDirection } from "./worker/core";

export type ViewMode = "graph" | "table";

type Props = {
  depth: number;
  onDepthChange: (next: number) => void;
  direction: LayoutDirection;
  onDirectionChange: (next: LayoutDirection) => void;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  isolate: boolean;
  onIsolateChange: (next: boolean) => void;
  hasSelection?: boolean;
  onRelayout?: () => void;
  onOpenSearch?: () => void;
  spacing?: number;
  onSpacingChange?: (next: number) => void;
};

const PANEL =
  "rounded-lg border border-border bg-card/95 backdrop-blur shadow-sm";

export function GraphToolbar({
  depth,
  onDepthChange,
  direction,
  onDirectionChange,
  view,
  onViewChange,
  isolate,
  onIsolateChange,
  hasSelection = false,
  onRelayout,
  onOpenSearch,
  spacing = 2,
  onSpacingChange
}: Props) {
  return (
    <>
      <ViewModeChip view={view} onViewChange={onViewChange} />
      <GraphControlsChip
        depth={depth}
        onDepthChange={onDepthChange}
        direction={direction}
        onDirectionChange={onDirectionChange}
        isolate={isolate}
        onIsolateChange={onIsolateChange}
        hasSelection={hasSelection}
        onRelayout={onRelayout}
        onOpenSearch={onOpenSearch}
        spacing={spacing}
        onSpacingChange={onSpacingChange}
        showGraphOnly={view === "graph"}
      />
    </>
  );
}

function ViewModeChip({
  view,
  onViewChange
}: {
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
}) {
  return (
    <HStack spacing={0} className={cn("absolute top-3 left-3 z-30 p-1", PANEL)}>
      <SegmentButton
        active={view === "graph"}
        onClick={() => onViewChange("graph")}
        ariaLabel="Graph view"
      >
        <LuNetwork className="w-3.5 h-3.5" />
        <span>Graph</span>
      </SegmentButton>
      <SegmentButton
        active={view === "table"}
        onClick={() => onViewChange("table")}
        ariaLabel="Table view"
      >
        <LuTable className="w-3.5 h-3.5" />
        <span>Table</span>
      </SegmentButton>
    </HStack>
  );
}

function GraphControlsChip({
  depth,
  onDepthChange,
  direction,
  onDirectionChange,
  isolate,
  onIsolateChange,
  hasSelection,
  onRelayout,
  onOpenSearch,
  spacing,
  onSpacingChange,
  showGraphOnly
}: {
  depth: number;
  onDepthChange: (next: number) => void;
  direction: LayoutDirection;
  onDirectionChange: (next: LayoutDirection) => void;
  isolate: boolean;
  onIsolateChange: (next: boolean) => void;
  hasSelection: boolean;
  onRelayout?: () => void;
  onOpenSearch?: () => void;
  spacing: number;
  onSpacingChange?: (next: number) => void;
  showGraphOnly: boolean;
}) {
  const { fitView } = useReactFlow();

  return (
    <HStack
      spacing={1}
      className={cn("absolute top-3 right-3 z-30 px-1.5 py-1", PANEL)}
    >
      {onOpenSearch && (
        <>
          <HoverCard openDelay={150} closeDelay={50}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={onOpenSearch}
                className={cn(
                  "h-7 px-2 rounded-md flex items-center gap-1 transition-colors text-xs",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
                aria-label="Search nodes"
              >
                <LuSearch className="w-3.5 h-3.5" />
                <kbd className="text-[10px] text-muted-foreground bg-muted/50 px-1 rounded">
                  /
                </kbd>
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={8}
              className="!w-auto !p-2 text-xs"
            >
              Search nodes
            </HoverCardContent>
          </HoverCard>
          <div className="w-px h-5 bg-border mx-1" />
        </>
      )}
      <HoverCard openDelay={150} closeDelay={50}>
        <HoverCardTrigger asChild>
          <HStack spacing={0} className="rounded-md bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => depth > 1 && onDepthChange(depth - 1)}
              aria-disabled={depth <= 1}
              aria-label="Decrease hops"
              className={cn(
                "h-6 w-6 rounded flex items-center justify-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                depth <= 1
                  ? "opacity-40 cursor-not-allowed text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-background"
              )}
            >
              <LuMinus className="w-3 h-3" />
            </button>
            <div className="px-2 min-w-[64px] text-center text-xs tabular-nums select-none">
              <span className="font-medium text-foreground">{depth}</span>
              <span className="text-muted-foreground ml-1">
                {depth === 1 ? "hop" : "hops"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => depth < 5 && onDepthChange(depth + 1)}
              aria-disabled={depth >= 5}
              aria-label="Increase hops"
              className={cn(
                "h-6 w-6 rounded flex items-center justify-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                depth >= 5
                  ? "opacity-40 cursor-not-allowed text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-background"
              )}
            >
              <LuPlus className="w-3 h-3" />
            </button>
          </HStack>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          sideOffset={8}
          className="!w-auto !p-2 text-xs"
        >
          Max connections fetched per direction (1–5)
        </HoverCardContent>
      </HoverCard>

      {showGraphOnly && (
        <>
          <div className="w-px h-5 bg-border mx-1" />

          <HStack spacing={0} className="rounded-md bg-muted/40 p-0.5">
            <HoverCard openDelay={150} closeDelay={50}>
              <HoverCardTrigger asChild>
                <button
                  onClick={() => onDirectionChange("TB")}
                  className={cn(
                    "h-6 w-6 rounded flex items-center justify-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    direction === "TB"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={direction === "TB"}
                  aria-label="Top-down layout"
                >
                  <LuMoveDown className="w-3.5 h-3.5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="top" sideOffset={8}>
                Top-down
              </HoverCardContent>
            </HoverCard>
            <HoverCard openDelay={150} closeDelay={50}>
              <HoverCardTrigger asChild>
                <button
                  onClick={() => onDirectionChange("LR")}
                  className={cn(
                    "h-6 w-6 rounded flex items-center justify-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    direction === "LR"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={direction === "LR"}
                  aria-label="Left-right layout"
                >
                  <LuMoveRight className="w-3.5 h-3.5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="top" sideOffset={8}>
                Left-right
              </HoverCardContent>
            </HoverCard>
          </HStack>

          <div className="w-px h-5 bg-border mx-1" />

          <HoverCard openDelay={150} closeDelay={50}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  if (!hasSelection) return;
                  onIsolateChange(!isolate);
                }}
                aria-disabled={!hasSelection}
                className={cn(
                  "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !hasSelection && "opacity-40 cursor-not-allowed",
                  hasSelection &&
                    !isolate &&
                    "text-muted-foreground hover:text-foreground hover:bg-accent/60",
                  hasSelection &&
                    isolate &&
                    "bg-foreground/10 text-foreground ring-1 ring-foreground/20"
                )}
                aria-pressed={isolate}
                aria-label="Isolate lineage"
              >
                <LuFocus className="w-3.5 h-3.5" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={8}
              className="!w-auto !p-2 text-xs"
            >
              {hasSelection ? "Isolate lineage" : "Select a node first"}
            </HoverCardContent>
          </HoverCard>

          <HoverCard openDelay={150} closeDelay={50}>
            <HoverCardTrigger asChild>
              <button
                onClick={() => fitView({ duration: 300, padding: 0.2 })}
                className={cn(
                  "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
                aria-label="Fit to view"
              >
                <LuMaximize className="w-3.5 h-3.5" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={8}
              className="!w-auto !p-2 text-xs"
            >
              Fit to view
            </HoverCardContent>
          </HoverCard>

          <HoverCard openDelay={150} closeDelay={50}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={() => onRelayout?.()}
                className={cn(
                  "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
                aria-label="Re-layout graph"
              >
                <LuMove className="w-3.5 h-3.5" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={8}
              className="!w-auto !p-2 text-xs"
            >
              Re-layout graph
            </HoverCardContent>
          </HoverCard>

          <div className="w-px h-5 bg-border mx-1" />

          <SpacingSlider value={spacing} onChange={onSpacingChange} />
        </>
      )}
    </HStack>
  );
}

function SpacingSlider({
  value,
  onChange
}: {
  value: number;
  onChange?: (next: number) => void;
}) {
  return (
    <Popover>
      <HoverCard openDelay={150} closeDelay={50}>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Layout spacing"
              className={cn(
                "h-7 px-2 rounded-md flex items-center gap-1 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <span className="text-[10px] uppercase tracking-wide">
                Spacing
              </span>
              <span className="text-xs tabular-nums font-medium text-foreground">
                {value}
              </span>
            </button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          sideOffset={8}
          className="!w-auto !p-2 text-xs"
        >
          Spacing
        </HoverCardContent>
      </HoverCard>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="w-auto p-3"
      >
        <VStack spacing={2} className="items-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Spacing
          </span>
          <span className="text-base font-medium tabular-nums text-foreground">
            {value}
          </span>
          <div className="relative h-32 w-6 flex items-center justify-center">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={value}
              onChange={(e) => onChange?.(Number(e.target.value))}
              aria-label="Layout spacing"
              className="absolute h-32 w-32 -rotate-90 cursor-pointer accent-foreground"
              style={{ accentColor: "hsl(var(--foreground))" }}
            />
          </div>
          <HStack className="w-full justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>1</span>
            <span>5</span>
          </HStack>
        </VStack>
      </PopoverContent>
    </Popover>
  );
}

function SegmentButton({
  active,
  onClick,
  ariaLabel,
  children
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-sm font-medium"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
