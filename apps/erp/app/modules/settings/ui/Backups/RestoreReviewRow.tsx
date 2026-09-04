import { Button, HStack, VStack } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { LuLoaderCircle } from "react-icons/lu";
import { DateTime } from "~/components";
import { totalScopeRows } from "../../backups.service";
import { ExcludedRowsInfo } from "./ExcludedRowsInfo";

export type RestoreRun = {
  restoreRunId: string;
  status: "running" | "ready" | "failed" | "reverting";
  rows: number;
  label: string | null;
  error: string | null;
  startedAt: string;
  /** "scope-violations" = the pre-restore snapshot refused because the LIVE
   *  data has rows escaping company scope — the one failure with a recovery. */
  reason: "scope-violations" | null;
  /** Per FK edge — the breakdown shown in the popover. Never summed. */
  violations: Array<{
    table: string;
    column: string;
    refTable: string;
    rows: number;
  }>;
  /** DISTINCT rows per table — the basis for any count a person reads. */
  violationRowsByTable: Array<{ table: string; rows: number }>;
};

// One row in the "Restored — review" card, branching on the run's status.
export function RestoreReviewRow({
  run,
  onKeep,
  onRevert,
  onDismiss,
  onPurgeAndRestore
}: {
  run: RestoreRun;
  onKeep: () => void;
  onRevert: () => void;
  onDismiss: () => void;
  /** Failed for scope violations: delete those rows (confirmed by the caller) and restart. */
  onPurgeAndRestore: () => void;
}) {
  const busy = run.status === "running" || run.status === "reverting";
  return (
    <HStack className="w-full justify-between border rounded-lg p-3">
      <VStack spacing={0} className="min-w-0">
        <span className="text-sm font-medium truncate">
          {run.label ?? <Trans>Restore</Trans>}
        </span>
        {run.status === "failed" ? (
          // Product words on the line; the exact tables and the job's raw error
          // live in the "i" popover — same treatment as the failed-backup banner.
          <span className="break-words text-xs text-muted-foreground">
            {run.reason === "scope-violations" ? (
              <Plural
                value={totalScopeRows(run.violationRowsByTable)}
                one="# row links to data outside this company, so a safety copy of your current data can't be made."
                other="# rows link to data outside this company, so a safety copy of your current data can't be made."
              />
            ) : (
              <Trans>This restore could not be completed.</Trans>
            )}{" "}
            <ExcludedRowsInfo
              excludedRows={run.violations}
              title={<Trans>Why this restore failed</Trans>}
              description={
                run.reason === "scope-violations" ? (
                  <Trans>
                    Each line is a link from this company's data to a row it
                    doesn't own. Removing those rows lets the restore run.
                  </Trans>
                ) : (
                  <Trans>The restore job reported this error.</Trans>
                )
              }
              technical={run.error}
            />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            <DateTime value={run.startedAt} variant="absolute" /> ·{" "}
            {run.status === "running" ? (
              <Trans>restoring…</Trans>
            ) : run.status === "reverting" ? (
              <Trans>reverting…</Trans>
            ) : (
              <Trans>{run.rows.toLocaleString()} rows</Trans>
            )}
          </span>
        )}
      </VStack>
      <HStack spacing={2} className="shrink-0">
        {run.status === "ready" && (
          <>
            <Button onClick={onKeep}>
              <Trans>Keep</Trans>
            </Button>
            <Button variant="destructive" onClick={onRevert}>
              <Trans>Revert</Trans>
            </Button>
          </>
        )}
        {run.status === "failed" && (
          <>
            {run.reason === "scope-violations" && (
              <Button variant="destructive" onClick={onPurgeAndRestore}>
                <Trans>Remove corrupted data and restore</Trans>
              </Button>
            )}
            <Button variant="secondary" onClick={onDismiss}>
              <Trans>Dismiss</Trans>
            </Button>
          </>
        )}
        {busy && (
          <LuLoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </HStack>
    </HStack>
  );
}
