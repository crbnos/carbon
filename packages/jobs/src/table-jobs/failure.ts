// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import type { TableJobKind } from "./handlers";
import { releaseTableJobLock } from "./lock";
import { notifyTableJobUser } from "./notify";
import { removeTableJobFolder } from "./storage";

const log = getLogger("jobs", "table-jobs");

/**
 * The `onFailure` of a table job (an export, a bulk action): logs the
 * failure, tells the user, deletes the files the run wrote and frees the
 * company's lock. A failed notice or delete is logged and the rest still
 * runs: the nightly cleanup removes the files within 7 days.
 */
export async function failTableJob({
  kind,
  companyId,
  jobId,
  folder,
  notification,
  error,
  context
}: {
  kind: TableJobKind;
  companyId: string;
  jobId: string;
  /** The folder of the run's files (`tableExportPartsFolder`,
   *  `tableBulkIdsFolder`). */
  folder: string;
  notification: Parameters<typeof notifyTableJobUser>[0];
  error: { message: string };
  /** What the log names besides the company and the job. */
  context: Record<string, unknown>;
}): Promise<void> {
  log.error("Table job failed", {
    kind,
    companyId,
    jobId,
    ...context,
    error: error.message
  });
  try {
    await notifyTableJobUser(notification);
  } catch (notifyError) {
    log.error("Failed to send a table job's failure notification", {
      kind,
      companyId,
      jobId,
      error: notifyError
    });
  }
  try {
    await removeTableJobFolder(folder);
  } catch (removeError) {
    log.error("Failed to delete the files of a failed table job", {
      kind,
      companyId,
      jobId,
      error: removeError
    });
  }
  await releaseTableJobLock(kind, companyId, jobId);
}
