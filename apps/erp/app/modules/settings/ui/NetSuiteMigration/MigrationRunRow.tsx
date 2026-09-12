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
import type { NetSuiteMigrationRun } from "~/modules/settings";
import { formatElapsed } from "~/modules/settings/ui/Backups/format";
import { path } from "~/utils/path";

/** A run with no completion after this long is treated as stalled, and offered a
 *  revert retry — the job's own crash handler can't fire if the process died. */
const STALLED_AFTER_MS = 15 * 60 * 1000;

export function MigrationRunRow({
  run,
  onResolve
}: {
  run: NetSuiteMigrationRun;
  /** Hides the row for a keep/dismiss, which clear the marker asynchronously —
   *  a revert must NOT use this: it keeps running, and the row is what reports it. */
  onResolve: (migrationRunId: string) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";

  // Clicking Revert only ENQUEUES the job — the marker still says `ready` until
  // the job starts and flips it a poll or two later, so without this the row
  // snaps back to Keep/Revert and reads as "the click did nothing".
  const [revertRequestedAt, setRevertRequestedAt] = useState<number | null>(
    null
  );
  const isReverting = run.status === "reverting" || revertRequestedAt !== null;
  const busy = run.status === "running" || isReverting;
  useEffect(() => {
    if (run.status !== "ready") setRevertRequestedAt(null);
  }, [run.status]);

  // Phase keys are stable; the copy for them lives here, not in the job.
  const phaseLabel: Record<string, string> = {
    connect: t`Connecting to NetSuite`,
    extract: t`Reading your NetSuite account`,
    map: t`Matching NetSuite records to Carbon`,
    snapshot: t`Saving a copy of your current data`,
    load: t`Writing records into Carbon`,
    wipe: t`Clearing the migrated records`,
    files: t`Restoring files`
  };

  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const startedMs =
    revertRequestedAt ??
    (run.startedAt ? Date.parse(run.startedAt) : mountedAt);
  const elapsedMs = now - startedMs;
  const stalled = busy && elapsedMs > STALLED_AFTER_MS;
  const elapsed = formatElapsed(elapsedMs);

  const submit = (intent: "keep" | "revert" | "dismiss") => {
    if (intent === "revert") setRevertRequestedAt(Date.now());
    else onResolve(run.migrationRunId);
    fetcher.submit(
      { intent, migrationRunId: run.migrationRunId },
      { method: "post", action: path.to.netsuiteMigration }
    );
  };

  const progress = run.progress;
  // A migration reads thousands of records, so the phase alone is not enough
  // feedback — the counts are what tell somebody it is still moving.
  const counts =
    progress && progress.total > 1
      ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
      : null;

  const title = isReverting
    ? t`Putting your data back`
    : run.status === "running"
      ? run.dryRun
        ? t`Previewing your NetSuite data`
        : t`Migrating from NetSuite`
      : run.status === "failed"
        ? t`The migration did not finish`
        : run.dryRun
          ? t`Preview ready`
          : t`Migration complete`;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {busy ? (
            <Trans>
              This can take several minutes on a large account. You can leave
              the page — it keeps running.
            </Trans>
          ) : run.status === "failed" ? (
            <Trans>
              Nothing was written. Fix what the error describes and run it
              again.
            </Trans>
          ) : run.dryRun ? (
            <Trans>
              Nothing was written. This is what a real migration would do — read
              the report below, then migrate for real.
            </Trans>
          ) : (
            <Trans>
              Your NetSuite data is in Carbon. Keep it, or revert to put back
              exactly what was here before.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={2} className="w-full border rounded-lg p-3">
          <HStack className="w-full justify-between">
            <VStack spacing={0} className="min-w-0">
              <span className="text-sm font-medium truncate">
                {run.report?.accountId
                  ? t`NetSuite account ${run.report.accountId}`
                  : t`NetSuite`}
                {run.report?.sandbox ? ` · ${t`sandbox`}` : ""}
              </span>
              {run.status === "failed" ? (
                <span className="text-xs text-destructive">
                  {run.error ?? t`unknown error`}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {run.startedAt && (
                    <DateTime value={run.startedAt} variant="absolute" />
                  )}
                  {" · "}
                  {busy
                    ? [
                        progress
                          ? (phaseLabel[progress.phase] ?? progress.phase)
                          : t`Starting…`,
                        counts,
                        elapsed
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : run.dryRun
                      ? t`nothing was written`
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
                    onClick={() => submit(run.dryRun ? "dismiss" : "keep")}
                  >
                    {run.dryRun ? <Trans>Dismiss</Trans> : <Trans>Keep</Trans>}
                  </Button>
                  {/* A dry run wrote nothing, so there is nothing to revert. */}
                  {!run.dryRun && (
                    <Button
                      variant="destructive"
                      isLoading={submitting}
                      isDisabled={submitting || !run.hasSnapshot}
                      onClick={() => submit("revert")}
                    >
                      <Trans>Revert</Trans>
                    </Button>
                  )}
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
                    <Trans>Running</Trans>
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
