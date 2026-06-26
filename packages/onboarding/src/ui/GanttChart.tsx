import { cn } from "@carbon/react";
import { formatDate, resolveTimeline, type TimelineBar } from "../logic";
import type { StepDef } from "../types";
import { useCanEdit, useFieldMap } from "./state";

const LABEL_COL = "w-44"; // 176px — matches the grid overlay's left offset

// "Timeline at a glance": a read-only step-level Gantt. Its geometry is resolved
// per company from config edited in Setup & Controls (project start, phase
// durations, go-live target) — this view only displays it. Bars overlap on
// purpose and each ends at a checkpoint marker at the bar's right edge, repeated
// in the legend with its date. Steps are already tier-filtered by the caller.
export function GanttChart({ steps }: { steps: StepDef[] }) {
  const fields = useFieldMap();
  const canEdit = useCanEdit();
  const timeline = resolveTimeline(steps, fields);

  if (timeline.bars.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card shadow-button-base p-5 sm:p-6 overflow-x-auto">
      <div className="min-w-[620px]">
        {!timeline.hasDates ? (
          <div className="flex items-center justify-end mb-3">
            <span className="text-xxs text-muted-foreground">
              {canEdit
                ? "Relative timeline · dates set in Setup & Controls"
                : "Relative timeline · dates to be confirmed"}
            </span>
          </div>
        ) : null}

        {/* Week ruler */}
        <div className="flex items-end mb-2">
          <div className={cn("shrink-0", LABEL_COL)} />
          <div className="relative flex-1 h-4">
            {timeline.ticks.map((t) => (
              <span
                key={t.label + t.leftPct}
                style={{ left: `${t.leftPct}%` }}
                className={cn(
                  "absolute -translate-x-1/2 text-[10px] font-medium tabular-nums",
                  t.dim ? "text-muted-foreground/60" : "text-muted-foreground"
                )}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          {/* Week grid lines, behind the rows */}
          <div className="absolute left-44 right-0 top-0 bottom-0 pointer-events-none">
            {timeline.ticks.slice(1).map((t) => (
              <span
                key={t.leftPct}
                style={{ left: `${t.leftPct}%` }}
                className="absolute top-0 bottom-0 w-px bg-border/70"
              />
            ))}
          </div>

          {/* Phase-end checkpoint markers */}
          <div className="flex items-start h-7">
            <div
              className={cn(
                "shrink-0 pr-4 pt-1 text-[9.5px] uppercase tracking-wider text-muted-foreground",
                LABEL_COL
              )}
            >
              Checkpoints
            </div>
            <div className="relative flex-1 h-full">
              {timeline.bars.map((b) => (
                <div
                  key={b.key}
                  style={{ left: `${b.gatePct}%`, backgroundColor: b.color }}
                  className="absolute top-0 -translate-x-1/2 size-5 rounded-full border-2 border-card text-white shadow flex items-center justify-center text-[10px] font-semibold tabular-nums"
                  title={
                    b.gateDate
                      ? `${b.gate} · ${formatDate(b.gateDate)}`
                      : b.gate
                  }
                >
                  {b.n}
                </div>
              ))}
            </div>
          </div>

          {/* Bars */}
          {timeline.bars.map((b) => (
            <div key={b.key} className="flex items-center h-9">
              <div
                className={cn(
                  "shrink-0 pr-4 flex items-start gap-2",
                  LABEL_COL
                )}
              >
                <span
                  style={{ backgroundColor: b.color }}
                  className="shrink-0 size-2.5 rounded-[3px] mt-1"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-tight tracking-tight truncate">
                    {b.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                    {b.timing}
                  </div>
                </div>
              </div>
              <div className="relative flex-1 h-full">
                <div
                  style={{
                    left: `${b.startPct}%`,
                    width: `${b.widthPct}%`,
                    backgroundColor: b.color
                  }}
                  className="absolute top-1.5 bottom-1.5 rounded-md shadow-sm"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Legend: checkpoint number → name, with its date */}
        <div className="mt-4 pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {timeline.bars.map((b) => (
            <GateLegendRow key={b.key} bar={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GateLegendRow({ bar }: { bar: TimelineBar }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        style={{ backgroundColor: bar.color }}
        className="shrink-0 inline-flex items-center justify-center size-[18px] rounded-full text-white text-[10px] font-semibold tabular-nums"
      >
        {bar.n}
      </span>
      <span className="text-[13px] leading-snug flex-1 min-w-0 truncate">
        {bar.gate}
      </span>
      {bar.gateDate ? (
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
          {formatDate(bar.gateDate)}
        </span>
      ) : null}
    </div>
  );
}
