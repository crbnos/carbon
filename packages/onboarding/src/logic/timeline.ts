import type { StepDef } from "../types";

// Resolves the Plan Gantt's geometry from per-company config. The template gives
// each gate a default week offset (`gantt.startWeek`/`weeks`); a per-company
// `plan.startDate` anchors those to real calendar dates, and a per-gate override
// (`plan.<stepKey>.gateDate`) moves a gate's date — which then drives its bar's
// right edge and the overall window. No start date set => relative "W1..Wn"
// mode (no calendar), so the chart still renders before anyone tailors it.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

export const PLAN_START_KEY = "plan.startDate";
export const gateDateKey = (stepKey: string) => `plan.${stepKey}.gateDate`;
// Per-company duration override (weeks) for a phase. Falls back to the template's
// `gantt.weeks`. Edited in Setup & Controls; consumed by the Plan timeline.
export const phaseWeeksKey = (stepKey: string) => `plan.${stepKey}.weeks`;

// Resolve a phase's effective duration in weeks: the per-company override if it's
// a positive number, else the template default.
export function effectivePhaseWeeks(
  step: StepDef,
  fields: Map<string, string>
): number {
  const override = Number(fields.get(phaseWeeksKey(step.key)));
  return Number.isFinite(override) && override > 0
    ? override
    : (step.gantt?.weeks ?? 0);
}

// Parse a `YYYY-MM-DD` field value to a midday-UTC Date (midday avoids DST/tz
// rollovers shifting the day). Returns null for empty/malformed input.
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, day] = m;
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(day), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// `YYYY-MM-DD` for a native <input type="date"> value.
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const addWeeks = (d: Date, weeks: number) =>
  new Date(d.getTime() + weeks * MS_PER_WEEK);
const weeksBetween = (a: Date, b: Date) =>
  (b.getTime() - a.getTime()) / MS_PER_WEEK;

export interface TimelineBar {
  key: string;
  n: number;
  title: string;
  gate: string;
  color: string;
  startPct: number; // bar left edge, % of the window
  widthPct: number; // bar width, % of the window
  gatePct: number; // gate marker, % of the window (bar right edge)
  timing: string; // display label under the bar
  gateDate: Date | null; // resolved gate date (null in relative mode)
  gateDateKey: string; // fieldKey to edit this gate's date
  gateDateValue: string | undefined; // the raw override, if any
}

export interface Timeline {
  hasDates: boolean;
  startKey: string;
  startValue: string | undefined;
  totalWeeks: number;
  ticks: { label: string; leftPct: number; dim?: boolean }[];
  bars: TimelineBar[];
}

// Pure: (tier-filtered steps, field overrides) -> render-ready geometry.
export function resolveTimeline(
  steps: StepDef[],
  fields: Map<string, string>
): Timeline {
  const geo = steps.filter((s) => s.gantt);

  // Anchor on the project start date; failing that, back-compute it from a set
  // go-live target so picking *just* the go-live date still lays out the whole
  // timeline (start = go-live − the go-live step's end week).
  let start = parseDate(fields.get(PLAN_START_KEY));
  if (!start) {
    const golive = geo.find((s) => s.key === "gate:golive");
    const goliveDate = parseDate(fields.get(gateDateKey("gate:golive")));
    if (golive?.gantt && goliveDate) {
      start = addWeeks(
        goliveDate,
        -(golive.gantt.startWeek + effectivePhaseWeeks(golive, fields))
      );
    }
  }

  // First pass: resolve each gate's start/end in WEEKS from the project start.
  // In date mode an override can push a gate past its template week.
  const resolved = geo.map((s) => {
    const g = s.gantt!;
    const startWeek = g.startWeek;
    const weeksRaw = Number(fields.get(phaseWeeksKey(s.key)));
    const weeksOverridden = Number.isFinite(weeksRaw) && weeksRaw > 0;
    const defaultEndWeek = g.startWeek + effectivePhaseWeeks(s, fields);
    const overrideValue = fields.get(gateDateKey(s.key));
    let endWeek = defaultEndWeek;
    let gateDate: Date | null = null;
    if (start) {
      const resolvedGate =
        parseDate(overrideValue) ?? addWeeks(start, defaultEndWeek);
      gateDate = resolvedGate;
      // Clamp so a gate can't land before its bar starts.
      endWeek = Math.max(startWeek + 0.25, weeksBetween(start, resolvedGate));
    }
    return { s, startWeek, endWeek, gateDate, overrideValue, weeksOverridden };
  });

  const maxWeek = resolved.reduce((m, r) => Math.max(m, r.endWeek), 8);
  // Round the window up to a whole week so the ruler ends on a tick.
  const totalWeeks = Math.max(8, Math.ceil(maxWeek));

  const bars: TimelineBar[] = resolved.map(
    ({ s, startWeek, endWeek, gateDate, overrideValue, weeksOverridden }) => {
      const startPct = (startWeek / totalWeeks) * 100;
      const gatePct = (endWeek / totalWeeks) * 100;
      const startDate = start ? addWeeks(start, startWeek) : null;
      return {
        key: s.key,
        n: s.n,
        title: s.title,
        gate: s.gate,
        color: s.gantt!.color,
        startPct,
        widthPct: Math.max(gatePct - startPct, 1.5),
        gatePct,
        // Calendar range when anchored; else the curated template label, unless a
        // staff duration override means that label is now stale — then derive it.
        timing:
          start && startDate && gateDate
            ? `${formatDate(startDate)} – ${formatDate(gateDate)}`
            : weeksOverridden
              ? `Weeks ${Math.round(startWeek) + 1} to ${Math.round(endWeek)}`
              : s.timing,
        gateDate,
        gateDateKey: gateDateKey(s.key),
        gateDateValue: overrideValue
      };
    }
  );

  // Weekly ruler ticks. Calendar dates when anchored, else "W1..Wn".
  const ticks = Array.from({ length: totalWeeks + 1 }, (_, w) => ({
    label: start ? formatDate(addWeeks(start, w)) : `W${w + 1}`,
    leftPct: (w / totalWeeks) * 100,
    dim: w === totalWeeks
  })).filter((_, w) => w < totalWeeks || start != null);

  return {
    hasDates: start != null,
    startKey: PLAN_START_KEY,
    startValue: fields.get(PLAN_START_KEY),
    totalWeeks,
    ticks,
    bars
  };
}
