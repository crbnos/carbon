// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getTableLabel } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import { downloadCsv } from "@carbon/files/csv";
import { toast } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { usePeople } from "~/stores";
import { type AuditLogCsvLabels, buildAuditLogCsvRows } from "./utils";

type UseAuditLogDownloadOptions = {
  entityType: string;
  entityId: string;
  companyId: string;
  recordId?: string;
  /** Leads the file name, e.g. the record's readable id. */
  downloadName?: string;
};

/**
 * Downloads an entity's full audit history (everything still in the live log,
 * not just the 50 entries the drawer shows) as a CSV, one row per changed field.
 * Built on the client, like the Table export, so headers are translated and
 * actors resolve to names.
 */
export function useAuditLogDownload({
  entityType,
  entityId,
  companyId,
  recordId,
  downloadName
}: UseAuditLogDownloadOptions) {
  const { t } = useLingui();
  const [people] = usePeople();
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(async () => {
    setIsDownloading(true);
    try {
      const params = new URLSearchParams({
        entityType,
        entityId,
        companyId,
        all: "true"
      });
      if (recordId) params.set("recordId", recordId);

      const response = await fetch(`/api/audit-log?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { entries } = (await response.json()) as {
        entries: AuditLogEntry[];
      };

      const labels: AuditLogCsvLabels = {
        columns: {
          date: t`Date`,
          changedBy: t`Changed By`,
          action: t`Action`,
          record: t`Record`,
          recordId: t`Record ID`,
          field: t`Field`,
          oldValue: t`Old Value`,
          newValue: t`New Value`
        },
        actions: {
          INSERT: t`Created`,
          UPDATE: t`Updated`,
          DELETE: t`Deleted`
        },
        system: t`System`
      };
      const rows = buildAuditLogCsvRows(entries, {
        labels,
        nameById: new Map(people.map((p) => [p.id, p.name.trim()])),
        getRecordLabel: getTableLabel
      });

      const name = (downloadName || entityType).replace(/[^\w.-]+/g, "-");
      downloadCsv(
        rows,
        `${name}-history-${today(getLocalTimeZone()).toString()}.csv`,
        { fields: Object.values(labels.columns) }
      );
    } catch {
      toast.error(t`Failed to download history`);
    } finally {
      setIsDownloading(false);
    }
  }, [companyId, downloadName, entityId, entityType, people, recordId, t]);

  return { download, isDownloading };
}
