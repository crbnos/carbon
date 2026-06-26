import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuCheck, LuLoaderCircle, LuTriangleAlert } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";

// The job reports progress as a stable phase KEY + done/total; these order the
// keys and map them to labels per mode (display copy stays out of the job).
const PHASE_ORDER: Record<"export" | "restore" | "revert", string[]> = {
  export: ["tables", "files"],
  restore: ["snapshot", "wipe", "load", "files"],
  revert: ["wipe", "load", "files"]
};
const PHASE_LABELS: Record<
  "export" | "restore" | "revert",
  Record<string, string>
> = {
  export: {
    tables: "Collecting records",
    files: "Bundling files"
  },
  restore: {
    snapshot: "Snapshotting current data",
    wipe: "Clearing existing data",
    load: "Loading backup",
    files: "Restoring files"
  },
  revert: {
    wipe: "Clearing restored data",
    load: "Restoring your snapshot",
    files: "Restoring files"
  }
};

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// The animated step checklist. Completed steps get a check that pops in
// (ease-out), the active step spins (constant motion → linear), pending steps sit
// dim. A thin bar fills as steps advance. All motion respects reduced-motion.
function StepChecklist({
  steps,
  step,
  fraction,
  done,
  detail
}: {
  steps: string[];
  step: number;
  /** 0..1 bar fill. Real for restore/revert (phase + intra-phase done/total),
   *  synthetic for export. */
  fraction: number;
  done: boolean;
  /** Optional line under the list, e.g. "23 / 50 · 4s". */
  detail?: string;
}) {
  const f = done ? 1 : Math.max(0, Math.min(1, fraction));
  return (
    <div className="flex w-full flex-col gap-4 py-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${f})` }}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        {steps.map((label, i) => {
          const state =
            done || i < step ? "done" : i === step ? "active" : "pending";
          return (
            <div key={label} className="flex items-center gap-2.5 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <LuCheck className="h-4 w-4 text-emerald-500 duration-200 animate-in fade-in zoom-in-75 motion-reduce:animate-none" />
                ) : state === "active" ? (
                  <LuLoaderCircle className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </span>
              <span
                className={`transition-colors duration-300 ${
                  state === "pending"
                    ? "text-muted-foreground/40"
                    : state === "active"
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {detail ? (
        <p className="text-xs tabular-nums text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

// Stepped progress for export / restore / revert. Restore & revert track the real
// job via the status poll; export polls the backup list (via `completed`, set by
// the parent once the new backup actually appears). Shows working → success | failed.
export function JobProgressModal({
  mode,
  runId,
  completed,
  onClose
}: {
  mode: "export" | "restore" | "revert";
  runId?: string;
  /** Export only: true once the new backup has actually landed in the list. */
  completed?: boolean;
  onClose: () => void;
}) {
  const isExport = mode === "export";
  const isRevert = mode === "revert";
  const revalidator = useRevalidator();

  const statusFetcher = useFetcher<{
    status: "running" | "ready" | "failed" | "reverting" | "gone";
    rows: number;
    error: string | null;
    progress: { phase: string; done: number; total: number } | null;
    startedAt: string | null;
  }>();
  // Export reports progress via a separate company-scoped marker (no run id).
  const exportFetcher = useFetcher<{
    progress: { phase: string; done: number; total: number } | null;
    startedAt: string | null;
  }>();
  const raw = statusFetcher.data?.status;
  const failed = !isExport && raw === "failed";
  const restoreReady = mode === "restore" && raw === "ready";
  const revertDone = isRevert && raw === "gone";

  const success = restoreReady || revertDone || (isExport && !!completed);
  const done = success || failed;

  const rows = statusFetcher.data?.rows ?? 0;
  const error = statusFetcher.data?.error;
  const progress = isExport
    ? (exportFetcher.data?.progress ?? null)
    : (statusFetcher.data?.progress ?? null);
  const startedAt = isExport
    ? (exportFetcher.data?.startedAt ?? null)
    : (statusFetcher.data?.startedAt ?? null);
  // Watchdog thresholds are in 500ms ticks: ~120s "slow", ~60s "stalled".
  const [ticks, setTicks] = useState(0);
  const slow = !done && ticks > 240;

  // Elapsed clock — refresh once a second while the job runs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done, startedAt]);
  const elapsedMs = startedAt ? now - new Date(startedAt).getTime() : 0;

  // Pre-heartbeat watchdog: if a restore never writes its first marker (the job
  // failed to start / never reached Inngest), the status stays "gone" forever.
  // Surface it instead of spinning indefinitely.
  const [sawMarker, setSawMarker] = useState(false);
  useEffect(() => {
    if (raw && raw !== "gone") setSawMarker(true);
  }, [raw]);
  const stalled = mode === "restore" && !done && !sawMarker && ticks > 120;

  // Poll the real job status (restore / revert only).
  const load = statusFetcher.load;
  useEffect(() => {
    if (isExport || !runId) return;
    if (done) {
      revalidator.revalidate();
      return;
    }
    const href = `/api/settings/backup-restore-status/${runId}`;
    load(href);
    const id = setInterval(() => {
      load(href);
      setTicks((t) => t + 1);
    }, 500);
    return () => clearInterval(id);
  }, [isExport, runId, done, load, revalidator]);

  // Export: poll the marker fast for smooth live counts, but revalidate the (much
  // heavier) backup list slower — completion is just the new backup appearing.
  const loadExport = exportFetcher.load;
  useEffect(() => {
    if (!isExport || done) return;
    const href = `/api/settings/backup-export-status`;
    loadExport(href);
    const poll = setInterval(() => {
      loadExport(href);
      setTicks((t) => t + 1);
    }, 500);
    const reval = setInterval(() => revalidator.revalidate(), 2000);
    return () => {
      clearInterval(poll);
      clearInterval(reval);
    };
  }, [isExport, done, revalidator, loadExport]);

  // Checklist + bar from the real phase + done/total. Before the first heartbeat
  // we hold phase 1 rather than fake-advancing (which would snap backward once
  // real progress arrives).
  const order = PHASE_ORDER[mode];
  const checklist = (() => {
    const labels = order.map((k) => PHASE_LABELS[mode][k] ?? k);
    const elapsed = startedAt ? formatElapsed(elapsedMs) : null;
    if (progress) {
      const idx = order.indexOf(progress.phase);
      const activeStep = idx >= 0 ? idx : 0;
      const sub = progress.total > 0 ? progress.done / progress.total : 0;
      const fraction = done ? 1 : (activeStep + sub) / order.length;
      const counts =
        progress.total > 1
          ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
          : null;
      const detail = [counts, elapsed].filter(Boolean).join(" · ") || undefined;
      return { steps: labels, step: activeStep, fraction, detail };
    }
    // No heartbeat yet: first phase active, bar empty, no fake advance.
    return {
      steps: labels,
      step: 0,
      fraction: done ? 1 : 0,
      detail: elapsed ?? undefined
    };
  })();

  const workingTitle = isExport
    ? "Creating backup…"
    : isRevert
      ? "Reverting…"
      : "Restoring…";
  const title = failed
    ? isRevert
      ? "Revert failed"
      : "Restore failed"
    : success
      ? isExport
        ? "Backup ready"
        : isRevert
          ? "Reverted"
          : "Restore complete"
      : workingTitle;

  // The modal just reports progress — keep/revert is decided from the review
  // card, so any terminal (or slow/stalled) state is dismissable.
  const dismissable = done || slow || stalled;

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && dismissable) onClose();
      }}
    >
      <ModalContent withCloseButton={dismissable}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <LuCheck className="h-8 w-8 text-emerald-500 duration-300 animate-in fade-in zoom-in-75 motion-reduce:animate-none" />
              <p className="text-center text-sm text-muted-foreground">
                {isExport
                  ? "Your backup is ready — it's in the list below."
                  : isRevert
                    ? "Your previous data is back, exactly as it was before the restore."
                    : `Loaded ${rows.toLocaleString()} rows. Review it below — keep the restore, or revert to what was here before.`}
              </p>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <LuTriangleAlert className="h-8 w-8 text-destructive-foreground duration-300 animate-in fade-in zoom-in-75 motion-reduce:animate-none" />
              <p className="text-center text-sm text-muted-foreground">
                {error ?? "Something went wrong."}
              </p>
              {!isRevert && (
                <p className="text-center text-xs text-muted-foreground">
                  Your data was not changed — the restore stops before touching
                  anything if it can't complete.
                </p>
              )}
            </div>
          ) : (
            <>
              <StepChecklist
                steps={checklist.steps}
                step={checklist.step}
                fraction={checklist.fraction}
                done={done}
                detail={checklist.detail}
              />
              {stalled ? (
                <p className="text-center text-xs text-muted-foreground">
                  Couldn't confirm the restore started. It may still be running
                  — close this and check the list in a moment.
                </p>
              ) : slow ? (
                <p className="text-center text-xs text-muted-foreground">
                  Still working — this is a large dataset. You can close this
                  and check back in a bit.
                </p>
              ) : null}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {dismissable && (
            <Button onClick={onClose}>{success ? "Done" : "Close"}</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
