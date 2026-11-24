// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findUnsyncedDocumentSequences } from "./document-sequence-synced";

const seedData = (...tables: string[]) => ({
  file: "seed-data.ts",
  contents: `export const sequences = [\n${tables
    .map((t) => `  {\n    table: "${t}",\n    prefix: "X"\n  },`)
    .join("\n")}\n] as const;\n`
});

const attachments = (...tables: string[]) => ({
  file: "attachments.ts",
  contents: `export const attachments = {\n${tables
    .map(
      (t) =>
        `  ${t}: { after: ["sync_advance_document_sequence"], events: true },`
    )
    .join("\n")}\n  other: { events: true }\n} as const;\n`
});

const interceptor = (...tables: string[]) => ({
  file: "sync_advance_document_sequence.sql",
  contents: `v_column := CASE p_table\n${tables
    .map((t) => `    WHEN '${t}' THEN '${t}Id'`)
    .join("\n")}\n  END;\n`
});

const messages = (
  sources: Parameters<typeof findUnsyncedDocumentSequences>[0]
) =>
  findUnsyncedDocumentSequences(sources).map((v) => `${v.file}: ${v.snippet}`);

describe("findUnsyncedDocumentSequences", () => {
  it("accepts a counter whose table is attached and in the CASE", () => {
    expect(
      messages({
        seedData: seedData("salesOrder"),
        attachments: attachments("salesOrder"),
        interceptor: interceptor("salesOrder")
      })
    ).toEqual([]);
  });

  it("flags a new counter that is neither covered nor exempt", () => {
    expect(
      messages({
        seedData: seedData("salesOrder", "widgetOrder"),
        attachments: attachments("salesOrder"),
        interceptor: interceptor("salesOrder")
      })
    ).toEqual(['seed-data.ts: table: "widgetOrder"']);
  });

  it("accepts an exempt counter, and flags one that is also covered", () => {
    expect(
      messages({
        seedData: seedData("inspection"),
        attachments: attachments(),
        interceptor: interceptor()
      })
    ).toEqual([]);
    expect(
      messages({
        seedData: seedData("inspection"),
        attachments: attachments("inspection"),
        interceptor: interceptor("inspection")
      })
    ).toEqual(['seed-data.ts: table: "inspection"']);
  });

  it("maps counters named differently from their table", () => {
    expect(
      messages({
        seedData: seedData("journalEntry", "creditMemo", "debitMemo"),
        attachments: attachments("journal", "memo"),
        interceptor: interceptor("journal", "memo")
      })
    ).toEqual([]);
  });

  it("flags a table attached but missing from the CASE, and the reverse", () => {
    expect(
      messages({
        seedData: seedData(),
        attachments: attachments("quote"),
        interceptor: interceptor("job")
      })
    ).toEqual([
      "attachments.ts: quote",
      "sync_advance_document_sequence.sql: WHEN 'job'"
    ]);
  });

  it("flags the counters b091e313b6 left behind, and passes its fix", () => {
    // packages/database/src/seed-data.ts and
    // packages/database/src/event-system/attachments.ts before b091e313b6:
    // no table ran sync_advance_document_sequence, so a job or journal entry
    // numbered through MCP or a typed ID left the counter behind.
    const seed = {
      file: "seed-data.ts",
      contents: `export const sequences = [
  {
    table: "journalEntry",
    name: "Journal Entry",
    prefix: "JE-%{yyyy}-%{mm}-",
  },
  {
    table: "job",
    name: "Job",
    prefix: "J",
  },
  {
    table: "jobOperationBatch",
    name: "Operation Batch",
    prefix: "BAT",
  },
] as const;
`
    };
    const before = {
      file: "attachments.ts",
      contents: `export const attachments = {
  job: {
    before: ["sync_job_complete_or_canceled"],
    after: ["sync_insert_job_make_method", "sync_job_recompute_service_line"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  journal: { events: true, statement: ["broadcast_table_changes"] },
  journalLine: { events: true },
} as const;
`
    };
    expect(
      messages({
        seedData: seed,
        attachments: before,
        interceptor: {
          file: "sync_advance_document_sequence.sql",
          contents: ""
        }
      })
    ).toEqual([
      'seed-data.ts: table: "journalEntry"',
      'seed-data.ts: table: "job"'
    ]);

    // The same files at b091e313b6.
    const after = {
      file: "attachments.ts",
      contents: `export const attachments = {
  job: {
    before: ["sync_job_complete_or_canceled"],
    after: [
      "sync_insert_job_make_method",
      "sync_job_recompute_service_line",
      "sync_advance_document_sequence"
    ],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  journal: {
    after: ["sync_advance_document_sequence"],
    events: true,
    statement: ["broadcast_table_changes"]
  },
  journalLine: { events: true },
} as const;
`
    };
    expect(
      messages({
        seedData: seed,
        attachments: after,
        interceptor: interceptor("job", "journal")
      })
    ).toEqual([]);
  });
});
