// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Progress,
  Status,
  Tabs,
  TabsList,
  TabsTrigger,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowDownWideNarrow,
  LuArrowUpNarrowWide,
  LuCircleCheck,
  LuCircleDashed,
  LuCircleDot,
  LuEllipsis,
  LuMaximize2,
  LuPencil,
  LuPlus,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useSearchParams } from "react-router";
import { ReadOnlyField, ReadOnlyFields } from "~/components";
import Empty from "~/components/Empty";
import Confirm from "~/components/Modals/Confirm/Confirm";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useQuantityFormatter
} from "~/hooks";
import type {
  BurnPoint,
  MilestoneGroup,
  MilestoneSummary
} from "../../projects.models";
import type { ProjectMilestone } from "../../types";
import { dayIndex } from "../Elements/timeline-geometry";
import { MilestoneBurnChart } from "./MilestoneBurnChart";
import MilestoneForm from "./MilestoneForm";
import {
  SCHEDULE_DAY_WIDTH,
  type ScheduleScale,
  type ScheduleSpan,
  scheduleBar,
  scheduleLayout,
  scheduleScales,
  spanHolds
} from "./schedule-scale";

type Milestone = MilestoneSummary<ProjectMilestone>;

type MilestoneScheduleProps = {
  milestones: Milestone[];
  action: string;
  isDisabled: boolean;
  /** Today on the company calendar. */
  today: string;
  /** The milestone open in the drawer, with its burn. */
  selected: {
    milestoneId: string;
    plannedHours: number;
    series: BurnPoint[];
  } | null;
  onSelect: (milestoneId: string | null) => void;
};

type EditingMilestone = {
  id?: string;
  name: string;
  startDate?: string;
  endDate?: string;
};

const ROW_HEIGHT = 60;
const GROUP_ROW_HEIGHT = 40;
const COLUMN_ROW_HEIGHT = 32;
const HEADER_HEIGHT = GROUP_ROW_HEIGHT + COLUMN_ROW_HEIGHT;
const MIN_BAR_WIDTH = 8;

const statusColors: Record<MilestoneGroup, "blue" | "gray" | "green"> = {
  Active: "blue",
  Upcoming: "gray",
  Completed: "green"
};

const barColors: Record<MilestoneGroup, string> = {
  Active: "bg-blue-100 hover:bg-blue-200/80 dark:bg-blue-500/20",
  Upcoming: "bg-muted hover:bg-accent",
  Completed: "bg-emerald-100 hover:bg-emerald-200/80 dark:bg-emerald-500/20"
};

function StatusIcon({ group }: { group: MilestoneGroup }) {
  const Icon =
    group === "Completed"
      ? LuCircleCheck
      : group === "Active"
        ? LuCircleDot
        : LuCircleDashed;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
      <Icon
        aria-hidden
        className={cn(
          "size-4",
          group === "Completed" && "text-emerald-600 dark:text-emerald-400",
          group === "Active" && "text-blue-600 dark:text-blue-400",
          group === "Upcoming" && "text-muted-foreground"
        )}
      />
    </span>
  );
}

/** The width in pixels of the timeline pane, read as it resizes. */
function usePaneWidth() {
  // A callback ref: the pane mounts only once a milestone exists.
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!pane) return;
    const observer = new ResizeObserver(() => setWidth(pane.clientWidth));
    observer.observe(pane);
    return () => observer.disconnect();
  }, [pane]);
  return [pane, setPane, width] as const;
}

/**
 * The project Schedule page: one toolbar row (Today, the Weekly / Monthly /
 * Quarterly scale, New Milestone), then two aligned panes. The left pane
 * lists the milestones; the right pane draws each one's bar on the same row,
 * under a period header with the current period tinted. A row or a bar
 * opens the milestone's drawer: its dates, progress, hours, cost, burn and
 * actions.
 */
