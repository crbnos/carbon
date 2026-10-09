// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const DOCUMENT_SEQUENCE_SYNCED = "document-sequence-synced";

export const SEED_DATA_FILE = "packages/database/src/seed-data.ts";
export const ATTACHMENTS_FILE =
  "packages/database/src/event-system/attachments.ts";
export const INTERCEPTOR_FILE =
  "packages/database/src/event-system/handlers/sync_advance_document_sequence.sql";

const INTERCEPTOR = "sync_advance_document_sequence";

/** A counter named differently from the table whose numbers it issues. */
const COUNTER_TABLES: Record<string, string> = {
  journalEntry: "journal",
  creditMemo: "memo",
  debitMemo: "memo"
};

/**
 * Counters whose numbers only ever come from get_next_sequence / getNextSequence:
 * no form, MCP tool or API write takes the number from the caller (checked
 * 2026-10-09). Everything else must be kept ahead of saved numbers by the
 * interceptor, or a caller-chosen number leaves the counter behind and later
 * inserts fail on the unique constraint.
 */
export const EXEMPT_COUNTERS: Record<string, string> = {
  charge: "no form or API write takes chargeId",
  fixedAssetTransfer:
    "no form or API write takes its transferId (the transferId tools are warehouse transfers)",
  inspection: "no form or API write takes inspectionId",
  jobOperationBatch: "no form or API write takes a batch's readableId",
  reimbursement:
    "no form or API write takes reimbursementId (reimbursement lines only reference their parent)",
  revenueRecognitionRun: "no form or API write takes runId"
};

type Entry = { name: string; line: number };

function lineAt(contents: string, index: number): number {
  return contents.slice(0, index).split("\n").length;
}

/** The `table:` of every counter in `export const sequences = [...]`. */
function counters(seedData: string): Entry[] {
  const start = seedData.indexOf("export const sequences = [");
  if (start === -1) return [];
  const end = seedData.indexOf("\n]", start);
  const block = seedData.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/table: "(\w+)"/g)].map((m) => ({
    name: m[1] as string,
    line: lineAt(seedData, start + (m.index ?? 0))
  }));
}

function attachedTables(attachments: string): Entry[] {
  const keys = [...attachments.matchAll(/^ {2}(\w+): \{/gm)];
  return keys.flatMap((m, i) => {
    const from = m.index ?? 0;
    const to = keys[i + 1]?.index ?? attachments.length;
    return attachments.slice(from, to).includes(`"${INTERCEPTOR}"`)
      ? [{ name: m[1] as string, line: lineAt(attachments, from) }]
      : [];
  });
}

/** Tables named in the interceptor's `CASE p_table` (WHEN 'table' THEN 'column'). */
function interceptedTables(interceptor: string): Entry[] {
  return [...interceptor.matchAll(/WHEN '(\w+)' THEN '\w+'/g)].map((m) => ({
    name: m[1] as string,
    line: lineAt(interceptor, m.index ?? 0)
  }));
}

/**
 * Every counter is either kept ahead of saved numbers by
 * sync_advance_document_sequence or exempt with a reason, and the interceptor's
 * table list matches the tables it is attached to.
 */
export function findUnsyncedDocumentSequences(sources: {
  seedData: SourceFile;
  attachments: SourceFile;
  interceptor: SourceFile;
}): Violation[] {
  const attached = attachedTables(sources.attachments.contents);
  const intercepted = interceptedTables(sources.interceptor.contents);
  const attachedNames = new Set(attached.map((t) => t.name));
  const interceptedNames = new Set(intercepted.map((t) => t.name));
  const out: Violation[] = [];

  for (const counter of counters(sources.seedData.contents)) {
    const table = COUNTER_TABLES[counter.name] ?? counter.name;
    const covered = attachedNames.has(table) && interceptedNames.has(table);
    const exempt = counter.name in EXEMPT_COUNTERS;
    if (!covered && !exempt) {
      out.push({
        file: sources.seedData.file,
        line: counter.line,
        snippet: `table: "${counter.name}"`,
        message: `Counter "${counter.name}" is not kept ahead of saved numbers. Add "${table}" to the CASE in ${INTERCEPTOR}.sql and give it the interceptor in attachments.ts, or add "${counter.name}" to EXEMPT_COUNTERS with the reason no caller ever supplies its number.`
      });
    }
    if (covered && exempt) {
      out.push({
        file: sources.seedData.file,
        line: counter.line,
        snippet: `table: "${counter.name}"`,
        message: `Counter "${counter.name}" is covered by ${INTERCEPTOR}; remove it from EXEMPT_COUNTERS.`
      });
    }
  }

  for (const table of attached) {
    if (!interceptedNames.has(table.name)) {
      out.push({
        file: sources.attachments.file,
        line: table.line,
        snippet: table.name,
        message: `"${table.name}" runs ${INTERCEPTOR} but is missing from its CASE, so the interceptor ignores it.`
      });
    }
  }

  for (const table of intercepted) {
    if (!attachedNames.has(table.name)) {
      out.push({
        file: sources.interceptor.file,
        line: table.line,
        snippet: `WHEN '${table.name}'`,
        message: `"${table.name}" is in the ${INTERCEPTOR} CASE but not attached in attachments.ts, so it never runs.`
      });
    }
  }

  return out;
}
