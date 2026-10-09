// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  getLocalTimeZone,
  parseDate,
  startOfMonth,
  startOfWeek,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { path } from "~/utils/path";
import { buildElementTree, timelineZooms } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectElementLink } from "../../types";
import { ElementTypeIcon } from "./ElementTypeIcon";
import {
  arrowPath,
  type BarRect,
  barRect,
  dayIndex,
  defaultWindow
} from "./timeline-geometry";

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 36;
const LEFT_WIDTH = 360;

export type TimelineZoom = (typeof timelineZooms)[number];

const DAY_WIDTH: Record<TimelineZoom, number> = {
  day: 40,
  week: 12,
  month: 4
};

export { timelineZooms };

type ElementTimelineProps = {
  projectId: string;
  elements: ProjectElementListItem[];
  links: ProjectElementLink[];
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
};

/**
 * The Timeline layout: the element tree on the left and one bar per element
 * from its start to its target date on the right, coloured by state, with an
 * arrow for each `precedes` link. One scroll area holds both panes, so they
 * scroll together.
 */
export function ElementTimeline({
  projectId,
  elements,
  links,
  zoom,
  onZoomChange
}: ElementTimelineProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { elementId: openElementId } = useParams();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const dayWidth = DAY_WIDTH[zoom];
  const todayDate = today(getLocalTimeZone()).toString();

  const rows = useMemo(() => {
    const tree = buildElementTree(elements);
    const hidden = new Set<string>();
    const result: typeof tree = [];
    for (const node of tree) {
      if (
        node.parentId &&
        (hidden.has(node.parentId) || collapsed.includes(node.parentId))
      ) {
        hidden.add(node.id);
        continue;
      }
      result.push(node);
    }
    return result;
  }, [elements, collapsed]);

  const range = useMemo(
    () => defaultWindow(elements, todayDate),
    [elements, todayDate]
  );
  const dayCount = dayIndex(range.end, range.start) + 1;
  const width = dayCount * dayWidth;

  const bars = useMemo(() => {
    const result = new Map<string, BarRect>();
    rows.forEach((row, index) => {
      const rect = barRect(row.data, range.start, dayWidth, index, ROW_HEIGHT);
      if (rect) result.set(row.id, rect);
    });
    return result;
  }, [rows, range.start, dayWidth]);

  const arrows = useMemo(
    () =>
      links
        .filter((link) => link.linkType === "precedes")
        .flatMap((link) => {
          const from = bars.get(link.fromElementId);
          const to = bars.get(link.toElementId);
          return from && to ? [{ id: link.id, d: arrowPath(from, to) }] : [];
        }),
    [links, bars]
  );

  // Week labels at Day and Week zoom; month labels at Month zoom.
  const ticks = useMemo(() => {
    const result: { x: number; label: string }[] = [];
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    let tick =
      zoom === "month" ? startOfMonth(start) : startOfWeek(start, "en-GB");
    while (tick.compare(end) <= 0) {
      if (tick.compare(start) >= 0) {
        result.push({
          x: dayIndex(tick.toString(), range.start) * dayWidth,
          label: formatDate(
            tick.toString(),
            zoom === "month"
              ? { month: "short", year: "numeric" }
              : { month: "short", day: "numeric" },
            locale
          )
        });
      }
      tick =
        zoom === "month" ? tick.add({ months: 1 }) : tick.add({ weeks: 1 });
    }
    return result;
  }, [range.start, range.end, zoom, dayWidth, locale]);

  const todayX =
    todayDate >= range.start && todayDate <= range.end
      ? dayIndex(todayDate, range.start) * dayWidth
      : null;

  const query = searchParams.toString();
  const elementPath = (id: string) =>
    `${path.to.projectElement(projectId, id)}${query ? `?${query}` : ""}`;

  const zoomLabels: Record<TimelineZoom, string> = {
    day: t`Day`,
    week: t`Week`,
    month: t`Month`
  };

  const toggle = (id: string) =>
    setCollapsed((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-border px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" rightIcon={<LuChevronDown />}>
              {zoomLabels[zoom]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={zoom}
              onValueChange={(next) => onZoomChange(next as TimelineZoom)}
            >
              {timelineZooms.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {zoomLabels[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Trans>No elements to show</Trans>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div
            className="relative"
            style={{
              width: LEFT_WIDTH + width,
              height: HEADER_HEIGHT + rows.length * ROW_HEIGHT
            }}
          >
            {/* The header row: sticky to the top. */}
            <div
              className="sticky top-0 z-20 flex border-b border-border bg-card"
              style={{ height: HEADER_HEIGHT }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card px-4 text-xs text-muted-foreground"
                style={{ width: LEFT_WIDTH }}
              >
                <Trans>Element</Trans>
              </div>
              <div className="relative" style={{ width }}>
                {ticks.map((tick) => (
                  <span
                    key={tick.x}
                    className="absolute top-0 flex h-full items-center border-l border-border pl-1.5 text-xs whitespace-nowrap text-muted-foreground"
                    style={{ left: tick.x }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {rows.map((row, index) => {
              const element = row.data;
              const bar = bars.get(row.id);
              const isOpen = element.id === openElementId;
              return (
                <div
                  key={row.id}
                  className={cn(
                    "absolute left-0 flex border-b border-border/60",
                    isOpen ? "bg-accent/70" : "hover:bg-accent/30"
                  )}
                  style={{
                    top: HEADER_HEIGHT + index * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    width: LEFT_WIDTH + width
                  }}
                >
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-border bg-card pr-3 text-sm"
                    style={{
                      width: LEFT_WIDTH,
                      paddingLeft: 12 + row.level * 16
                    }}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        aria-label={
                          collapsed.includes(row.id) ? t`Expand` : t`Collapse`
                        }
                        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                        onClick={() => toggle(row.id)}
                      >
                        {collapsed.includes(row.id) ? (
                          <LuChevronRight className="size-4 text-muted-foreground" />
                        ) : (
                          <LuChevronDown className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <span className="size-5 shrink-0" />
                    )}
                    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {element.readableId}
                    </span>
                    <ElementTypeIcon type={element.type} />
                    <Link
                      to={elementPath(element.id)}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {element.name}
                    </Link>
                  </div>
                  {bar && (
                    <button
                      type="button"
                      aria-label={t`Open ${element.readableId}`}
                      className="absolute rounded-md opacity-90 ring-offset-background transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                      style={{
                        left: LEFT_WIDTH + bar.x,
                        top: bar.y - index * ROW_HEIGHT,
                        width: Math.max(bar.width - 2, 4),
                        height: bar.height,
                        backgroundColor: element.state?.color ?? "#60646C"
                      }}
                      onClick={() => navigate(elementPath(element.id))}
                    />
                  )}
                </div>
              );
            })}

            {/* Today and the precedes arrows, over the bars. */}
            <svg
              aria-hidden
              className="pointer-events-none absolute z-0"
              style={{
                left: LEFT_WIDTH,
                top: HEADER_HEIGHT,
                width,
                height: rows.length * ROW_HEIGHT
              }}
            >
              <defs>
                <marker
                  id="timeline-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="hsl(var(--foreground))" />
                </marker>
              </defs>
              {todayX !== null && (
                <line
                  x1={todayX}
                  x2={todayX}
                  y1={0}
                  y2={rows.length * ROW_HEIGHT}
                  stroke="hsl(var(--primary))"
                  strokeWidth={1}
                />
              )}
              {arrows.map((arrow) => (
                <path
                  key={arrow.id}
                  d={arrow.d}
                  fill="none"
                  stroke="hsl(var(--foreground) / 0.6)"
                  strokeWidth={1.25}
                  markerEnd="url(#timeline-arrow)"
                />
              ))}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
