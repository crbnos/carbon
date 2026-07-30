import { BarProgress, Button } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { LuCheck, LuLoaderCircle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type ConvertStatus = {
  phase: "downloading" | "converting" | "uploading" | null;
  done: number;
  total: number;
};

const STEPS: { key: NonNullable<ConvertStatus["phase"]>; label: string }[] = [
  { key: "downloading", label: "Reading the CAD file" },
  { key: "converting", label: "Building the 3D geometry" },
  { key: "uploading", label: "Preparing the viewer" }
];

const POLL_MS = 1000;

function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Live checklist for a running model conversion (same visual language as the
 * backup/restore progress modal): per-phase check/spinner/dot, a real progress
 * bar, byte counts for the download phase, and an elapsed clock. Falls back to
 * an indeterminate first step while the job is still queued (no live signal).
 */
export function ModelConvertProgress({
  modelUploadId,
  instructionId
}: {
  modelUploadId: string;
  instructionId: string;
}) {
  const cancelFetcher = useFetcher<{ success: boolean }>();
  const statusFetcher = useFetcher<ConvertStatus>();
  const loadRef = useRef(statusFetcher.load);
  loadRef.current = statusFetcher.load;

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const url = path.to.api.modelConvertStatus(modelUploadId);
    loadRef.current(url);
    const poll = setInterval(() => loadRef.current(url), POLL_MS);
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [modelUploadId]);

  const status = statusFetcher.data ?? { phase: null, done: 0, total: 0 };
  const activeIndex = status.phase
    ? STEPS.findIndex((s) => s.key === status.phase)
    : 0;
  const queued = status.phase === null;

  // Real fraction: completed phases + download sub-progress when known.
  const subProgress =
    status.phase === "downloading" && status.total > 0
      ? Math.min(status.done / status.total, 1)
      : 0;
  const fraction = queued
    ? 0
    : Math.min((activeIndex + (subProgress || 0.15)) / STEPS.length, 0.97);

  const detail =
    status.phase === "downloading" && status.total > 0
      ? `${formatBytes(status.done)} / ${formatBytes(status.total)} · ${formatElapsed(elapsed)}`
      : `${formatElapsed(elapsed)}`;

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="flex w-[340px] flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg">
        <BarProgress progress={fraction} max={1} activeClassName="bg-primary" />
        <div className="flex flex-col gap-2.5">
          {STEPS.map((step, i) => {
            const state =
              !queued && i < activeIndex
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
            return (
              <div key={step.key} className="flex items-center gap-2.5 text-sm">
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
                  {i === 0 && queued ? "Waiting for a worker…" : step.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">{detail}</p>
          <cancelFetcher.Form
            method="post"
            action={path.to.assemblyJobsCancel(instructionId)}
          >
            <input type="hidden" name="kind" value="convert" />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              isLoading={cancelFetcher.state !== "idle"}
              isDisabled={cancelFetcher.state !== "idle"}
            >
              Cancel
            </Button>
          </cancelFetcher.Form>
        </div>
      </div>
    </div>
  );
}
