// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { equals, formatDate, formatDurationHours } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { LuClock, LuLock, LuX } from "react-icons/lu";
import { cn } from "../utils/cn";
import {
  fillToPointer,
  HOUR_STEP,
  MAX_DAY_HOURS,
  snapHours,
  stackDay
} from "./layout";
import type { WeekHoursTone } from "./tones";

/** One charge number of the week: what its bars are labelled and colored. */
export type WeekHoursRow = {
  key: string;
  /** The short id on its bars ("OB2-6"). */
  label: string;
  /** Read to a screen reader with the hours. */
  title: string;
  tone: WeekHoursTone;
};

export type WeekHoursChartProps = {
  /** The week's days, "YYYY-MM-DD", Monday first. */
  days: string[];
  /** Boxed in the header. */
  today?: string | null;
  /** The header's lock icon: a day the selected row cannot take time on. */
  isDayLocked?: (day: string) => boolean;
  rows: WeekHoursRow[];
  /** The row a click in an empty part of a day gives time to. */
  selectedKey: string | null;
  hoursOf: (rowKey: string, day: string) => number;
  /** When the cell's time was entered: a day stacks its bars in that order. */
  enteredAt: (rowKey: string, day: string) => string | null;
  isEditable: (rowKey: string, day: string) => boolean;
  /** Clock time per day from the timecards, shown under the day's hours. */
  clockedHours?: Record<string, number>;
  /** Hours as a number ("7.5"), in the app's quantity format. */
  formatHours: (hours: number) => string;
  /** Extra controls at a bar's top right: its status, history, menu. */
  renderBarAccessory?: (rowKey: string, day: string) => ReactNode;
  onSelect: (rowKey: string) => void;
  /** A bar's new hours, after a click, a drag, a key or ×. 0 deletes it. */
  onCommit: (rowKey: string, day: string, hours: number) => void;
  /** "lg" for touch: taller hours and a larger drag handle (the MES). */
  size?: "md" | "lg";
};

/** Clock time as hours and minutes ("8h, 32m"), never a long decimal. */
const formatClocked = (hours: number) =>
  formatDurationHours(hours, { style: "short", units: ["h", "m"] });

/**
 * A week of time as stacked bars, one column per day on a 0–24 h scale (the
 * chart scrolls). Each row's time on a day is a bar as tall as its hours,
 * stacked in the order the time was entered, so new time lands at the
 * bottom. A click below a day's bars gives the selected row time up to the
 * click (a dashed preview follows the pointer); dragging a bar's lower edge,
 * or the arrow keys on it, change its hours in half-hour steps; × or Delete
 * sets 0. The chart only reports a change (`onCommit`): the caller saves it.
 *
 * Used by My Time in the ERP and the MES.
 */
