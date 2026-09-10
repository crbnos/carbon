import type { Shortcut } from "@carbon/react";
import {
  Badge,
  Button,
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  Paragraph,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PulsingDot,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ShortcutKey,
  Slider,
  Switch,
  shortcutKeyVariants,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDebounce,
  useShortcutKeys
} from "@carbon/react";
import { formatDurationMilliseconds, lerp } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Virtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  LuBan,
  LuCalendarClock,
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuSearch,
  LuTriangleAlert,
  LuZoomIn,
  LuZoomOut
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import {
  ShowParentIcon,
  ShowParentIconSelected
} from "~/assets/icons/ShowParentIcon";
import tileBgPath from "~/assets/images/error-banner-tile@2x.png";
import type { GanttEvent } from "~/components/Gantt/types";
import * as Timeline from "~/components/Timeline";
import type { NodesState, UseTreeStateOutput } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { setResizableGanttSettings } from "~/utils/resizable-panels";
import { GanttIcon } from "./components/GanttIcon";
import {
  GanttTaskStatusIcon,
  runStatusClassNameColor
} from "./components/GanttTaskStatus";
import { eventBackgroundClassName, SpanTitle } from "./components/SpanTitle";

/** The tree list's default width, in px — the timeline takes the remainder. */
const TREE_DEFAULT_WIDTH = 360;
/** Floor the tree can be dragged to, in px (kept below the default width). */
const TREE_MIN_WIDTH = 240;

/**
 * Live element width via ResizeObserver. Unlike a measure-once hook, it updates
 * when the panel is dragged, so the timeline can reflow to fill its space
 * instead of freezing at its mount-time width.
 */
