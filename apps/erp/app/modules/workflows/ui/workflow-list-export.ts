// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The Workflows table columns whose values the loader adds to each page's
 * rows, by column id. The table exports them with these, and the background
 * CSV export writes the same values (`workflowsList.exportValues`).
 */
type Row = { lastRun?: { status?: string | null } | null };

export const WORKFLOW_LIST_EXPORT_VALUES = {
  lastRun: (row: Row) => row.lastRun?.status ?? ""
} satisfies Record<string, (row: Row) => string>;