export function WeekHoursChart({
  days,
  today = null,
  isDayLocked,
  rows,
  selectedKey,
  hoursOf,
  enteredAt,
  isEditable,
  clockedHours = {},
  formatHours,
  renderBarAccessory,
  onSelect,
  onCommit,
  size = "md"
}: WeekHoursChartProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const hourPx = size === "lg" ? 48 : 40;
  // The one day under the pointer: one preview for the whole week.
  const [hover, setHover] = useState<{ day: string; hours: number } | null>(
    null
  );
  // The bar being dragged, with the hours under the pointer.
  const [dragging, setDragging] = useState<{
    rowKey: string;
    day: string;
    hours: number;
  } | null>(null);

  const shownHours = (rowKey: string, day: string) =>
    dragging?.rowKey === rowKey && dragging.day === day
      ? dragging.hours
      : hoursOf(rowKey, day);
  const dayTotals = days.map((day) =>
    rows.reduce((sum, row) => sum + shownHours(row.key, day), 0)
  );
  const hasClocked = Object.values(clockedHours).some((hours) => hours > 0);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* The page's own color: the dates sit on it, and bars scroll under. */}
      <div className="sticky top-0 z-10 flex border-b border-border bg-card">
        <div className="w-14 shrink-0" />
        {days.map((day, index) => {
          const locked = isDayLocked?.(day) ?? false;
          const clocked = clockedHours[day] ?? 0;
          return (
            <div
              key={day}
              className={cn(
                "m-1.5 flex min-w-24 flex-1 flex-col items-center gap-0.5 rounded-lg border border-transparent py-2",
                day === today && "border-border"
              )}
            >
              <span
                className={cn(
                  "text-4xl font-semibold tracking-tight tabular-nums",
                  locked && "text-muted-foreground"
                )}
              >
                {formatDate(day, { day: "numeric" }, locale)}
              </span>
              <span
                className={cn(
                  "flex items-center gap-1 text-xs text-muted-foreground",
                  day === today && "font-medium text-primary"
                )}
              >
                {formatDate(day, { weekday: "short" }, locale)}
                {locked && <LuLock className="size-3" />}
              </span>
              <span className="text-xs tabular-nums">
                {t`${formatHours(dayTotals[index] ?? 0)} h`}
              </span>
              {/* The timecard's clock time, as a duration: it is not part of
                  the day's hours above it. */}
              {hasClocked && clocked > 0 && (
                <span
                  className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
                  title={t`Clocked on your timecard`}
                >
                  <LuClock className="size-3" />
                  {formatClocked(clocked)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-1 pt-3" onPointerLeave={() => setHover(null)}>
        <div
          className="relative w-14 shrink-0"
          style={{ height: MAX_DAY_HOURS * hourPx }}
        >
          {Array.from({ length: MAX_DAY_HOURS + 1 }, (_, hour) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
              style={{ top: hour * hourPx }}
            >
              {t`${hour} h`}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <DayColumn
            key={day}
            day={day}
            rows={rows}
            selected={selected}
            hourPx={hourPx}
            size={size}
            shownHours={shownHours}
            enteredAt={enteredAt}
            isEditable={isEditable}
            formatHours={formatHours}
            renderBarAccessory={renderBarAccessory}
            pointerHours={hover?.day === day ? hover.hours : null}
            onHover={(hours) =>
              setHover(hours === null ? null : { day, hours })
            }
            onSelect={onSelect}
            onDrag={(rowKey, hours) =>
              setDragging(hours === null ? null : { rowKey, day, hours })
            }
            onCommit={(rowKey, hours) => onCommit(rowKey, day, hours)}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  rows,
  selected,
  hourPx,
  size,
  shownHours,
  enteredAt,
  isEditable,
  formatHours,
  renderBarAccessory,
  pointerHours,
  onHover,
  onSelect,
  onDrag,
  onCommit
}: {
  day: string;
  rows: WeekHoursRow[];
  selected: WeekHoursRow | null;
  hourPx: number;
  size: "md" | "lg";
  shownHours: (rowKey: string, day: string) => number;
  enteredAt: (rowKey: string, day: string) => string | null;
  isEditable: (rowKey: string, day: string) => boolean;
  formatHours: (hours: number) => string;
  renderBarAccessory?: (rowKey: string, day: string) => ReactNode;
  pointerHours: number | null;
  onHover: (hours: number | null) => void;
  onSelect: (rowKey: string) => void;
  onDrag: (rowKey: string, hours: number | null) => void;
  onCommit: (rowKey: string, hours: number) => void;
}) {
  const { t } = useLingui();
  const { bars, total } = stackDay(
    rows.map((row) => ({
      key: row.key,
      hours: shownHours(row.key, day),
      enteredAt: enteredAt(row.key, day)
    }))
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const canAdd = selected !== null && isEditable(selected.key, day);
  const selectedHours = selected ? shownHours(selected.key, day) : 0;
  const others = total - selectedHours;
  const hoursAt = (event: ReactPointerEvent<HTMLDivElement>) =>
    (event.clientY - event.currentTarget.getBoundingClientRect().top) / hourPx;
  const preview =
    canAdd && pointerHours !== null && pointerHours > total
      ? fillToPointer({ pointerHours, others, current: selectedHours })
      : null;

  return (
    <div
      className={cn(
        "relative min-w-24 flex-1 border-l border-border",
        canAdd ? "cursor-pointer" : "cursor-not-allowed"
      )}
      style={{
        height: MAX_DAY_HOURS * hourPx,
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px), hsl(var(--border)) calc(var(--hour) - 1px), hsl(var(--border)) var(--hour))",
        ["--hour" as string]: `${hourPx}px`
      }}
      onPointerMove={(event) => onHover(hoursAt(event))}
      onClick={(event) => {
        if (!canAdd || !selected) return;
        const at =
          (event.clientY - event.currentTarget.getBoundingClientRect().top) /
          hourPx;
        if (at <= total) return;
        onCommit(
          selected.key,
          fillToPointer({ pointerHours: at, others, current: selectedHours })
        );
      }}
    >
      {preview !== null && selected && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-1.5 flex items-center justify-center rounded-md border border-dashed text-xs tabular-nums",
            selected.tone.bar
          )}
          style={{
            top: total * hourPx,
            height: Math.max(preview - selectedHours, HOUR_STEP) * hourPx
          }}
        >
          {t`+${formatHours(preview - selectedHours)} h`}
        </div>
      )}
      {bars.map((bar) => {
        const row = byKey.get(bar.key)!;
        return (
          <WeekBar
            key={bar.key}
            row={row}
            start={bar.start}
            hours={bar.hours}
            maxHours={MAX_DAY_HOURS - (total - bar.hours)}
            hourPx={hourPx}
            size={size}
            isSelected={row.key === selected?.key}
            isEditable={isEditable(row.key, day)}
            formatHours={formatHours}
            accessory={renderBarAccessory?.(row.key, day)}
            onSelect={() => onSelect(row.key)}
            onDrag={(hours) => onDrag(row.key, hours)}
            onCommit={(hours) => onCommit(row.key, hours)}
          />
        );
      })}
    </div>
  );
}

function WeekBar({
  row,
  start,
  hours,
  maxHours,
  hourPx,
  size,
  isSelected,
  isEditable,
  formatHours,
  accessory,
  onSelect,
  onDrag,
  onCommit
}: {
  row: WeekHoursRow;
  start: number;
  hours: number;
  maxHours: number;
  hourPx: number;
  size: "md" | "lg";
  isSelected: boolean;
  isEditable: boolean;
  formatHours: (hours: number) => string;
  accessory?: ReactNode;
  onSelect: () => void;
  onDrag: (hours: number | null) => void;
  onCommit: (hours: number) => void;
}) {
  const { t } = useLingui();
  const drag = useRef<{ startY: number; base: number; last: number } | null>(
    null
  );
  const height = hours * hourPx;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, base: hours, last: hours };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = snapHours(
      drag.current.base + (event.clientY - drag.current.startY) / hourPx,
      maxHours
    );
    drag.current.last = next;
    onDrag(next);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { last, base } = drag.current;
    drag.current = null;
    onDrag(null);
    if (!equals(last, base)) onCommit(last);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${row.label} ${row.title}`}
      aria-valuenow={hours}
      aria-valuemin={0}
      aria-valuemax={maxHours}
      aria-disabled={!isEditable}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (!isEditable) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onCommit(snapHours(hours + HOUR_STEP, maxHours));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onCommit(snapHours(hours - HOUR_STEP, maxHours));
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onCommit(0);
        }
      }}
      className={cn(
        "group absolute inset-x-1.5 flex cursor-default flex-col items-center justify-center overflow-hidden rounded-md border text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        row.tone.bar,
        isSelected && "ring-1 ring-foreground/30",
        !isEditable && "opacity-80"
      )}
      style={{ top: start * hourPx + 1, height: Math.max(height - 2, 4) }}
    >
      {height >= 44 && (
        <span className="max-w-full truncate px-1 text-[11px] text-muted-foreground tabular-nums">
          {row.label}
        </span>
      )}
      {height >= 18 && (
        <span className="font-medium tabular-nums">
          {t`${formatHours(hours)} h`}
        </span>
      )}

      <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
        {accessory}
        {isEditable && (
          <button
            type="button"
            aria-label={t`Delete`}
            className={cn(
              "rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground",
              // Touch has no hover: the × always shows there.
              size === "lg"
                ? "block"
                : "hidden group-hover:block group-focus-visible:block"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onCommit(0);
            }}
          >
            <LuX className={size === "lg" ? "size-4" : "size-3"} />
          </button>
        )}
      </div>

      {isEditable && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 cursor-ns-resize touch-none",
            size === "lg" ? "h-5" : "h-2"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(event) => event.stopPropagation()}
        >
          <span
            className={cn(
              "absolute inset-x-1/3 bottom-0.5 h-0.5 rounded-full bg-foreground/40",
              size === "lg" ? "block" : "hidden group-hover:block"
            )}
          />
        </div>
      )}
    </div>
  );
}
