// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type MemoPartyLookup,
  type MemoPartyRow,
  memoPartyFromRow,
  resolveMemoJournalPartyFromClient,
  resolveMemoJournalPartyFromDatabase,
  resolveMemoPartyFromLookup
} from "./memo-party";

/**
 * A lookup over an in-memory world, recording which reads were made.
 *
 * `linesByJournalId` is the memo id a journal's OWN lines carry — only the
 * ORIGINAL posting journal and its VOID journal have one, which is the whole
 * point: `memoByJournalId` holds the `memo.journalId` pointer, and that names
 * the original only.
 */
function makeLookup(world: {
  linesByJournalId?: Record<string, string>;
  memosById?: Record<string, MemoPartyRow>;
  memoByJournalId?: Record<string, MemoPartyRow>;
}) {
  const reads: string[] = [];
  const lookup: MemoPartyLookup = {
    async findMemoIdOnJournalLines(journalId) {
      reads.push(`lines:${journalId}`);
      return world.linesByJournalId?.[journalId] ?? null;
    },
    async findMemoById(memoId) {
      reads.push(`memoById:${memoId}`);
      return world.memosById?.[memoId] ?? null;
    },
    async findMemoByJournalId(journalId) {
      reads.push(`memoByJournalId:${journalId}`);
      return world.memoByJournalId?.[journalId] ?? null;
    }
  };
  return { lookup, reads };
}

const customerMemo: MemoPartyRow = { customerId: "cust-1", supplierId: null };
const supplierMemo: MemoPartyRow = { customerId: null, supplierId: "supp-1" };

describe("memoPartyFromRow", () => {
  it("reads the party off the memo, and answers null when it has neither", () => {
    expect(memoPartyFromRow(customerMemo)).toBe("customer");
    expect(memoPartyFromRow(supplierMemo)).toBe("supplier");
    expect(memoPartyFromRow({ customerId: null, supplierId: null })).toBeNull();
    expect(memoPartyFromRow(null)).toBeNull();
  });
});

describe("resolveMemoPartyFromLookup", () => {
  // The regression. Voiding a memo INSERTS A NEW journal and leaves
  // `memo.journalId` on the original, so a void resolves only through the
  // journal LINES. Keying on `memo.journalId` alone answered null here, the
  // policy parked MEMO_PARTY_UNRESOLVED, and in `journals` mode the void
  // never reached the provider.
  it("resolves a VOID memo journal for a customer memo", async () => {
    const { lookup, reads } = makeLookup({
      linesByJournalId: { "journal-void": "memo-1" },
      memosById: { "memo-1": customerMemo },
      // the pointer names the ORIGINAL journal, never the void
      memoByJournalId: { "journal-original": customerMemo }
    });

    expect(await resolveMemoPartyFromLookup(lookup, "journal-void")).toBe(
      "customer"
    );
    expect(reads).toEqual(["lines:journal-void", "memoById:memo-1"]);
  });

  it("resolves a VOID memo journal for a supplier memo", async () => {
    const { lookup } = makeLookup({
      linesByJournalId: { "journal-void": "memo-2" },
      memosById: { "memo-2": supplierMemo },
      memoByJournalId: { "journal-original": supplierMemo }
    });

    expect(await resolveMemoPartyFromLookup(lookup, "journal-void")).toBe(
      "supplier"
    );
  });

  it("still resolves the ORIGINAL posting journal through its lines", async () => {
    const { lookup, reads } = makeLookup({
      linesByJournalId: { "journal-original": "memo-1" },
      memosById: { "memo-1": customerMemo },
      memoByJournalId: { "journal-original": customerMemo }
    });

    expect(await resolveMemoPartyFromLookup(lookup, "journal-original")).toBe(
      "customer"
    );
    // The lines answer first; the `memo.journalId` read is never made.
    expect(reads).toEqual(["lines:journal-original", "memoById:memo-1"]);
  });

  it("falls back to memo.journalId when the journal's lines carry no memo", async () => {
    const { lookup, reads } = makeLookup({
      linesByJournalId: {},
      memoByJournalId: { "journal-original": supplierMemo }
    });

    expect(await resolveMemoPartyFromLookup(lookup, "journal-original")).toBe(
      "supplier"
    );
    expect(reads).toEqual([
      "lines:journal-original",
      "memoByJournalId:journal-original"
    ]);
  });

  it("answers null when neither path finds a memo", async () => {
    const { lookup } = makeLookup({});
    expect(await resolveMemoPartyFromLookup(lookup, "journal-x")).toBeNull();
  });

  it("answers null for a memo whose lines resolve an id with no party", async () => {
    const { lookup } = makeLookup({
      linesByJournalId: { "journal-void": "memo-3" },
      memosById: { "memo-3": { customerId: null, supplierId: null } }
    });
    expect(await resolveMemoPartyFromLookup(lookup, "journal-void")).toBeNull();
  });
});

