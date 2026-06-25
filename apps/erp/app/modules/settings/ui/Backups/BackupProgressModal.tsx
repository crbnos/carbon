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

// Simulated step labels per job. Restore/revert resolve from a real poll; export
// has no signal, so its steps play out then settle. Either way the steps make the
// wait legible — "what is it doing right now".
const STEP_SETS: Record<"export" | "restore" | "revert", string[]> = {
  export: [
    "Collecting records",
    "Bundling files",
    "Compressing",
    "Saving backup"
  ],
  restore: [
    "Snapshotting current data",
    "Clearing existing data",
    "Loading backup",
    "Restoring files"
  ],
  revert: ["Clearing restored data", "Restoring your snapshot"]
};

// The animated step checklist. Completed steps get a check that pops in
// (ease-out), the active step spins (constant motion → linear), pending steps sit
// dim. A thin bar fills as steps advance. All motion respects reduced-motion.
function StepChecklist({
  steps,
  step,
  done
}: {
  steps: string[];
  step: number;
  done: boolean;
}) {
  const fraction = done
    ? 1
    : (Math.min(step, steps.length - 1) + 0.5) / steps.length;
  return (
    <div className="flex w-full flex-col gap-4 py-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${fraction})` }}
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
  const steps = STEP_SETS[mode];

  const statusFetcher = useFetcher<{
    status: "running" | "ready" | "failed" | "reverting" | "gone";
    rows: number;
    error: string | null;
  }>();
  const raw = statusFetcher.data?.status;
  const failed = !isExport && raw === "failed";
  const restoreReady = mode === "restore" && raw === "ready";
  const revertDone = isRevert && raw === "gone";

  const [step, setStep] = useState(0);
  const success = restoreReady || revertDone || (isExport && !!completed);
  const done = success || failed;

  const rows = statusFetcher.data?.rows ?? 0;
  const error = statusFetcher.data?.error;
  const [ticks, setTicks] = useState(0);
  const slow = !done && ticks > 80;

  // Pre-heartbeat watchdog: if a restore never writes its first marker (the job
  // failed to start / never reached Inngest), the status stays "gone" forever.
  // Surface it instead of spinning indefinitely.
  const [sawMarker, setSawMarker] = useState(false);
  useEffect(() => {
    if (raw && raw !== "gone") setSawMarker(true);
  }, [raw]);
  const stalled = mode === "restore" && !done && !sawMarker && ticks > 40;

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
    }, 1500);
    return () => clearInterval(id);
  }, [isExport, runId, done, load, revalidator]);

  // Export has no status marker — poll by revalidating the backups list until the
  // new backup actually appears (the parent flips `completed` when it does). The
  // dialog never claims success before the file exists.
  useEffect(() => {
    if (!isExport || done) return;
    const id = setInterval(() => {
      revalidator.revalidate();
      setTicks((t) => t + 1);
    }, 2000);
    return () => clearInterval(id);
  }, [isExport, done, revalidator]);

  // Advance the visible steps on a cadence while the job runs.
  useEffect(() => {
    if (done) {
      setStep(steps.length);
      return;
    }
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, steps.length - 1)),
      900
    );
    return () => clearInterval(id);
  }, [done, steps.length]);

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
              <StepChecklist steps={steps} step={step} done={done} />
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
