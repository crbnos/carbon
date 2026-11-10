// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import {
  getCompanyRestoreRuns,
  requireBackupAccess
} from "~/modules/settings/settings.service";

// Polled by the restore progress modal. No marker answers "gone", which the
// modal reads by phase: during a restore the job hasn't written its first
// heartbeat yet; during a revert the revert finished (it deletes the marker). A
// read error answers "unreadable" instead, so it is never taken for either.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requireBackupAccess(request);
  let runs: Awaited<ReturnType<typeof getCompanyRestoreRuns>>;
  try {
    runs = await getCompanyRestoreRuns(client, companyId, params.restoreRunId);
  } catch {
    return {
      status: "unreadable" as const,
      rows: 0,
      error: null,
      progress: null,
      startedAt: null
    };
  }
  const run = runs.at(0);
  return {
    status: run?.status ?? ("gone" as const),
    rows: run?.rows ?? 0,
    error: run?.error ?? null,
    progress: run?.progress ?? null,
    startedAt: run?.startedAt ?? null
  };
}
