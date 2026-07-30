import { BarProgress, Button, cn } from "@carbon/react";
import { useEffect, useState } from "react";
import { LuCheck, LuLoaderCircle } from "react-icons/lu";

const STEPS = [
  "Reading the CAD file",
  "Optimizing the geometry",
  "Preparing the viewer"
];

// Elapsed thresholds (s) at which the next step activates. The assembler
// doesn't publish per-phase progress for optimise, so the checklist is paced
// locally — honest about the coarse signal (queued/processing) while giving
// the same staged feel as the convert progress UI.
const STEP_AT = [0, 4, 15];

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Staged checklist for a running model optimise — presentational; the host
 * wires Cancel to its own optimise-cancel route (ERP CadModel, MES model tab).
 */
export function OptimizeProgress({
  queued = false,
  onCancel,
  cancelling = false,
  className
}: {
  /** Job accepted but not picked up yet — first step reads as waiting. */
  queued?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(clock);
  }, []);

  const activeIndex = queued
    ? 0
    : STEP_AT.filter((t) => elapsed >= t).length - 1;
  const fraction = queued
    ? 0
    : Math.min(
        (activeIndex + Math.min(elapsed / 30, 0.8)) / STEPS.length,
        0.97
      );

  return (
    <div
      className={cn(
        "flex w-[340px] flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg",
        className
      )}
    >
      <BarProgress progress={fraction} max={1} activeClassName="bg-primary" />
      <div className="flex flex-col gap-2.5">
        {STEPS.map((label, i) => {
          const state =
            !queued && i < activeIndex
              ? "done"
              : i === activeIndex
                ? "active"
                : "pending";
          return (
            <div key={label} className="flex items-center gap-2.5 text-sm">
              <span className="flex h-5 w-5 items-center justify-center">
                {state === "done" ? (
                  <LuCheck className="h-4 w-4 text-emerald-500 animate-in fade-in zoom-in-75 motion-reduce:animate-none" />
                ) : state === "active" ? (
                  <LuLoaderCircle className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </span>
              <span
                className={
                  state === "pending"
                    ? "text-muted-foreground/40"
                    : state === "active"
                      ? "text-foreground"
                      : "text-muted-foreground"
                }
              >
                {i === 0 && queued ? "Waiting for a worker…" : label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </p>
        {onCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            isLoading={cancelling}
            isDisabled={cancelling}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