/**
 * Minimal chainable Kysely mock. `selectFrom(...).select(...).where(...)*
 * [.limit(1)].executeTakeFirst()` resolves from `rowsByTable`; `captured`
 * records each query's table and `where` predicates for assertions.
 */
function makeDatabase(rowsByTable: Record<string, unknown>) {
  const captured: Array<Record<string, unknown>> = [];
  const database: any = {
    selectFrom(table: string) {
      const query: Record<string, unknown> = { table };
      captured.push(query);
      const builder: any = {
        select: () => builder,
        where: (column: string, operator: string, value: unknown) => {
          query[column] = operator === "=" ? value : `${operator} ${value}`;
          return builder;
        },
        limit: (n: number) => {
          query.limit = n;
          return builder;
        },
        executeTakeFirst: async () => rowsByTable[table] ?? undefined
      };
      return builder;
    }
  };
  return { database, captured };
}

describe("resolveMemoJournalPartyFromDatabase", () => {
  it("scopes both reads by companyId and keys the lines read on documentType Memo", async () => {
    const { database, captured } = makeDatabase({
      journalLine: { documentId: "memo-1" },
      memo: customerMemo
    });

    expect(
      await resolveMemoJournalPartyFromDatabase(database, {
        companyId: "company-1",
        journalId: "journal-void"
      })
    ).toBe("customer");

    expect(captured).toEqual([
      {
        table: "journalLine",
        companyId: "company-1",
        journalId: "journal-void",
        documentType: "Memo",
        documentId: "is not null",
        limit: 1
      },
      { table: "memo", companyId: "company-1", id: "memo-1" }
    ]);
  });

  it("reads memo by journalId, still companyId-scoped, when no line carries a memo", async () => {
    const { database, captured } = makeDatabase({ memo: supplierMemo });

    expect(
      await resolveMemoJournalPartyFromDatabase(database, {
        companyId: "company-1",
        journalId: "journal-original"
      })
    ).toBe("supplier");

    expect(captured[1]).toEqual({
      table: "memo",
      companyId: "company-1",
      journalId: "journal-original"
    });
  });
});

/**
 * Minimal chainable supabase mock, same shape as the one in
 * payment-tombstone.test.ts: `from(...).select(...).eq(...)*[.not(...)]
 * [.limit(1)].maybeSingle()` resolves `{ data, error }` per table.
 */
function makeClient(
  resultsByTable: Record<string, { data: unknown; error?: { message: string } }>
) {
  const captured: Array<Record<string, unknown>> = [];
  const client: any = {
    from(table: string) {
      const query: Record<string, unknown> = { table };
      captured.push(query);
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          query[column] = value;
          return builder;
        },
        not: (column: string, operator: string, value: unknown) => {
          query[column] = `not ${operator} ${value}`;
          return builder;
        },
        limit: (n: number) => {
          query.limit = n;
          return builder;
        },
        maybeSingle: async () => {
          const result = resultsByTable[table] ?? { data: null };
          return { data: result.data, error: result.error ?? null };
        }
      };
      return builder;
    }
  };
  return { client, captured };
}

describe("resolveMemoJournalPartyFromClient", () => {
  it("resolves a VOID memo journal through the journal lines, companyId-scoped", async () => {
    const { client, captured } = makeClient({
      journalLine: { data: { documentId: "memo-1" } },
      memo: { data: customerMemo }
    });

    expect(
      await resolveMemoJournalPartyFromClient(client, {
        companyId: "company-1",
        journalId: "journal-void"
      })
    ).toBe("customer");

    expect(captured).toEqual([
      {
        table: "journalLine",
        companyId: "company-1",
        journalId: "journal-void",
        documentType: "Memo",
        documentId: "not is null",
        limit: 1
      },
      { table: "memo", companyId: "company-1", id: "memo-1" }
    ]);
  });

  it("falls back to memo.journalId when the lines read finds nothing", async () => {
    const { client, captured } = makeClient({
      journalLine: { data: null },
      memo: { data: supplierMemo }
    });

    expect(
      await resolveMemoJournalPartyFromClient(client, {
        companyId: "company-1",
        journalId: "journal-original"
      })
    ).toBe("supplier");

    expect(captured[1]).toEqual({
      table: "memo",
      companyId: "company-1",
      journalId: "journal-original"
    });
  });

  it("treats a failed lines read as 'no memo link' rather than a party", async () => {
    // A read error must not be mistaken for a resolved party: fall through to
    // the pointer, and answer null when that finds nothing either.
    const { client } = makeClient({
      journalLine: { data: null, error: { message: "boom" } },
      memo: { data: null }
    });

    expect(
      await resolveMemoJournalPartyFromClient(client, {
        companyId: "company-1",
        journalId: "journal-void"
      })
    ).toBeNull();
  });
});
