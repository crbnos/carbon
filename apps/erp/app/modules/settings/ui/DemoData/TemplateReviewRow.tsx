import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import type { CompanyTemplateRun } from "~/modules/settings";
import { formatElapsed } from "~/modules/settings/ui/Backups/format";
import { path } from "~/utils/path";

/** A run with no completion after this long is treated as stalled, and offered a
 *  revert retry — the job's own crash handler can't fire if the process died. */
const STALLED_AFTER_MS = 5 * 60 * 1000;

export function TemplateReviewRow({
  run,
  datasetLabel,
  onResolve
}: {
  run: CompanyTemplateRun;
  datasetLabel: string | null;
  /** Hides the row for a keep/dismiss, which clear the marker asynchronously —
   *  a revert must NOT use this: it keeps running, and the row is what reports it. */
  onResolve: (templateRunId: string) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";

  // Clicking Revert only ENQUEUES the job — the marker still says `ready` until
  // the job starts and flips it a poll or two later, so without this the row
  // snaps back to Keep/Revert and reads as "the click did nothing". Held until
  // the server reports a status of its own, so a job that never runs still
  // reaches the stalled state below.
  const [revertRequestedAt, setRevertRequestedAt] = useState<number | null>(
    null
  );
  const isReverting = run.status === "reverting" || revertRequestedAt !== null;
  const busy = run.status === "running" || isReverting;
  useEffect(() => {
    // Any status but `ready` means the server has taken over the story —
    // including `failed`, where the optimistic spinner must not hide the error.
    if (run.status !== "ready") setRevertRequestedAt(null);
  }, [run.status]);

  // Phase keys are stable; the copy for them lives here, not in the job.
  const phaseLabel: Record<string, string> = {
    snapshot: t`Saving a copy of your current data`,
    seed: t`Adding demo records`,
    wipe: t`Clearing demo data`,
    load: t`Putting your data back`,
    files: t`Restoring files`
  };

  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Time a revert from the click while it is still only optimistic — the
  // marker's `startedAt` still belongs to the apply, and would read as minutes.
  // A row with no `startedAt` at all is an optimistic apply the job hasn't
  // acknowledged yet, so it counts from when the row appeared.
  const startedMs =
    revertRequestedAt ??
    (run.startedAt ? Date.parse(run.startedAt) : mountedAt);
  const elapsedMs = now - startedMs;
  const stalled = busy && elapsedMs > STALLED_AFTER_MS;
  const elapsed = formatElapsed(elapsedMs);

  const submit = (intent: "keep" | "revert" | "dismiss") => {
    if (intent === "revert") setRevertRequestedAt(Date.now());
    else onResolve(run.templateRunId);
    fetcher.submit(
      { intent, templateRunId: run.templateRunId },
      { method: "post", action: path.to.demoData }
    );
  };

  // Shown as a phase label, not a bar — a demo-sized run finishes in seconds, so
  // a filling bar would only ever be a flash.
  const progress = run.progress;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {isReverting ? (
            <Trans>Putting your data back</Trans>
          ) : run.status === "running" ? (
            <Trans>Applying demo data</Trans>
          ) : (
            <Trans>Demo data applied</Trans>
          )}
        </CardTitle>
        <CardDescription>
          {busy ? (
            <Trans>
              This usually takes a few seconds. You can leave the page — it
              keeps running.
            </Trans>
          ) : (
            <Trans>
              Demo data was applied to this company. Keep it, or revert to put
              back exactly what was here before.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={2} className="w-full border rounded-lg p-3">
          <HStack className="w-full justify-between">
            <VStack spacing={0} className="min-w-0">
              <span className="text-sm font-medium truncate">
                {datasetLabel ?? run.datasetKey ?? t`Demo data`}
              </span>
              {run.status === "failed" ? (
                <span className="text-xs text-destructive-foreground">
                  {t`Failed`} — {run.error ?? t`unknown error`}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {run.startedAt && (
                    <DateTime value={run.startedAt} variant="absolute" />
                  )}
                  {" · "}
                  {busy
                    ? `${progress ? (phaseLabel[progress.phase] ?? progress.phase) : t`Starting…`} · ${elapsed}`
                    : t`ready to keep or revert`}
                </span>
              )}
            </VStack>
            <HStack spacing={2} className="shrink-0">
              {run.status === "ready" && !busy && (
                <>
                  <Button
                    isLoading={submitting}
                    isDisabled={submitting}
                    onClick={() => submit("keep")}
                  >
                    <Trans>Keep</Trans>
                  </Button>
                  <Button
                    variant="destructive"
                    isLoading={submitting}
                    isDisabled={submitting}
                    onClick={() => submit("revert")}
                  >
                    <Trans>Revert</Trans>
                  </Button>
                </>
              )}
              {run.status === "failed" && (
                <Button
                  variant="secondary"
                  isLoading={submitting}
                  isDisabled={submitting}
                  onClick={() => submit("dismiss")}
                >
                  <Trans>Dismiss</Trans>
                </Button>
              )}
              {/* The button the user pressed stays put while the job runs —
                  spinning, not gone — so an apply spins on Apply and a revert on
                  Revert. Once a run looks stalled it becomes the revert escape
                  either way, since that is the only way out. */}
              {busy &&
                (isReverting || stalled ? (
                  <Button
                    variant="destructive"
                    isLoading={!stalled || submitting}
                    isDisabled={!stalled || submitting || !run.hasSnapshot}
                    onClick={() => submit("revert")}
                  >
                    {stalled ? (
                      <Trans>Retry revert</Trans>
                    ) : (
                      <Trans>Reverting</Trans>
                    )}
                  </Button>
                ) : (
                  <Button isLoading isDisabled>
                    <Trans>Applying</Trans>
                  </Button>
                ))}
            </HStack>
          </HStack>

          {stalled && (
            <span className="text-xs text-muted-foreground">
              <Trans>
                This is taking longer than expected. It may still finish — if it
                doesn't, retry the revert to put your data back.
              </Trans>
            </span>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
