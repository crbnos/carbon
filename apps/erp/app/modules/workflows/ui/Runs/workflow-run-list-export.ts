// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getTableLabel } from "@carbon/database/audit.config";

/**
 * The Workflow Runs table columns that show a value computed from the row,
 * by column id. The table exports them with these, and the background CSV
 * export writes the same values (`workflowRunsList.exportValues`).
 */
type Row = {
  workflowId: string;
  workflow?: unknown;
  triggerTable: string | null;
  triggerRecordId: string | null;
  recordName?: string;
};

export const WORKFLOW_RUN_LIST_EXPORT_VALUES = {
  workflowId: (row: Row) =>
    (row.workflow as { name?: string } | null)?.name ?? row.workflowId,
  triggerRecordId: (row: Row) =>
    row.triggerTable && row.triggerRecordId
      ? `${getTableLabel(row.triggerTable)} ${row.recordName ?? row.triggerRecordId}`
      : ""
} satisfies Record<string, (row: Row) => string>;
