import type { Shortcut } from "@carbon/react";
import {
  Badge,
  Button,
  Input,
  InputGroup,
  InputLeftElement,
  Paragraph,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ShortcutKey,
  Slider,
  Switch,
  cn,
  shortcutKeyVariants,
  useDebounce,
  useInitialDimensions,
  useShortcutKeys,
} from "@carbon/react";
import { formatDurationMilliseconds, lerp } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  LuChevronDown,
  LuChevronUp,
  LuSearch,
  LuZoomIn,
  LuZoomOut,
} from "react-icons/lu";
import {
  ShowParentIcon,
  ShowParentIconSelected,
} from "~/assets/icons/ShowParentIcon";
import tileBgPath from "~/assets/images/error-banner-tile@2x.png";
import { GanttIcon } from "./components/GanttIcon";

import type { GanttEvent } from "~/components/Gantt/types";
import * as Timeline from "~/components/Timeline";
import type { NodesState, UseTreeStateOutput } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { setResizableGanttSettings } from "~/utils/resizablePanel";
import {
  GanttTaskStatusIcon,
  runStatusClassNameColor,
} from "./components/GanttTaskStatus";
import { SpanTitle, eventBackgroundClassName } from "./components/SpanTitle";

type GanttProps = {
  events: GanttEvent[];
  selectedId?: string;
  parentReadableId?: string;
  onSelectedIdChanged: (selectedId: string | undefined) => void;
  totalDuration: number;
  rootSpanStatus: "inprogress" | "completed" | "todo" | "cancelled";
  rootStartedAt: Date | undefined;
};

