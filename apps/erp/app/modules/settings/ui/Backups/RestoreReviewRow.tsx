// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, HStack, VStack } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { LuLoaderCircle } from "react-icons/lu";
import { DateTime } from "~/components";
import type { CompanyRestoreRun } from "../../types";
import { ExcludedRowsInfo } from "./ExcludedRowsInfo";
import { formatBackupName, totalScopeRows } from "./format";

// One row in the "Restored — review" card, branching on the run's status.
export function RestoreReviewRow({
  run,
  onKeep,
  onRevert,
  onDismiss,
  onPurgeAndRestore
}: {
  run: CompanyRestoreRun;
  onKeep: () => void;
  onRevert: () => void;
  onDismiss: () => void;
  /** Failed for scope violations: delete those rows (confirmed by the caller)
   *  and restart. Absent when a new restore can't start (the feature lapsed). */
  onPurgeAndRestore?: () => void;
}) {
  const busy = run.status === "running" || run.status === "reverting";
  // The backup's data loaded before the run failed: the snapshot is the only
  // way back, so the row offers keep or revert, never a dismiss that drops it.
  const decidable = !busy && (run.status === "ready" || run.applied);
  return (
    <HStack className="w-full justify-between border rounded-lg p-3">
      <VStack spacing={0} className="min-w-0">
        <span className="text-sm font-medium truncate">
          {run.filePath ? (
            formatBackupName(run.filePath)
          ) : (
            <Trans>Restore</Trans>
          )}
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
            ) : run.reverted ? (
              <Trans>
                Your previous data is back, but some files couldn't be restored.
                Revert again to retry them.
              </Trans>
            ) : run.applied ? (
              <Trans>
                The backup's data was loaded, but the restore stopped after
                that. Keep it, or revert to put back what you had.
              </Trans>
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
            {run.status === "ready" && run.error ? (
              <>
                {" · "}
                <Trans>some files may be missing</Trans>
              </>
            ) : null}
          </span>
        )}
      </VStack>
      <HStack spacing={2} className="shrink-0">
        {decidable && (
          <>
            <Button onClick={onKeep}>
              <Trans>Keep</Trans>
            </Button>
            <Button variant="destructive" onClick={onRevert}>
              <Trans>Revert</Trans>
            </Button>
          </>
        )}
        {run.status === "failed" && !run.applied && (
          <>
            {run.reason === "scope-violations" && onPurgeAndRestore && (
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
