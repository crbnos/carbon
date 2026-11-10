// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import {
  getCompanyExportRun,
  requireBackupAccess
} from "~/modules/settings/settings.service";

// Polled by the export progress modal for live phase/done/total. The job writes
// one marker per company while running, clears it on success and flips it to
// "failed" on error, so a null `status` means no heartbeat yet OR finished; the
// modal uses the backup appearing in the list to confirm completion. A read
// error answers "unreadable", which the modal treats as "keep polling".
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requireBackupAccess(request);
  try {
    const run = await getCompanyExportRun(client, companyId);
    return {
      status: run?.status ?? null,
      progress: run?.progress ?? null,
      startedAt: run?.startedAt ?? null,
      error: run?.error ?? null
    };
  } catch {
    return {
      status: "unreadable" as const,
      progress: null,
      startedAt: null,
      error: null
    };
  }
}