export default function MilestoneSchedule({
  milestones,
  action,
  isDisabled,
  today,
  selected,
  onSelect
}: MilestoneScheduleProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects") && !isDisabled;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<EditingMilestone | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const deleteDisclosure = useDisclosure();
  const [descending, setDescending] = useState(false);
  const [pane, setPane, paneWidth] = usePaneWidth();

  const scaleParam = searchParams.get("scale");
  const scale: ScheduleScale = scheduleScales.includes(
    scaleParam as ScheduleScale
  )
    ? (scaleParam as ScheduleScale)
    : "month";
  const dayWidth = SCHEDULE_DAY_WIDTH[scale];

  const scaleLabels: Record<ScheduleScale, string> = {
    week: t`Weekly`,
    month: t`Monthly`,
    quarter: t`Quarterly`
  };
  const groupLabels: Record<MilestoneGroup, string> = {
    Active: t`Active`,
    Upcoming: t`Upcoming`,
    Completed: t`Completed`
  };

  const rows = useMemo(() => {
    // Undated milestones last, whichever way the list is sorted.
    const dated = milestones.filter((m) => m.startDate ?? m.endDate);
    const undated = milestones.filter((m) => !(m.startDate ?? m.endDate));
    const key = (m: Milestone) => (m.startDate ?? m.endDate)!;
    dated.sort((a, b) =>
      descending ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))
    );
    return [...dated, ...undated];
  }, [milestones, descending]);

  const layout = useMemo(
    () =>
      scheduleLayout(
        milestones.flatMap((m) => [m.startDate, m.endDate]),
        today,
        scale,
        Math.ceil(paneWidth / dayWidth)
      ),
    [milestones, today, scale, paneWidth, dayWidth]
  );
  const width = layout.days * dayWidth;
  const x = useCallback(
    (date: string) => dayIndex(date, layout.start) * dayWidth,
    [layout.start, dayWidth]
  );
  const currentColumn = layout.columns.find((c) => spanHolds(c, today));
  const spanWidth = (span: ScheduleSpan) =>
    (dayIndex(span.end, span.start) + 1) * dayWidth;

  const scrollToToday = useCallback(() => {
    if (!pane) return;
    pane.scrollTo({
      left: Math.max(x(today) - pane.clientWidth / 4, 0),
      behavior: "smooth"
    });
  }, [pane, x, today]);

  // Open at today once the pane has a width, and again when the scale
  // changes. Before the panels lay out, the pane has no width to scroll.
  // It starts at the earliest bar when today's period still fits in view,
  // else it puts today a quarter of the way in.
  const scrolledScale = useRef<ScheduleScale | null>(null);
  useEffect(() => {
    if (!pane || paneWidth === 0 || scrolledScale.current === scale) return;
    scrolledScale.current = scale;
    const todayX = x(today);
    const earliest = milestones
      .map((m) => m.startDate ?? m.endDate)
      .filter((date): date is string => !!date)
      .sort()[0];
    const earliestX = earliest ? x(earliest) - 24 : todayX;
    const currentEnd = currentColumn ? x(currentColumn.end) + dayWidth : todayX;
    pane.scrollLeft = Math.max(
      currentEnd - earliestX <= pane.clientWidth
        ? earliestX
        : todayX - pane.clientWidth / 4,
      0
    );
  }, [pane, paneWidth, scale, x, today, milestones, currentColumn, dayWidth]);

  const groupLabel = (span: ScheduleSpan) => {
    if (scale === "week") {
      return formatDate(span.start, { month: "long", year: "numeric" }, locale);
    }
    if (scale === "quarter") {
      return formatDate(span.start, { year: "numeric" }, locale);
    }
    const from = formatDate(span.start, { month: "short" }, locale);
    const to = formatDate(
      span.end,
      { month: "short", year: "numeric" },
      locale
    );
    return t`${from} – ${to}`;
  };
  const columnLabel = (span: ScheduleSpan) => {
    if (scale === "week") {
      return formatDate(span.start, { month: "short", day: "numeric" }, locale);
    }
    if (scale === "month") {
      return formatDate(span.start, { month: "short" }, locale);
    }
    const quarterNumber = Math.floor((parseDate(span.start).month - 1) / 3) + 1;
    return t`Q${quarterNumber}`;
  };

  const setCompleted = (milestone: Milestone, completed: boolean) =>
    fetcher.submit(
      { intent: completed ? "complete" : "reopen", id: milestone.id },
      { method: "post", action }
    );
  const edit = (milestone: Milestone) =>
    setEditing({
      id: milestone.id,
      name: milestone.name,
      startDate: milestone.startDate ?? undefined,
      endDate: milestone.endDate ?? undefined
    });
  const askDelete = (milestone: Milestone) => {
    setDeleting(milestone);
    deleteDisclosure.onOpen();
  };

  const open = milestones.find((m) => m.id === selected?.milestoneId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Button
          variant="secondary"
          isDisabled={milestones.length === 0}
          onClick={scrollToToday}
        >
          <Trans>Today</Trans>
        </Button>
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <Tabs
          value={scale}
          onValueChange={(next) => {
            const params = new URLSearchParams(searchParams);
            params.set("scale", next);
            setSearchParams(params, {
              replace: true,
              preventScrollReset: true
            });
          }}
        >
          <TabsList aria-label={t`Scale`}>
            {scheduleScales.map((value) => (
              <TabsTrigger key={value} value={value}>
                {scaleLabels[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        <Button
          leftIcon={<LuPlus />}
          isDisabled={!canUpdate}
          onClick={() => setEditing({ name: "" })}
        >
          <Trans>New Milestone</Trans>
        </Button>
      </div>

      {milestones.length === 0 ? (
        <Empty
          title={<Trans>No milestones yet</Trans>}
          description={
            <Trans>Add one, then set it on the elements it covers.</Trans>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="w-80 shrink-0 border-r border-border">
            <div
              className="flex items-center gap-2 border-b border-border px-4"
              style={{ height: HEADER_HEIGHT }}
            >
              <span className="text-sm font-medium">
                <Trans>Milestones</Trans>
              </span>
              <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                {milestones.length}
              </span>
              <div className="flex-1" />
              <IconButton
                aria-label={
                  descending ? t`Sort earliest first` : t`Sort latest first`
                }
                icon={
                  descending ? (
                    <LuArrowUpNarrowWide />
                  ) : (
                    <LuArrowDownWideNarrow />
                  )
                }
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setDescending((value) => !value)}
              />
            </div>
            {rows.map((milestone) => (
              <div
                key={milestone.id}
                className={cn(
                  "group/row relative flex items-center hover:bg-accent/50",
                  milestone.id === open?.id && "bg-accent/50"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-3 pl-4 pr-12 text-left"
                  onClick={() => onSelect(milestone.id)}
                >
                  <StatusIcon group={milestone.group} />
                  <span className="truncate text-sm">{milestone.name}</span>
                </button>
                <div className="absolute right-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label={t`More options for ${milestone.name}`}
                        icon={<LuEllipsis />}
                        variant="ghost"
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => onSelect(milestone.id)}>
                        <DropdownMenuIcon icon={<LuMaximize2 />} />
                        <Trans>Open</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canUpdate}
                        onClick={() => edit(milestone)}
                      >
                        <DropdownMenuIcon icon={<LuPencil />} />
                        <Trans>Edit</Trans>
                      </DropdownMenuItem>
                      {milestone.group === "Completed" ? (
                        <DropdownMenuItem
                          disabled={!canUpdate}
                          onClick={() => setCompleted(milestone, false)}
                        >
                          <DropdownMenuIcon icon={<LuRotateCcw />} />
                          <Trans>Reopen</Trans>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          disabled={!canUpdate}
                          onClick={() => setCompleted(milestone, true)}
                        >
                          <DropdownMenuIcon icon={<LuCircleCheck />} />
                          <Trans>Complete</Trans>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        disabled={!canUpdate}
                        onClick={() => askDelete(milestone)}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>

          <div ref={setPane} className="min-w-0 flex-1 overflow-x-auto">
            <div
              className="relative flex min-h-full flex-col"
              style={{ width }}
            >
              {/* The current period's column, tinted for the whole height. */}
              {currentColumn && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 bg-blue-500/5"
                  style={{
                    left: x(currentColumn.start),
                    width: spanWidth(currentColumn)
                  }}
                />
              )}
              <div
                className="relative flex border-b border-border"
                style={{ height: GROUP_ROW_HEIGHT }}
              >
                {layout.groups.map((group, index) => (
                  <div
                    key={group.start}
                    className={cn(
                      "flex min-w-0 shrink-0 items-center gap-2 px-3",
                      index > 0 && "border-l border-border"
                    )}
                    style={{ width: spanWidth(group) }}
                  >
                    <span className="sticky left-3 truncate text-sm font-medium">
                      {groupLabel(group)}
                    </span>
                    {spanHolds(group, today) && (
                      <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                        <Trans>Current</Trans>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div
                className="relative flex border-b border-border"
                style={{ height: COLUMN_ROW_HEIGHT }}
              >
                {layout.columns.map((column) => {
                  const isCurrent = column === currentColumn;
                  return (
                    <div
                      key={column.start}
                      className="flex min-w-0 shrink-0 items-center justify-center"
                      style={{ width: spanWidth(column) }}
                    >
                      <span
                        className={cn(
                          "truncate rounded px-1.5 text-xs",
                          isCurrent
                            ? "bg-blue-600 text-white"
                            : "text-muted-foreground"
                        )}
                      >
                        {columnLabel(column)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className="relative flex-1"
                style={{ minHeight: rows.length * ROW_HEIGHT }}
              >
                {layout.columns.slice(1).map((column) => (
                  <div
                    key={column.start}
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-border/60"
                    style={{ left: x(column.start) }}
                  />
                ))}
                {rows.map((milestone, index) => {
                  const bar = scheduleBar(milestone, layout.start);
                  if (!bar) return null;
                  return (
                    <button
                      key={milestone.id}
                      type="button"
                      title={milestone.name}
                      className={cn(
                        "absolute flex h-9 items-center rounded-md px-3 text-left text-sm text-foreground transition-colors",
                        barColors[milestone.group]
                      )}
                      style={{
                        left: bar.offset * dayWidth,
                        width: Math.max(bar.length * dayWidth, MIN_BAR_WIDTH),
                        top: index * ROW_HEIGHT + (ROW_HEIGHT - 36) / 2
                      }}
                      onClick={() => onSelect(milestone.id)}
                    >
                      {/* Sticky: a bar that starts off-screen keeps its name
                          readable at the pane's left edge. */}
                      <span className="sticky left-3 truncate">
                        {milestone.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <MilestoneDrawer
          milestone={open}
          statusLabel={groupLabels[open.group]}
          burn={
            selected ? (
              <MilestoneBurnChart
                series={selected.series}
                plannedHours={selected.plannedHours}
                today={today}
              />
            ) : null
          }
          canUpdate={canUpdate}
          onClose={() => onSelect(null)}
          onEdit={() => edit(open)}
          onComplete={(completed) => setCompleted(open, completed)}
          onDelete={() => askDelete(open)}
        />
      )}

      {editing && (
        <MilestoneForm
          action={action}
          initialValues={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteDisclosure.isOpen && deleting && (
        <Confirm
          action={action}
          title={t`Delete ${deleting.name}`}
          text={t`Delete the milestone ${deleting.name}? Its elements stay, without a milestone.`}
          confirmText={t`Delete`}
          confirmVariant="destructive"
          onCancel={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
            if (deleting.id === open?.id) onSelect(null);
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={deleting.id} />
        </Confirm>
      )}
    </div>
  );
}

/** One milestone's details: status, dates, progress, hours, cost, burn and actions. */
function MilestoneDrawer({
  milestone,
  statusLabel,
  burn,
  canUpdate,
  onClose,
  onEdit,
  onComplete,
  onDelete
}: {
  milestone: Milestone;
  statusLabel: string;
  burn: ReactNode;
  canUpdate: boolean;
  onClose: () => void;
  onEdit: () => void;
  onComplete: (completed: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const isCompleted = milestone.group === "Completed";

  return (
    <Drawer
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <div className="flex min-w-0 items-center gap-2">
            <DrawerTitle className="truncate">{milestone.name}</DrawerTitle>
            <Status color={statusColors[milestone.group]}>{statusLabel}</Status>
          </div>
        </DrawerHeader>
        <DrawerBody>
          <div className="flex w-full flex-col gap-6">
            <ReadOnlyFields>
              <ReadOnlyField label={t`Start`}>
                {milestone.startDate ? formatDate(milestone.startDate) : null}
              </ReadOnlyField>
              <ReadOnlyField label={t`End`}>
                {milestone.endDate ? (
                  <span className={cn(milestone.isOverdue && "text-red-500")}>
                    {formatDate(milestone.endDate)}
                  </span>
                ) : null}
              </ReadOnlyField>
              <ReadOnlyField label={t`Elements completed`}>
                <div className="flex items-center gap-2">
                  <Progress
                    value={
                      milestone.elementCount > 0
                        ? (milestone.completedCount / milestone.elementCount) *
                          100
                        : 0
                    }
                    aria-label={t`Elements completed`}
                    className="h-1.5 min-w-0 flex-1"
                    indicatorClassName="bg-foreground/70"
                  />
                  <span className="shrink-0 tabular-nums">
                    {milestone.completedCount}/{milestone.elementCount}
                  </span>
                </div>
              </ReadOnlyField>
              <ReadOnlyField label={t`Hours`}>
                <span className="tabular-nums">
                  {formatQuantity(milestone.actualHours)} /{" "}
                  {formatQuantity(milestone.estimatedHours)}
                </span>
              </ReadOnlyField>
              <ReadOnlyField label={t`Cost`}>
                <span
                  className={cn(
                    "tabular-nums",
                    milestone.budget > 0 &&
                      milestone.actualCost > milestone.budget &&
                      "text-red-500"
                  )}
                >
                  {formatMoney.format(milestone.actualCost)} /{" "}
                  {milestone.budget > 0
                    ? formatMoney.format(milestone.budget)
                    : "—"}
                </span>
              </ReadOnlyField>
            </ReadOnlyFields>
            {burn}
          </div>
        </DrawerBody>
        <DrawerFooter>
          <HStack className="w-full justify-between">
            <Button
              variant="ghost"
              leftIcon={<LuTrash />}
              isDisabled={!canUpdate}
              onClick={onDelete}
            >
              <Trans>Delete</Trans>
            </Button>
            <HStack>
              <Button
                variant="secondary"
                leftIcon={<LuPencil />}
                isDisabled={!canUpdate}
                onClick={onEdit}
              >
                <Trans>Edit</Trans>
              </Button>
              <Button
                variant="secondary"
                leftIcon={isCompleted ? <LuRotateCcw /> : <LuCircleCheck />}
                isDisabled={!canUpdate}
                onClick={() => onComplete(!isCompleted)}
              >
                {isCompleted ? <Trans>Reopen</Trans> : <Trans>Complete</Trans>}
              </Button>
            </HStack>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