const Gantt = ({
  events,
  selectedId,
  parentReadableId,
  onSelectedIdChanged,
  totalDuration,
  rootSpanStatus,
  rootStartedAt,
}: GanttProps) => {
  const [filterText, setFilterText] = useState("");
  const [wipOnly, setWipOnly] = useState(false);
  const [showDurations, setShowDurations] = useState(false);
  const [scale, setScale] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

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
    virtualizer,
  } = useTree({
    tree: events,
    selectedId,
    // collapsedIds,
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
      },
    },
  });

  return (
    <div className="grid h-full grid-rows-[2.5rem_1fr_3.25rem] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border">
        <SearchField onChange={setFilterText} />
        <div className="flex items-center gap-2">
          <Switch
            variant="small"
            label="In Process Only"
            checked={wipOnly}
            onCheckedChange={(e) => setWipOnly(e.valueOf())}
          />
          <Switch
            variant="small"
            label="Show Durations"
            checked={showDurations}
            onCheckedChange={(e) => setShowDurations(e.valueOf())}
          />
        </div>
      </div>
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
          minSize={20}
          defaultSize={50}
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
                      "flex h-8 cursor-pointer items-center overflow-hidden rounded-l-sm pr-2",
                      state.selected
                        ? "bg-muted hover:bg-muted/90"
                        : "bg-transparent hover:bg-muted/90"
                    )}
                    onClick={() => {
                      selectNode(node.id);
                    }}
                  >
                    <div className="flex h-8 items-center">
                      {Array.from({ length: node.level }).map((_, index) => (
                        <LevelLine
                          key={index}
                          isError={node.data.isError}
                          isSelected={state.selected}
                        />
                      ))}
                      <div
                        className={cn(
                          "flex h-8 w-4 items-center",
                          node.hasChildren && "hover:bg-accent"
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
                            <LuChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <LuChevronUp className="h-4 w-4 text-gray-400" />
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
                          className="h-4 min-h-4 w-4 min-w-4"
                        />
                        <NodeText node={node} />
                        {node.data.isRoot && (
                          <Badge variant="outline" className="text-xs">
                            Job
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
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
        {/* Timeline */}
        <ResizablePanel order={2} minSize={20} defaultSize={50}>
          <GanttTimeline
            totalDuration={totalDuration}
            scale={scale}
            events={events}
            rootSpanStatus={rootSpanStatus}
            rootStartedAt={rootStartedAt}
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
              <PopoverTrigger className="text-sm">Shortcuts</PopoverTrigger>
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
            variant="primary"
            className="w-20"
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
  "totalDuration" | "rootSpanStatus" | "events" | "rootStartedAt"
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

const GanttTimeline = ({
  totalDuration,
  scale,
  rootSpanStatus,
  rootStartedAt,
  parentRef,
  timelineScrollRef,
  virtualizer,
  events,
  nodes,
  getNodeProps,
  getTreeProps,
  toggleNodeSelection,
  showDurations,
  treeScrollRef,
}: GanttTimelineProps) => {
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const initialTimelineDimensions = useInitialDimensions(timelineContainerRef);
  const minTimelineWidth = initialTimelineDimensions?.width ?? 300;
  const maxTimelineWidth = minTimelineWidth * 10;

  //we want to live-update the duration if the root span is still in progress
  const [duration, setDuration] = useState(totalDuration);
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
              <Timeline.EquallyDistribute count={TICK_COUNT}>
                {(ms: number, index: number) => {
                  if (index === TICK_COUNT - 1) return null;
                  return (
                    <Timeline.Point
                      ms={ms}
                      className={
                        "relative bottom-[2px] text-xxs text-text-dimmed"
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
                          {formatDurationMilliseconds(ms, {
                            style: "short",
                            maxDecimalPoints: ms < 1000 ? 0 : 1,
                          })}
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
                    rootSpanStatus === "completed"
                      ? "text-emerald-500"
                      : "text-destructive"
                  )}
                >
                  {(ms) => (
                    <div className={cn("-translate-x-1/2 whitespace-nowrap")}>
                      {formatDurationMilliseconds(ms, {
                        style: "short",
                        maxDecimalPoints: ms < 1000 ? 0 : 1,
                      })}
                    </div>
                  )}
                </Timeline.Point>
              )}
            </Timeline.Row>
            <Timeline.Row className="h-2">
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
                  rootSpanStatus === "completed"
                    ? "border-success/30"
                    : "border-error/30"
                )}
              />
            </Timeline.Row>
          </Timeline.Row>
          {/* Main timeline body */}
          <Timeline.Row className="overflow-hidden">
            {/* The vertical tick lines */}
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
            {/* The completed line  */}
            {rootSpanStatus !== "inprogress" && (
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
                virtualItem,
              }) => {
                return (
                  <Timeline.Row
                    key={index}
                    className={cn(
                      "group flex h-8 items-center",
                      state.selected
                        ? "bg-muted hover:bg-muted/90"
                        : "bg-transparent hover:bg-muted"
                    )}
                    // onMouseOver={() => console.log(`hover ${index}`)}
                    onClick={(e) => {
                      toggleNodeSelection(node.id);
                    }}
                  >
                    {node.data.level === "TRACE" ? (
                      <SpanWithDuration
                        showDuration={state.selected ? true : showDurations}
                        startMs={node.data.offset}
                        durationMs={
                          node.data.duration
                            ? node.data.duration
                            : duration - node.data.offset
                        }
                        node={node}
                      />
                    ) : (
                      <Timeline.Point ms={node.data.offset}>
                        {(ms) => (
                          <motion.div
                            className={cn(
                              "-ml-1 h-3 w-3 rounded-full",
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
  const className = "truncate";
  return (
    <Paragraph variant="small" className={cn(className)}>
      <SpanTitle {...node.data} size="small" />
    </Paragraph>
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
          Canceled
        </Paragraph>
        <GanttTaskStatusIcon status="CANCELED" className={cn("w-4 h-4")} />
      </>
    );
  }

  if (node.data.isError) {
    return (
      <GanttTaskStatusIcon
        status="COMPLETED_WITH_ERRORS"
        className={cn("w-4 h-4")}
      />
    );
  }

  if (node.data.isPartial) {
    return (
      <GanttTaskStatusIcon status={"EXECUTING"} className={cn("w-4 h-4")} />
    );
  }

  return (
    <GanttTaskStatusIcon
      status="COMPLETED_SUCCESSFULLY"
      className={cn("w-4 h-4")}
    />
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
          Show parent items
        </Paragraph>
      </Link>
    </Button>
  );
}

function LiveReloadingStatus({
  rootSpanCompleted,
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
        Live reloading
      </Paragraph>
    </div>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span
        className={`absolute h-full w-full animate-ping rounded-full border border-emerald-500 opacity-100 duration-1000`}
      />
      <span className={`h-2 w-2 rounded-full bg-emerald-500`} />
    </span>
  );
}

function SpanWithDuration({
  showDuration,
  node,
  ...props
}: Timeline.SpanProps & { node: GanttEvent; showDuration: boolean }) {
  return (
    <Timeline.Span {...props}>
      <motion.div
        className={cn(
          "relative flex h-4 w-full min-w-[2px] items-center rounded-sm",
          eventBackgroundClassName(node.data)
        )}
        layoutId={node.id}
      >
        {node.data.isPartial && (
          <div
            className="absolute left-0 top-0 h-full w-full animate-tile-scroll rounded-sm opacity-30"
            style={{
              backgroundImage: `url(${tileBgPath})`,
              backgroundSize: "8px 8px",
            }}
          />
        )}
        <div
          className={cn(
            "sticky left-0 z-10 transition group-hover:opacity-100",
            !showDuration && "opacity-0"
          )}
        >
          <div className="rounded-sm px-1 py-0.5 text-xxs text-foreground">
            {formatDurationMilliseconds(props.durationMs, {
              style: "short",
              maxDecimalPoints: props.durationMs < 1000 ? 0 : 1,
            })}
          </div>
        </div>
      </motion.div>
    </Timeline.Span>
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
                className="absolute w-fit whitespace-nowrap rounded-sm border border-border bg-gray-700 px-1 py-0.5 text-xxs tabular-nums text-text-bright"
                style={{
                  left: `${offset * 100}%`,
                  transform: `translateX(-${offset * 100}%)`,
                }}
              >
                {formatDurationMilliseconds(ms, {
                  style: "short",
                  maxDecimalPoints: ms < 1000 ? 0 : 1,
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
  setShowDurations,
}: {
  expandAllBelowDepth: (depth: number) => void;
  collapseAllBelowDepth: (depth: number) => void;
  toggleExpandLevel: (depth: number) => void;
  setShowDurations: (show: (show: boolean) => boolean) => void;
}) {
  return (
    <>
      <ArrowKeyShortcuts />
      <ShortcutWithAction
        shortcut={{ key: "e" }}
        action={() => expandAllBelowDepth(0)}
        title="Expand all"
      />
      <ShortcutWithAction
        shortcut={{ key: "c" }}
        action={() => collapseAllBelowDepth(1)}
        title="Collapse all"
      />
      <NumberShortcuts toggleLevel={(number) => toggleExpandLevel(number)} />
      <ShortcutWithAction
        shortcut={{ key: "d" }}
        action={() => setShowDurations((d) => !d)}
        title="Toggle durations"
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
        Navigate
      </Paragraph>
    </div>
  );
}

function ShortcutWithAction({
  shortcut,
  title,
  action,
}: {
  shortcut: Shortcut;
  title: string;
  action: () => void;
}) {
  useShortcutKeys({
    shortcut,
    action,
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
  toggleLevel,
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
        Toggle level
      </Paragraph>
    </div>
  );
}

function SearchField({ onChange }: { onChange: (value: string) => void }) {
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
        placeholder="Search Job"
        value={value}
        onChange={(e) => updateValue(e.target.value)}
      />
    </InputGroup>
  );
}
