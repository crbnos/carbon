// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// A journal reader that filters `status <> 'Draft'` counts every non-Draft
// status, so the Provisional and Superseded journals of the accounting cutover
// land in the balances. Journal readers pick one of the named status lists
// instead: GL (Posted, Reversed), document, or open item.

// Migrations older than the one that changed the GL readers have false
// positives (`j` is also the alias of `job`), so the SQL side starts there.
// Migration filenames start with a 14-digit timestamp, so string order is
// chronological.
const SINCE_MIGRATION = "20261009005144";

const SQL_NOT_DRAFT = /"?status"?\s*(<>|!=)\s*'Draft'/;
const TS_NOT_DRAFT =
  /\.neq\(\s*"status"\s*,\s*"Draft"\s*\)|"status"\s*,\s*"(?:<>|!=)"\s*,\s*"Draft"/;

const MESSAGE =
  "Filter journal status with GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES (@carbon/database/accounting-posting).";

function basename(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

function scanLines(
  file: string,
  contents: string,
  pattern: RegExp,
  commentPrefix: string
): Violation[] {
  const violations: Violation[] = [];
  contents.split("\n").forEach((text, i) => {
    const trimmed = text.trim();
    // A comment that describes the old filter is not a reader.
    if (trimmed.startsWith(commentPrefix)) return;
    if (pattern.test(text)) {
      violations.push({
        file,
        line: i + 1,
        snippet: trimmed,
        message: MESSAGE
      });
    }
  });
  return violations;
}

export const journalStatusFilter: ConformanceCheck = {
  id: "journal-status-filter",
  description:
    "Journal readers filter status with a named status list, not `status <> 'Draft'`",
  provenance: {
    deprecates: "journal status filters written as status <> 'Draft'",
    replacedBy:
      "GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES from @carbon/database/accounting-posting",
    since: SINCE_MIGRATION
  },
  scan(file: string, contents: string): Violation[] {
    if (file.endsWith(".sql")) {
      if (basename(file) < SINCE_MIGRATION) return [];
      if (!contents.includes('"journal"')) return [];
      return scanLines(file, contents, SQL_NOT_DRAFT, "--");
    }
    if (!contents.includes('"journal"')) return [];
    return scanLines(file, contents, TS_NOT_DRAFT, "//");
  }
};
