/**
 * State derivation for the work center displays (`/display/:workCenterId/*`).
 *
 * These are wall-mounted screens read from across the shop floor. Each one is a
 * work center name in a full-width header band that is either green ("nothing
 * needs you") or red ("something does"), over a scoreboard body. The rules that
 * decide the colour and fill the scoreboard live here as pure functions: the
 * routes stay thin and the thresholds are unit-testable without a database.
 */

import { fromDate, getLocalTimeZone } from "@internationalized/date";

export type DisplayStatus = "ok" | "alert";

export type MaintenanceAlertReason =
  | "unplanned-downtime"
  | "planned-downtime"
  | "overdue-maintenance"
  | "overdue-schedule";

export type WorkAlertReason = "blocked" | "idle";

export type DisplayState<TReason extends string> = {
  status: DisplayStatus;
  reasons: TReason[];
};

/** Dispatch statuses that mean the work is not finished yet. */
export const openDispatchStatuses = [
  "Open",
  "Assigned",
  "In Progress"
] as const;

/**
 * `maintenanceSource` values that were not planned for. Both a reactive
 * breakdown and one raised off a non-conformance are unplanned spend, and both
 * count toward the unplanned rows on the maintenance scoreboard.
 */
export const unplannedMaintenanceSources = [
  "Reactive",
  "Non-Conformance"
] as const;

/** How far out the "due soon" row looks. Matches the reference display. */
export const DUE_SOON_DAYS = 10;

/** Lookback windows for the two unplanned-maintenance rows. */
export const UNPLANNED_COUNT_DAYS = 30;
export const UNPLANNED_COST_DAYS = 90;