function useElementWidth(ref: React.RefObject<HTMLElement>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

type GanttProps = {
  events: GanttEvent[];
  selectedId?: string;
  /** Nodes to render collapsed on first render (initial state only — pass a
   * fresh `key` to re-apply when the tree's shape changes) */
  collapsedIds?: string[];
  parentReadableId?: string;
  onSelectedIdChanged: (selectedId: string | undefined) => void;
  /**
   * Optional trailing element rendered at the end of each tree row (before the
   * status icon). Receives the node so the caller can decide per-row — e.g. an
   * info popover only on work-center lanes. Kept generic so the Gantt stays
   * decoupled from any one view's domain.
   */
  renderNodeAside?: (node: GanttEvent) => React.ReactNode;
  /**
   * Optional content for the toolbar, rendered just before the In Process /
   * Show Durations switches — e.g. the forecast board's resource/reservation
   * counts and conflict badge.
   */
  toolbarAccessory?: React.ReactNode;
  totalDuration: number;
  rootSpanStatus: "inprogress" | "completed" | "todo" | "cancelled";
  rootStartedAt: Date | undefined;
  /**
   * Axis mode. "duration" (default) labels ticks with elapsed time ("6h").
   * "absolute" labels them with a real clock/date via {@link formatAxisTick},
   * anchored at {@link windowStartMs} — used by the resource-load views that
   * pin an explicit day/week/shift window.
   */
  axis?: "duration" | "absolute";
  /** Epoch ms of the window start; required when `axis === "absolute"`. */
  windowStartMs?: number;
  /** Renders an absolute tick label from an epoch-ms instant. */
  formatAxisTick?: (absoluteMs: number) => string;
  /**
   * Epoch ms of "now". In `axis === "absolute"` mode this draws the green
   * current-time line, but only while now falls inside the window — otherwise
   * there is no green line. Ignored in duration mode.
   */
  nowMs?: number;
  /**
   * Absolute [start, end) epoch-ms intervals of NON-working time (nights,
   * weekends, plant-closed hours) to shade behind every row, so a bar spanning
   * several days does not read as 24h/day. Anchored at {@link windowStartMs};
   * only used in `axis === "absolute"` mode.
   */
  nonWorkingIntervals?: { start: number; end: number }[];
  /**
   * Spacing between axis ticks, in ms, anchored at {@link windowStartMs}. Gives
   * clean clock-aligned gridlines (e.g. every 4h on a day view) instead of the
   * default five equal fractions of the padded axis. `axis === "absolute"` only;
   * omit to keep the equal-fraction ticks.
   */
  tickIntervalMs?: number;
  /**
   * Explicit axis tick offsets (ms from {@link windowStartMs}), one label+line
   * each. Use when the ticks are not evenly spaced in ms — e.g. one per day on a
   * week view, placed at real LOCAL midnights so they stay day-aligned across a
   * DST transition (a fixed 24h interval would drift). Takes precedence over
   * {@link tickIntervalMs}. `axis === "absolute"` only.
   */
  axisTickMs?: number[];
};

const Gantt = ({
  events,
  selectedId,
  collapsedIds,
  parentReadableId,
  onSelectedIdChanged,
  renderNodeAside,
  toolbarAccessory,
  totalDuration,
  rootSpanStatus,
  rootStartedAt,
  axis = "duration",
  windowStartMs,
  formatAxisTick,
  nowMs,
  nonWorkingIntervals,
  tickIntervalMs,
  axisTickMs
}: GanttProps) => {
  const { t } = useLingui();
  const [filterText, setFilterText] = useState("");
  const [wipOnly, setWipOnly] = useState(false);
  const [showDurations, setShowDurations] = useState(false);
  const [scale, setScale] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const panelGroupRef = useRef<HTMLDivElement>(null);

  // The tree defaults to a fixed pixel width; react-resizable-panels only takes
  // percentages, so convert once the group's width is known (and gate the group
  // on it, since defaultSize is read only at mount). The timeline gets the rest.
  // The min is px-derived too, so it stays below the default on wide monitors
  // (a fixed 20% floor would otherwise clamp the 360px default up).
  const panelGroupWidth = useElementWidth(panelGroupRef);
  const treeDefaultSize =
    panelGroupWidth > 0
      ? Math.min(90, Math.max(10, (TREE_DEFAULT_WIDTH / panelGroupWidth) * 100))
      : undefined;
  const treeMinSize =
    panelGroupWidth > 0
      ? Math.min(80, Math.max(5, (TREE_MIN_WIDTH / panelGroupWidth) * 100))
      : 20;

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleNodeSelection,
    toggleExpandNode,
    expandAllBelowDepth,
    toggleExpandLevel,
    collapseAllBelowDepth,
    selectNode,
    scrollToNode,
    virtualizer
  } = useTree({
    tree: events,
    selectedId,
    collapsedIds,
    onSelectedIdChanged,
    estimatedRowHeight: () => 32,
    parentRef,
    filter: {
      value: { text: filterText, wipOnly },
      fn: (value, node) => {
        const isWIP = (value.wipOnly && node.data.isPartial) || !value.wipOnly;

        if (!isWIP) return false;

        if (value.text === "") return true;
        if (
          node.data.message.toLowerCase().includes(value.text.toLowerCase())
        ) {
          return true;
        }
        return false;
      }
    }
  });

  return (
    <div className="grid h-full grid-rows-[2.5rem_1fr_3.25rem] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border">
        <SearchField onChange={setFilterText} />
        <div className="flex items-center gap-3 pr-2">
          {toolbarAccessory}
          <Switch
            variant="small"
            label={t`In Process Only`}
            checked={wipOnly}
            onCheckedChange={(e) => setWipOnly(e.valueOf())}
          />
          <Switch
            variant="small"
            label={t`Show Durations`}
            checked={showDurations}
            onCheckedChange={(e) => setShowDurations(e.valueOf())}
          />
        </div>
      </div>
      <div ref={panelGroupRef} className="h-full w-full min-h-0">
        {treeDefaultSize !== undefined && (
          <ResizablePanelGroup
            direction="horizontal"
            onLayout={(layout) => {
              if (layout.length !== 2) return;
              setResizableGanttSettings(document, layout);
            }}
          >
            {/* Tree list */}
            <ResizablePanel
              order={1}
              minSize={treeMinSize}
              defaultSize={treeDefaultSize}
              className="pl-3"
            >
              <div className="grid h-full grid-rows-[2rem_1fr] overflow-hidden">
                <div className="flex items-center pr-2">
                  {parentReadableId && (
                    <ShowParentLink ganttReadableId={parentReadableId} />
                  )}
                  <LiveReloadingStatus
                    rootSpanCompleted={rootSpanStatus !== "inprogress"}
                  />
                </div>
                <TreeView
                  parentRef={parentRef}
                  scrollRef={treeScrollRef}
                  virtualizer={virtualizer}
                  autoFocus
                  tree={events}
                  nodes={nodes}
                  getNodeProps={getNodeProps}
                  getTreeProps={getTreeProps}
                  renderNode={({ node, state }) => (
                    <>
                      <div
                        className={cn(
                          "group flex h-8 cursor-pointer items-center overflow-hidden rounded-l-sm pr-2",
                          state.selected
                            ? "bg-muted"
                            : "bg-transparent hover:bg-muted/60"
                        )}
                        onClick={() => {
                          selectNode(node.id);
                        }}
                      >
                        <div className="flex h-8 items-center">
                          {Array.from({ length: node.level }).map(
                            (_, index) => (
                              <LevelLine
                                key={index}
                                isError={node.data.isError}
                                isSelected={state.selected}
                              />
                            )
                          )}
                          <div
                            className={cn(
                              "flex h-8 w-4 items-center",
                              node.hasChildren && "hover:bg-muted"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.altKey) {
                                if (state.expanded) {
                                  collapseAllBelowDepth(node.level);
                                } else {
                                  expandAllBelowDepth(node.level);
                                }
                              } else {
                                toggleExpandNode(node.id);
                              }
                              scrollToNode(node.id);
                            }}
                          >
                            {node.hasChildren ? (
                              state.expanded ? (
                                <LuChevronDown className="size-4 text-muted-foreground" />
                              ) : (
                                <LuChevronRight className="size-4 text-muted-foreground" />
                              )
                            ) : (
                              <div className="h-8 w-4" />
                            )}
                          </div>
                        </div>

                        <div className="flex w-full items-center justify-between gap-2 pl-1">
                          <div className="flex items-center gap-2 overflow-x-hidden">
                            <GanttIcon
                              name={node.data.style?.icon}
                              className="size-4 min-h-4 min-w-4"
                            />
                            <NodeText node={node} />
                            {node.data.isRoot && (
                              <Badge variant="outline" className="text-xs">
                                <Trans>Job</Trans>
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {renderNodeAside?.(node)}
                            <NodeStatusIcon node={node} />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  onScroll={(scrollTop) => {
                    //sync the scroll to the tree
                    if (timelineScrollRef.current) {
                      timelineScrollRef.current.scrollTop = scrollTop;
                    }
                  }}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            {/* Timeline — takes whatever the tree leaves */}
            <ResizablePanel
              order={2}
              minSize={20}
              defaultSize={100 - treeDefaultSize}
            >
              <GanttTimeline
                totalDuration={totalDuration}
                scale={scale}
                events={events}
                rootSpanStatus={rootSpanStatus}
                rootStartedAt={rootStartedAt}
                axis={axis}
                windowStartMs={windowStartMs}
                formatAxisTick={formatAxisTick}
                nowMs={nowMs}
                nonWorkingIntervals={nonWorkingIntervals}
                tickIntervalMs={tickIntervalMs}
                axisTickMs={axisTickMs}
                parentRef={parentRef}
                timelineScrollRef={timelineScrollRef}
                nodes={nodes}
                getNodeProps={getNodeProps}
                getTreeProps={getTreeProps}
                showDurations={showDurations}
                treeScrollRef={treeScrollRef}
                virtualizer={virtualizer}
                toggleNodeSelection={toggleNodeSelection}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2">
        <div className="grow @container">
          <div className="hidden items-center gap-4 @[42rem]:flex">
            <KeyboardShortcuts
              expandAllBelowDepth={expandAllBelowDepth}
              collapseAllBelowDepth={collapseAllBelowDepth}
              toggleExpandLevel={toggleExpandLevel}
              setShowDurations={setShowDurations}
            />
          </div>
          <div className="@[42rem]:hidden">
            <Popover>
              <PopoverTrigger className="text-sm">
                <Trans>Shortcuts</Trans>
              </PopoverTrigger>
              <PopoverContent
                className="min-w-[20rem] overflow-y-auto p-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                align="start"
              >
                <div className="flex flex-col gap-2">
                  <KeyboardShortcuts
                    expandAllBelowDepth={expandAllBelowDepth}
                    collapseAllBelowDepth={collapseAllBelowDepth}
                    toggleExpandLevel={toggleExpandLevel}
                    setShowDurations={setShowDurations}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Slider
            className="w-20"
            // @ts-expect-error TS2322 - TODO: fix type
            leftIcon={<LuZoomOut />}
            rightIcon={<LuZoomIn />}
            value={[scale]}
            onValueChange={(value) => setScale(value[0])}
            min={0}
            max={1}
            step={0.05}
          />
        </div>
      </div>
    </div>
  );
};

export default Gantt;

type GanttTimelineProps = Pick<
  GanttProps,
  | "totalDuration"
  | "rootSpanStatus"
  | "events"
  | "rootStartedAt"
  | "axis"
  | "windowStartMs"
  | "formatAxisTick"
  | "nowMs"
  | "nonWorkingIntervals"
  | "tickIntervalMs"
  | "axisTickMs"
> & {
  scale: number;
  parentRef: React.RefObject<HTMLDivElement>;
  timelineScrollRef: React.RefObject<HTMLDivElement>;
  virtualizer: Virtualizer<HTMLElement, Element>;
  nodes: NodesState;
  getNodeProps: UseTreeStateOutput["getNodeProps"];
  getTreeProps: UseTreeStateOutput["getTreeProps"];
  toggleNodeSelection: UseTreeStateOutput["toggleNodeSelection"];
  showDurations: boolean;
  treeScrollRef: React.RefObject<HTMLDivElement>;
};

const TICK_COUNT = 5;

/**
 * Split a bar's [offset, offset+duration] into its WORKING pieces by removing
 * the (offset-space) non-working intervals — so a reservation spanning several
 * days renders as separate bars with gaps at night/weekends, not one solid
 * block that reads as round-the-clock work. Pure interval subtraction.
 */
function splitWorkingSegments(
  offset: number,
  duration: number,
  nonWorking: { start: number; end: number }[]
): { startMs: number; durationMs: number }[] {
  let pieces = [{ start: offset, end: offset + duration }];
  for (const nw of nonWorking) {
    const next: { start: number; end: number }[] = [];
    for (const seg of pieces) {
      if (nw.end <= seg.start || nw.start >= seg.end) {
        next.push(seg);
        continue;
      }
      if (nw.start > seg.start) next.push({ start: seg.start, end: nw.start });
      if (nw.end < seg.end) next.push({ start: nw.end, end: seg.end });
    }
    pieces = next;
  }
  return pieces
    .filter((s) => s.end > s.start)
    .map((s) => ({ startMs: s.start, durationMs: s.end - s.start }));
}

const GanttTimeline = ({
  totalDuration,
  scale,
  rootSpanStatus,
  rootStartedAt,
  axis = "duration",
  windowStartMs,
  formatAxisTick,
  nowMs,
  nonWorkingIntervals,
  tickIntervalMs,
  axisTickMs,
  parentRef,
  timelineScrollRef,
  virtualizer,
  events,
  nodes,
  getNodeProps,
  getTreeProps,
  toggleNodeSelection,
  showDurations,
  treeScrollRef
}: GanttTimelineProps) => {
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  // Live width (ResizeObserver) so the timeline reflows to fill the panel when
  // the tree/timeline divider is dragged, instead of freezing at mount width.
  const timelineWidth = useElementWidth(timelineContainerRef);
  const minTimelineWidth = timelineWidth || 300;
  const maxTimelineWidth = minTimelineWidth * 10;

  const isAbsolute = axis === "absolute";

  // Absolute mode anchors each tick's elapsed offset to a real instant; the
  // default duration mode just labels the elapsed time.
  const renderTickLabel = (ms: number) => {
    if (isAbsolute && formatAxisTick && windowStartMs !== undefined) {
      return formatAxisTick(windowStartMs + ms);
    }
    return formatDurationMilliseconds(ms, {
      style: "short",
      maxDecimalPoints: ms < 1000 ? 0 : 1
    });
  };

  // In absolute mode the green line is "now" — and only when now falls inside
  // the window. The window end is just a boundary, never a completion.
  const nowOffsetMs =
    isAbsolute && nowMs !== undefined && windowStartMs !== undefined
      ? nowMs - windowStartMs
      : null;
  const showNow =
    nowOffsetMs !== null && nowOffsetMs >= 0 && nowOffsetMs <= totalDuration;

  //we want to live-update the duration if the root span is still in progress
  const [duration, setDuration] = useState(totalDuration);
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (rootSpanStatus !== "inprogress" || !rootStartedAt) {
      setDuration(totalDuration);
      return;
    }

    const interval = setInterval(() => {
      setDuration(Date.now() - rootStartedAt.getTime());
    }, 5000);

    return () => clearInterval(interval);
  }, [totalDuration, rootSpanStatus]);

  // Absolute-mode axis ticks. Explicit offsets win (e.g. one per day on a week
  // view, placed at real local midnights so they don't drift over a DST change);
  // otherwise a fixed interval from the window start (a clean local boundary:
  // midnight for day, the shift start for shift), so labels land on clock-aligned
  // marks (e.g. every 4h) instead of five equal fractions of the padded axis.
  // Null → keep the default equal-fraction ticks. Capped so a too-dense set
  // can't explode the DOM.
  const absoluteTicks =
    isAbsolute && axisTickMs && axisTickMs.length > 0
      ? axisTickMs.filter((ms) => ms >= 0 && ms <= duration).slice(0, 400)
      : isAbsolute &&
          tickIntervalMs &&
          tickIntervalMs > 0 &&
          duration / tickIntervalMs <= 400
        ? (() => {
            const out: number[] = [];
            for (let ms = 0; ms <= duration; ms += tickIntervalMs) out.push(ms);
            return out;
          })()
        : null;

  // Non-working intervals in offset-space (ms from the window start), used to
  // split each bar into its working pieces so nights/weekends read as gaps.
  const nonWorkingOffsets =
    isAbsolute && windowStartMs !== undefined && nonWorkingIntervals
      ? nonWorkingIntervals.map((interval) => ({
          start: interval.start - windowStartMs,
          end: interval.end - windowStartMs
        }))
      : null;

  return (
    <div
      className="h-full overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
      ref={timelineContainerRef}
    >
      <Timeline.Root
        durationMs={duration * 1.05}
        scale={scale}
        className="h-full overflow-hidden"
        minWidth={minTimelineWidth}
        maxWidth={maxTimelineWidth}
      >
        {/* Follows the cursor */}
        <CurrentTimeIndicator totalDuration={duration} />

        <Timeline.Row className="grid h-full grid-rows-[2rem_1fr]">
          {/* The duration labels */}
          <Timeline.Row>
            <Timeline.Row className="h-6">
              {absoluteTicks ? (
                absoluteTicks.map((tickMs) => (
                  <Timeline.Point
                    key={tickMs}
                    ms={tickMs}
                    className="relative bottom-[2px] text-xxs text-muted-foreground"
                  >
                    {(ms) => (
                      <div
                        className={cn(
                          "whitespace-nowrap",
                          // Align by POSITION, not index: a tick at the very
                          // start hugs the left, one at the very end hugs the
                          // right, everything between (e.g. a week's mid-week
                          // day ticks, which don't reach the edge) is centered.
                          tickMs <= 0
                            ? "ml-1"
                            : tickMs >= duration * 0.98
                              ? "-ml-1 -translate-x-full"
                              : "-translate-x-1/2"
                        )}
                      >
                        {renderTickLabel(ms)}
                      </div>
                    )}
                  </Timeline.Point>
                ))
              ) : (
                <>
                  <Timeline.EquallyDistribute count={TICK_COUNT}>
                    {(ms: number, index: number) => {
                      if (index === TICK_COUNT - 1) return null;
                      return (
                        <Timeline.Point
                          ms={ms}
                          className={
                            "relative bottom-[2px] text-xxs text-muted-foreground"
                          }
                        >
                          {(ms) => (
                            <div
                              className={cn(
                                "whitespace-nowrap",
                                index === 0
                                  ? "ml-1"
                                  : index === TICK_COUNT - 1
                                    ? "-ml-1 -translate-x-full"
                                    : "-translate-x-1/2"
                              )}
                            >
                              {renderTickLabel(ms)}
                            </div>
                          )}
                        </Timeline.Point>
                      );
                    }}
                  </Timeline.EquallyDistribute>
                  {rootSpanStatus !== "inprogress" && (
                    <Timeline.Point
                      ms={duration}
                      className={cn(
                        "relative bottom-[2px] text-xxs",
                        isAbsolute
                          ? "text-muted-foreground"
                          : rootSpanStatus === "completed"
                            ? "text-emerald-500"
                            : "text-destructive"
                      )}
                    >
                      {(ms) => (
                        <div
                          className={cn("-translate-x-1/2 whitespace-nowrap")}
                        >
                          {renderTickLabel(ms)}
                        </div>
                      )}
                    </Timeline.Point>
                  )}
                </>
              )}
            </Timeline.Row>
            <Timeline.Row className="h-2">
              {absoluteTicks ? (
                absoluteTicks.map((tickMs, index) =>
                  index === 0 ? null : (
                    <Timeline.Point
                      key={tickMs}
                      ms={tickMs}
                      className="h-full border-r border-muted"
                    />
                  )
                )
              ) : (
                <>
                  <Timeline.EquallyDistribute count={TICK_COUNT}>
                    {(ms: number, index: number) => {
                      if (index === 0 || index === TICK_COUNT - 1) return null;
                      return (
                        <Timeline.Point
                          ms={ms}
                          className={"h-full border-r border-muted"}
                        />
                      );
                    }}
                  </Timeline.EquallyDistribute>
                  <Timeline.Point
                    ms={duration}
                    className={cn(
                      "h-full border-r",
                      isAbsolute
                        ? "border-muted"
                        : rootSpanStatus === "completed"
                          ? "border-success/30"
                          : "border-destructive/30"
                    )}
                  />
                </>
              )}
            </Timeline.Row>
          </Timeline.Row>
          {/* Main timeline body */}
          <Timeline.Row className="overflow-hidden">
            {/* Non-working time (nights / weekends / plant-closed hours) shaded
                behind every lane, so a bar spanning several days no longer reads
                as 24h/day. Absolute mode only; clamped to the visible window. */}
            {isAbsolute &&
              windowStartMs !== undefined &&
              nonWorkingIntervals?.map((interval) => {
                const startMs = Math.max(0, interval.start - windowStartMs);
                const endMs = Math.min(duration, interval.end - windowStartMs);
                if (endMs <= startMs) return null;
                return (
                  <Timeline.Span
                    key={`nonworking-${interval.start}`}
                    startMs={startMs}
                    durationMs={endMs - startMs}
                    className="pointer-events-none h-full bg-muted/50"
                  />
                );
              })}
            {/* The vertical tick lines */}
            {absoluteTicks ? (
              absoluteTicks.map((tickMs, index) =>
                index === 0 ? null : (
                  <Timeline.Point
                    key={tickMs}
                    ms={tickMs}
                    className="h-full border-r border-muted"
                  />
                )
              )
            ) : (
              <Timeline.EquallyDistribute count={TICK_COUNT}>
                {(ms: number, index: number) => {
                  if (index === 0) return null;
                  return (
                    <Timeline.Point
                      ms={ms}
                      className={"h-full border-r border-muted"}
                    />
                  );
                }}
              </Timeline.EquallyDistribute>
            )}
            {/* Absolute mode: the green line is "now", drawn only while now is
                inside the window. Duration mode keeps the completed/failed
                end-of-span line. */}
            {isAbsolute
              ? showNow && (
                  <Timeline.Point
                    ms={nowOffsetMs as number}
                    className="h-full border-r border-emerald-500/90"
                  />
                )
              : rootSpanStatus !== "inprogress" && (
                  <Timeline.Point
                    ms={duration}
                    className={cn(
                      "h-full border-r",
                      rootSpanStatus === "completed"
                        ? "border-emerald-500/90"
                        : "border-destructive/30"
                    )}
                  />
                )}
            <TreeView
              scrollRef={timelineScrollRef}
              virtualizer={virtualizer}
              tree={events}
              nodes={nodes}
              getNodeProps={getNodeProps}
              getTreeProps={getTreeProps}
              parentClassName="h-full scrollbar-hide"
              renderNode={({
                node,
                state,
                index,
                virtualizer,
                virtualItem
              }) => {
                return (
                  <Timeline.Row
                    key={index}
                    className={cn(
                      "group flex h-8 cursor-pointer items-center",
                      state.selected
                        ? "bg-muted"
                        : "bg-transparent hover:bg-muted/60"
                    )}
                    // onMouseOver={() => console.log(`hover ${index}`)}
                    onClick={(e) => {
                      toggleNodeSelection(node.id);
                    }}
                  >
                    {node.data.level === "TRACE" ? (
                      <>
                        {node.data.wait && node.data.wait.duration > 0 && (
                          <WaitSpan wait={node.data.wait} />
                        )}
                        {/* A zero-duration node renders no bar — an idle
                            resource lane or an unscheduled job is genuinely
                            empty. In-progress work carries a real elapsed
                            duration (end clamped to "now"), so it still draws;
                            never fill an unknown/zero span to the window edge. */}
                        {node.data.duration > 0 && (
                          <SpanWithDuration
                            showDuration={state.selected ? true : showDurations}
                            startMs={node.data.offset}
                            durationMs={node.data.duration}
                            node={node}
                            segments={
                              nonWorkingOffsets
                                ? splitWorkingSegments(
                                    node.data.offset,
                                    node.data.duration,
                                    nonWorkingOffsets
                                  )
                                : undefined
                            }
                          />
                        )}
                        {/* Red conflict windows painted over the neutral rollup
                            base — split on working time so they line up with the
                            chopped bar. */}
                        {node.data.conflictSegments?.flatMap((segment, si) => {
                          const pieces = nonWorkingOffsets
                            ? splitWorkingSegments(
                                segment.offset,
                                segment.duration,
                                nonWorkingOffsets
                              )
                            : [
                                {
                                  startMs: segment.offset,
                                  durationMs: segment.duration
                                }
                              ];
                          return pieces.map((piece) => (
                            <Timeline.Span
                              key={`conflict:${si}:${piece.startMs}:${piece.durationMs}`}
                              startMs={piece.startMs}
                              durationMs={piece.durationMs}
                            >
                              <div className="h-4 w-full min-w-[2px] rounded-sm bg-red-500" />
                            </Timeline.Span>
                          ));
                        })}
                      </>
                    ) : (
                      <Timeline.Point ms={node.data.offset}>
                        {(ms) => (
                          <motion.div
                            className={cn(
                              "-ml-1 size-3 rounded-full",
                              eventBackgroundClassName(node.data)
                            )}
                            layoutId={node.id}
                          />
                        )}
                      </Timeline.Point>
                    )}
                  </Timeline.Row>
                );
              }}
              onScroll={(scrollTop) => {
                //sync the scroll to the tree
                if (treeScrollRef.current) {
                  treeScrollRef.current.scrollTop = scrollTop;
                }
              }}
            />
          </Timeline.Row>
        </Timeline.Row>
      </Timeline.Root>
    </div>
  );
};

function NodeText({ node }: { node: GanttEvent }) {
  const className = "line-clamp-1";
  return (
    <Paragraph variant="small" className={cn(className)}>
      <SpanTitle {...node.data} size="small" />
    </Paragraph>
  );
}

function StatusIconTooltip({
  label,
  children
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function NodeStatusIcon({ node }: { node: GanttEvent }) {
  if (node.data.isCancelled) {
    return (
      <>
        <Paragraph
          variant="extra-small"
          className={runStatusClassNameColor("CANCELED")}
        >
          <Trans>Canceled</Trans>
        </Paragraph>
        <GanttTaskStatusIcon status="CANCELED" className="size-4" />
      </>
    );
  }

  if (node.data.isUnschedulable) {
    return (
      <StatusIconTooltip
        label={
          node.hasChildren ? (
            <Trans>Has operations that can't be scheduled</Trans>
          ) : (
            <Trans>Can't be scheduled</Trans>
          )
        }
      >
        <LuBan className="size-4 text-red-500" />
      </StatusIconTooltip>
    );
  }

  if (node.data.isError) {
    return (
      <StatusIconTooltip label={<Trans>Scheduling conflict</Trans>}>
        <LuTriangleAlert className="size-4 text-red-500" />
      </StatusIconTooltip>
    );
  }

  if (node.data.isPartial) {
    return (
      <StatusIconTooltip label={<Trans>In progress</Trans>}>
        <GanttTaskStatusIcon status={"EXECUTING"} className="size-4" />
      </StatusIconTooltip>
    );
  }

  if (node.data.isEstimated) {
    return (
      <StatusIconTooltip
        label={<Trans>Estimated — no capacity reservation</Trans>}
      >
        <LuCalendarClock className="size-4 text-blue-500" />
      </StatusIconTooltip>
    );
  }

  return (
    <StatusIconTooltip label={<Trans>Scheduled</Trans>}>
      <LuCircleCheck className="size-4 text-success" />
    </StatusIconTooltip>
  );
}

function ShowParentLink({ ganttReadableId }: { ganttReadableId: string }) {
  const [mouseOver, setMouseOver] = useState(false);
  const { spanParam } = useParams();

  return (
    <Button
      onMouseEnter={() => setMouseOver(true)}
      onMouseLeave={() => setMouseOver(false)}
      asChild
      className="w-full text-left flex-1"
    >
      <Link
        to={
          spanParam
            ? "/x/scheduling/runs?span=" + spanParam
            : "x/scheduling/runs"
        }
      >
        {mouseOver ? (
          <ShowParentIconSelected className="h-4 w-4 text-indigo-500" />
        ) : (
          <ShowParentIcon className="text-gray-600 h-4 w-4" />
        )}
        <Paragraph
          variant="small"
          className={cn(mouseOver ? "text-indigo-500" : "text-gray-500")}
        >
          <Trans>Show parent items</Trans>
        </Paragraph>
      </Link>
    </Button>
  );
}

function LiveReloadingStatus({
  rootSpanCompleted
}: {
  rootSpanCompleted: boolean;
}) {
  if (rootSpanCompleted) return null;

  return (
    <div className="flex items-center gap-1">
      <PulsingDot />
      <Paragraph
        variant="extra-small"
        className="whitespace-nowrap text-primary"
      >
        <Trans>Live reloading</Trans>
      </Paragraph>
    </div>
  );
}

/**
 * Faded "waiting" segment drawn before a bar: the operation could have
 * started at the segment's left edge but sat in queue until the solid bar
 * begins. The reason is written on the segment (truncated when narrow) and
 * shown in full as the tooltip.
 */
function WaitSpan({ wait }: { wait: NonNullable<GanttEvent["data"]["wait"]> }) {
  // The tooltip trigger must wrap a plain element INSIDE Timeline.Span —
  // Timeline.Span doesn't forward props/refs, so `asChild` on it silently
  // drops the tooltip's hover listeners and the tooltip never opens.
  const bar = (
    <div
      className="h-4 w-full min-w-[2px] rounded-l-sm bg-foreground/20 opacity-40"
      style={{
        backgroundImage: `url(${tileBgPath})`,
        backgroundSize: "8px 8px"
      }}
    />
  );

  return (
    <Timeline.Span startMs={wait.offset} durationMs={wait.duration}>
      {wait.reason ? (
        <Tooltip>
          <TooltipTrigger asChild>{bar}</TooltipTrigger>
          <TooltipContent>
            <span>{wait.reason}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        bar
      )}
    </Timeline.Span>
  );
}

function SpanWithDuration({
  showDuration,
  node,
  segments,
  ...props
}: Timeline.SpanProps & {
  node: GanttEvent;
  showDuration: boolean;
  /**
   * Working-time pieces the bar is split into (non-working masked out) — a
   * multi-day reservation draws as separate bars with gaps at night. Omit for a
   * single continuous bar spanning props.startMs..+durationMs.
   */
  segments?: { startMs: number; durationMs: number }[];
}) {
  const pieces =
    segments && segments.length > 0
      ? segments
      : [{ startMs: props.startMs, durationMs: props.durationMs }];

  // The duration label (TOTAL work, from props.durationMs) rides the widest
  // piece so it stays readable when the bar is split into thin segments.
  let labelIndex = 0;
  for (let i = 1; i < pieces.length; i++) {
    if ((pieces[i]?.durationMs ?? 0) > (pieces[labelIndex]?.durationMs ?? 0)) {
      labelIndex = i;
    }
  }

  return (
    <>
      {pieces.map((piece, i) => (
        <Timeline.Span
          key={`${piece.startMs}:${piece.durationMs}`}
          startMs={piece.startMs}
          durationMs={piece.durationMs}
        >
          <motion.div
            className={cn(
              "relative flex h-4 w-full min-w-[2px] items-center rounded-sm",
              // Aggregate/rollup rows draw a neutral base; their conflict windows
              // are painted red on top (see the overlay in the tree render), so a
              // single late child never reddens the whole span.
              node.data.conflictSegments
                ? "bg-gray-500"
                : eventBackgroundClassName(node.data)
            )}
            layoutId={pieces.length === 1 ? node.id : `${node.id}:${i}`}
          >
            {(node.data.isPartial || node.data.isEstimated) && (
              <div
                className={cn(
                  "absolute left-0 top-0 h-full w-full rounded-sm opacity-30",
                  // estimated placements are static; only live work animates
                  node.data.isPartial && "animate-tile-scroll"
                )}
                style={{
                  backgroundImage: `url(${tileBgPath})`,
                  backgroundSize: "8px 8px"
                }}
              />
            )}
            {i === labelIndex && (
              <div
                className={cn(
                  "sticky left-0 z-10 transition group-hover:opacity-100",
                  !showDuration && "opacity-0"
                )}
              >
                <div className="rounded-sm bg-black/40 px-1 py-0.5 text-xxs font-medium text-white tabular-nums">
                  {formatDurationMilliseconds(props.durationMs, {
                    style: "short",
                    maxDecimalPoints: props.durationMs < 1000 ? 0 : 1
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </Timeline.Span>
      ))}
    </>
  );
}

const edgeBoundary = 0.05;

function CurrentTimeIndicator({ totalDuration }: { totalDuration: number }) {
  return (
    <Timeline.FollowCursor>
      {(ms) => {
        const ratio = ms / totalDuration;
        let offset = 0.5;
        if (ratio < edgeBoundary) {
          offset = lerp(0, 0.5, ratio / edgeBoundary);
        } else if (ratio > 1 - edgeBoundary) {
          offset = lerp(0.5, 1, (ratio - (1 - edgeBoundary)) / edgeBoundary);
        }

        return (
          <div className="relative z-50 flex h-full flex-col">
            <div className="relative flex h-6 items-end">
              <div
                className="absolute w-fit whitespace-nowrap rounded-sm border border-border bg-popover px-1 py-0.5 text-xxs text-popover-foreground shadow-sm tabular-nums"
                style={{
                  left: `${offset * 100}%`,
                  transform: `translateX(-${offset * 100}%)`
                }}
              >
                {formatDurationMilliseconds(ms, {
                  style: "short",
                  maxDecimalPoints: ms < 1000 ? 0 : 1
                })}
              </div>
            </div>
            <div className="w-px grow border-r border-border" />
          </div>
        );
      }}
    </Timeline.FollowCursor>
  );
}

function KeyboardShortcuts({
  expandAllBelowDepth,
  collapseAllBelowDepth,
  toggleExpandLevel,
  setShowDurations
}: {
  expandAllBelowDepth: (depth: number) => void;
  collapseAllBelowDepth: (depth: number) => void;
  toggleExpandLevel: (depth: number) => void;
  setShowDurations: (show: (show: boolean) => boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <>
      <ArrowKeyShortcuts />
      <ShortcutWithAction
        shortcut={{ key: "e" }}
        action={() => expandAllBelowDepth(0)}
        title={t`Expand all`}
      />
      <ShortcutWithAction
        shortcut={{ key: "c" }}
        action={() => collapseAllBelowDepth(1)}
        title={t`Collapse all`}
      />
      <NumberShortcuts toggleLevel={(number) => toggleExpandLevel(number)} />
      <ShortcutWithAction
        shortcut={{ key: "d" }}
        action={() => setShowDurations((d) => !d)}
        title={t`Toggle durations`}
      />
    </>
  );
}

function ArrowKeyShortcuts() {
  return (
    <div className="flex items-center gap-0.5">
      <ShortcutKey
        shortcut={{ key: "arrowup" }}
        variant="medium"
        className="ml-0 mr-0"
      />
      <ShortcutKey
        shortcut={{ key: "arrowdown" }}
        variant="medium"
        className="ml-0 mr-0"
      />
      <ShortcutKey
        shortcut={{ key: "arrowleft" }}
        variant="medium"
        className="ml-0 mr-0"
      />
      <ShortcutKey
        shortcut={{ key: "arrowright" }}
        variant="medium"
        className="ml-0 mr-0"
      />
      <Paragraph variant="extra-small" className="ml-1.5 whitespace-nowrap">
        <Trans>Navigate</Trans>
      </Paragraph>
    </div>
  );
}

function ShortcutWithAction({
  shortcut,
  title,
  action
}: {
  shortcut: Shortcut;
  title: string;
  action: () => void;
}) {
  useShortcutKeys({
    shortcut,
    action
  });

  return (
    <div className="flex items-center gap-0.5">
      <ShortcutKey shortcut={shortcut} variant="medium" className="ml-0 mr-0" />
      <Paragraph variant="extra-small" className="ml-1.5 whitespace-nowrap">
        {title}
      </Paragraph>
    </div>
  );
}

function NumberShortcuts({
  toggleLevel
}: {
  toggleLevel: (depth: number) => void;
}) {
  useHotkeys(
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    (event, hotkeysEvent) => {
      toggleLevel(Number(event.key));
    }
  );

  return (
    <div className="flex items-center gap-0.5">
      <span className={cn(shortcutKeyVariants.medium, "ml-0 mr-0")}>0</span>
      <span className="text-[0.75rem] text-text-dimmed">–</span>
      <span className={cn(shortcutKeyVariants.medium, "ml-0 mr-0")}>9</span>
      <Paragraph variant="extra-small" className="ml-1.5 whitespace-nowrap">
        <Trans>Toggle level</Trans>
      </Paragraph>
    </div>
  );
}

function SearchField({ onChange }: { onChange: (value: string) => void }) {
  const { t } = useLingui();
  const [value, setValue] = useState("");

  const updateFilterText = useDebounce((text: string) => {
    onChange(text);
  }, 250);

  const updateValue = (value: string) => {
    setValue(value);
    updateFilterText(value);
  };

  return (
    <InputGroup insetRing className="border-transparent rounded-none ring-0">
      <InputLeftElement>
        <LuSearch className="h-4 w-4 text-muted-foreground" />
      </InputLeftElement>
      <Input
        placeholder={t`Search Job`}
        value={value}
        onChange={(e) => updateValue(e.target.value)}
      />
    </InputGroup>
  );
}
