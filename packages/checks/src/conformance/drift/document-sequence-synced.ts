// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { read } from "../../sources/read-source";
import { sqlNodes } from "../../sources/sql";
import { lineOf } from "../../sources/text";

/**
 * Every counter is either kept ahead of saved numbers by
 * sync_advance_document_sequence or exempt with a reason, and the interceptor's
 * table list matches the tables it is attached to.
 */
export const documentSequenceSynced = defineCheck({
  id: "document-sequence-synced",
  description:
    "Every counter is either kept ahead of saved numbers by sync_advance_document_sequence or exempt with a reason, and the interceptor's table list matches the tables it is attached to.",
  reads: {
    seedData: (root) => read(root, "packages/database/src/seed-data.ts"),
    attachments: (root) =>
      read(root, "packages/database/src/event-system/attachments.ts"),
    interceptor: (root) =>
      read(
        root,
        "packages/database/src/event-system/handlers/sync_advance_document_sequence.sql"
      )
  },
  rule() {
    const interceptorName = "sync_advance_document_sequence";

    /** A counter named differently from the table whose numbers it issues. */
    const counterTables: Record<string, string> = {
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
    const EXEMPT_COUNTERS: Record<string, string> = {
      charge: "no form or API write takes chargeId",
      fixedAssetTransfer:
        "no form or API write takes its transferId (the transferId tools are warehouse transfers)",
      inspection: "no form or API write takes inspectionId",
      jobOperationBatch: "no form or API write takes a batch's readableId",
      leaseRun:
        "a lease run is a revenueRecognitionRun of type Lease; no form or API write takes runId",
      reimbursement:
        "no form or API write takes reimbursementId (reimbursement lines only reference their parent)",
      revenueRecognitionRun: "no form or API write takes runId",
      projectStockTransfer:
        "no form or API write takes projectStockTransferId (the transfer insert takes it from get_next_sequence)"
    };

    type Entry = { name: string; line: number };

    /** The `table:` of every counter in `export const sequences = [...]`. */
    function counters(seedData: string): Entry[] {
      const start = seedData.indexOf("export const sequences = [");
      if (start === -1) return [];
      const end = seedData.indexOf("\n]", start);
      const block = seedData.slice(start, end === -1 ? undefined : end);
      return [...block.matchAll(/table: "(\w+)"/g)].map((m) => ({
        name: m[1] ?? "",
        line: lineOf(seedData, start + (m.index ?? 0))
      }));
    }

    function attachedTables(attachments: string): Entry[] {
      const keys = [...attachments.matchAll(/^ {2}(\w+): \{/gm)];
      return keys.flatMap((m, i) => {
        const from = m.index ?? 0;
        const to = keys[i + 1]?.index ?? attachments.length;
        return attachments.slice(from, to).includes(`"${interceptorName}"`)
          ? [{ name: m[1] ?? "", line: lineOf(attachments, from) }]
          : [];
      });
    }

    /** Tables named in the interceptor's `CASE p_table` (WHEN 'table' THEN 'column'). */
    function interceptedTables(interceptor: string): Entry[] {
      const tables: Entry[] = [];
      for (const { node, line } of sqlNodes(interceptor)) {
        if (!("CaseWhen" in node)) continue;
        const { expr, result } = node.CaseWhen;
        const table =
          expr && "A_Const" in expr ? expr.A_Const.sval?.sval : undefined;
        const column =
          result && "A_Const" in result ? result.A_Const.sval?.sval : undefined;
        if (table !== undefined && column !== undefined) {
          tables.push({ name: table, line });
        }
      }
      return tables;
    }

    return ({ seedData, attachments, interceptor }) => {
      const attached = attachedTables(attachments.contents);
      const intercepted = interceptedTables(interceptor.contents);
      const attachedNames = new Set(attached.map((t) => t.name));
      const interceptedNames = new Set(intercepted.map((t) => t.name));
      const out: Violation[] = [];

      for (const counter of counters(seedData.contents)) {
        const table = counterTables[counter.name] ?? counter.name;
        const covered = attachedNames.has(table) && interceptedNames.has(table);
        const exempt = counter.name in EXEMPT_COUNTERS;
        if (!covered && !exempt) {
          out.push({
            file: seedData.file,
            line: counter.line,
            snippet: `table: "${counter.name}"`,
            message: `Counter "${counter.name}" is not kept ahead of saved numbers. Add "${table}" to the CASE in ${interceptorName}.sql and give it the interceptor in attachments.ts, or add "${counter.name}" to EXEMPT_COUNTERS with the reason no caller ever supplies its number.`
          });
        }
        if (covered && exempt) {
          out.push({
            file: seedData.file,
            line: counter.line,
            snippet: `table: "${counter.name}"`,
            message: `Counter "${counter.name}" is covered by ${interceptorName}; remove it from EXEMPT_COUNTERS.`
          });
        }
      }

      for (const table of attached) {
        if (!interceptedNames.has(table.name)) {
          out.push({
            file: attachments.file,
            line: table.line,
            snippet: table.name,
            message: `"${table.name}" runs ${interceptorName} but is missing from its CASE, so the interceptor ignores it.`
          });
        }
      }

      for (const table of intercepted) {
        if (!attachedNames.has(table.name)) {
          out.push({
            file: interceptor.file,
            line: table.line,
            snippet: `WHEN '${table.name}'`,
            message: `"${table.name}" is in the ${interceptorName} CASE but not attached in attachments.ts, so it never runs.`
          });
        }
      }

      return out;
    };
  }
});