export type DisplayDispatch = {
  id: string;
  maintenanceDispatchId: string | null;
  status: string | null;
  source: string | null;
  oeeImpact: string | null;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type DisplaySchedule = {
  id: string;
  name: string | null;
  frequency: string | null;
  active: boolean | null;
  nextDueAt: string | null;
};

function toTime(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPast(timestamp: string | null | undefined, now: Date): boolean {
  const parsed = toTime(timestamp);
  return parsed !== null && parsed < now.getTime();
}

function isOpen(status: string | null): boolean {
  return openDispatchStatuses.includes(
    status as (typeof openDispatchStatuses)[number]
  );
}

export function isUnplanned(source: string | null): boolean {
  return unplannedMaintenanceSources.includes(
    source as (typeof unplannedMaintenanceSources)[number]
  );
}

/**
 * The moment a dispatch is expected to be finished. Dispatches with no planned
 * end fall back to the planned start — one nobody started when they said they
 * would is equally a problem. Unscheduled reactive work has neither and is
 * surfaced by its OEE impact instead.
 */
export function getDispatchDueTime(dispatch: {
  plannedEndTime: string | null;
  plannedStartTime: string | null;
}): number | null {
  return toTime(dispatch.plannedEndTime) ?? toTime(dispatch.plannedStartTime);
}

export function isDispatchOverdue(
  dispatch: DisplayDispatch,
  now: Date
): boolean {
  if (!isOpen(dispatch.status)) return false;
  const due = getDispatchDueTime(dispatch);
  return due !== null && due < now.getTime();
}

/**
 * Red when the work center is down, or when maintenance that was promised has
 * not happened. "Due today" and "due soon" stay green and are reported as amber
 * rows on the scoreboard — a display that cries wolf gets ignored.
 */
export function getMaintenanceDisplayState(
  dispatches: DisplayDispatch[],
  schedules: DisplaySchedule[],
  now: Date = new Date()
): DisplayState<MaintenanceAlertReason> {
  const reasons: MaintenanceAlertReason[] = [];

  const inProgress = dispatches.filter((d) => d.status === "In Progress");
  if (inProgress.some((d) => d.oeeImpact === "Down")) {
    reasons.push("unplanned-downtime");
  }
  if (inProgress.some((d) => d.oeeImpact === "Planned")) {
    reasons.push("planned-downtime");
  }
  if (dispatches.some((d) => isDispatchOverdue(d, now))) {
    reasons.push("overdue-maintenance");
  }
  if (schedules.some((s) => s.active !== false && isPast(s.nextDueAt, now))) {
    reasons.push("overdue-schedule");
  }

  return { status: reasons.length > 0 ? "alert" : "ok", reasons };
}

/**
 * Red when nothing is running. Maintenance blocking the work center is reported
 * ahead of plain idleness so the display names the actual cause rather than its
 * symptom.
 */
export function getWorkDisplayState(args: {
  activeEventCount: number;
  isBlocked: boolean;
}): DisplayState<WorkAlertReason> {
  const reasons: WorkAlertReason[] = [];

  if (args.isBlocked) reasons.push("blocked");
  if (args.activeEventCount === 0) reasons.push("idle");

  return { status: reasons.length > 0 ? "alert" : "ok", reasons };
}

function startOfDay(now: Date, timeZone: string = getLocalTimeZone()): number {
  return fromDate(now, timeZone)
    .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
    .toDate()
    .getTime();
}

function endOfDay(now: Date, timeZone: string = getLocalTimeZone()): number {
  return fromDate(now, timeZone)
    .set({ hour: 23, minute: 59, second: 59, millisecond: 999 })
    .toDate()
    .getTime();
}

function daysAgo(now: Date, days: number): number {
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

export type MaintenanceScoreboard = {
  overdue: { count: number; ids: string[] };
  dueToday: { count: number };
  dueSoon: { count: number; days: number };
  downNow: { active: boolean; dispatchId: string | null };
  unplannedCount: { count: number; days: number };
  unplannedCost: { total: number; days: number };
  lastCompleted: { completedAt: string | null; by: string | null };
};

/**
 * Everything the maintenance scoreboard renders, computed in one pass so the
 * component holds no logic.
 *
 * Overdue and due-soon counts merge two sources: dispatches that already exist
 * (someone has cut the work order) and schedules whose `nextDueAt` has come
 * around without one. Counting only dispatches would let a lapsed schedule sit
 * invisible; counting only schedules would miss ad-hoc planned work.
 */
export function getMaintenanceScoreboard(args: {
  dispatches: DisplayDispatch[];
  schedules: DisplaySchedule[];
  unplannedCost: number;
  lastCompleted: { completedAt: string | null; by: string | null };
  now?: Date;
  /**
   * The work center's location timezone. Day rows ("due today" / "due soon")
   * are computed from calendar days in this zone so they match the shop floor
   * rather than the server (during SSR) or a mis-set display clock. Falls back
   * to the runtime-local day when omitted.
   */
  timeZone?: string;
}): MaintenanceScoreboard {
  const { dispatches, schedules, unplannedCost, lastCompleted } = args;
  const now = args.now ?? new Date();
  const todayEnd = endOfDay(now, args.timeZone);
  const todayStart = startOfDay(now, args.timeZone);
  const soonEnd = now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;

  const openDispatches = dispatches.filter((d) => isOpen(d.status));
  const activeSchedules = schedules.filter((s) => s.active !== false);

  const overdueDispatches = openDispatches.filter((d) =>
    isDispatchOverdue(d, now)
  );
  const overdueSchedules = activeSchedules.filter((s) =>
    isPast(s.nextDueAt, now)
  );

  const dueBetween = (from: number, to: number) => {
    const d = openDispatches.filter((dispatch) => {
      const due = getDispatchDueTime(dispatch);
      return due !== null && due >= from && due <= to;
    }).length;
    const s = activeSchedules.filter((schedule) => {
      const due = toTime(schedule.nextDueAt);
      return due !== null && due >= from && due <= to;
    }).length;
    return d + s;
  };

  const down = dispatches.find(
    (d) =>
      d.status === "In Progress" &&
      (d.oeeImpact === "Down" || d.oeeImpact === "Planned")
  );

  const unplannedSince = daysAgo(now, UNPLANNED_COUNT_DAYS);
  const unplannedCount = dispatches.filter((d) => {
    if (!isUnplanned(d.source)) return false;
    const at = toTime(d.createdAt);
    return at !== null && at >= unplannedSince;
  }).length;

  return {
    overdue: {
      count: overdueDispatches.length + overdueSchedules.length,
      ids: overdueDispatches
        .map((d) => d.maintenanceDispatchId)
        .filter((id): id is string => Boolean(id))
    },
    // "Due today" excludes anything already overdue — those have their own row,
    // and double-counting would make the board read worse than reality.
    dueToday: {
      count: dueBetween(Math.max(todayStart, now.getTime()), todayEnd)
    },
    dueSoon: { count: dueBetween(todayEnd, soonEnd), days: DUE_SOON_DAYS },
    downNow: {
      active: Boolean(down),
      dispatchId: down?.maintenanceDispatchId ?? null
    },
    unplannedCount: { count: unplannedCount, days: UNPLANNED_COUNT_DAYS },
    unplannedCost: { total: unplannedCost, days: UNPLANNED_COST_DAYS },
    lastCompleted
  };
}

/**
 * Elapsed time as zero-padded `HH:MM:SS`. Wall displays tick every second, so
 * the digits must not reflow — the eye reads position, not text.
 */
export function formatElapsed(
  startTime: string,
  now: Date = new Date()
): string {
  const started = toTime(startTime);
  if (started === null) return "--:--:--";

  const totalSeconds = Math.max(
    0,
    Math.floor((now.getTime() - started) / 1000)
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Coarse "when" label for scheduled work. Deliberately low precision: at
 * reading distance "in 3d" beats a timestamp.
 */
export function formatRelativeDue(
  timestamp: string | null,
  now: Date = new Date()
): string | null {
  const due = toTime(timestamp);
  if (due === null) return null;

  const diffMs = due - now.getTime();
  const overdue = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60000);

  if (minutes < 1) return "now";

  const value = (() => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 14) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
  })();

  return overdue ? `${value} overdue` : `in ${value}`;
}

/** Initials for the "By?" cell — a wall display has room for two characters. */
export function getInitials(fullName: string | null): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

/** Completion ratio clamped to 0–1, guarding the zero-quantity operation. */
export function getProgress(
  quantityComplete: number | null | undefined,
  operationQuantity: number | null | undefined
): number | null {
  if (!operationQuantity || operationQuantity <= 0) return null;
  return Math.min(1, Math.max(0, (quantityComplete ?? 0) / operationQuantity));
}
