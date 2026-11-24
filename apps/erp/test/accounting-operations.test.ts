// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import {
  createFiscalYearPeriods,
  reopenPeriod,
  saveJournalEntry
} from "../app/modules/accounting/accounting.server";
import { accountMoveRefusal } from "../app/modules/accounting/accounting.utils";

// A handle with no methods: a refusal that reached the database fails the test.
const unreachable = () => {
  throw new Error("must not be reached");
};

const context = (caller: unknown = {}, system: unknown = unreachable) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        accounting: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: ["company-1"]
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: caller as never,
    system: (system === unreachable ? unreachable : () => system) as never,
    pg: unreachable,
    kv: unreachable
  });

const line = (debit: number, credit: number, accountId = "acc-1") => ({
  accountId,
  debit,
  credit
});

describe("saveJournalEntry", () => {
  it("refuses a line with both a debit and a credit, before saving", async () => {
    const result = await saveJournalEntry(context(), {
      journalEntryId: "je-1",
      postingDate: "2026-10-01",
      lines: [line(10, 0), line(5, 5)]
    });
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Each line must have either a debit or credit amount"
    });
  });

  it("refuses a line with no account", async () => {
    const result = await saveJournalEntry(context(), {
      journalEntryId: "je-1",
      postingDate: "2026-10-01",
      lines: [line(10, 0, "")]
    });
    expect(result.error).toMatchObject({
      message: "Each line must have an account"
    });
  });
});

describe("moving an account", () => {
  // 1000 Assets ⊃ 1100 Current Assets ⊃ 1110 Cash (a leaf)
  const chart = [
    { id: "assets", parentId: null, isGroup: true },
    { id: "current", parentId: "assets", isGroup: true },
    { id: "cash", parentId: "current", isGroup: false }
  ];

  it("refuses to move a group under one of its own accounts", () => {
    expect(accountMoveRefusal(chart, "assets", "current")).toBe(
      "An account cannot move under itself or one of its own accounts"
    );
    expect(accountMoveRefusal(chart, "current", "current")).toBe(
      "An account cannot move under itself or one of its own accounts"
    );
  });

  it("refuses a parent that is not a group, or not in the chart", () => {
    expect(accountMoveRefusal(chart, "current", "cash")).toBe(
      "Choose a group account to move it under"
    );
    expect(accountMoveRefusal(chart, "cash", "elsewhere")).toBe(
      "Choose a group account to move it under"
    );
  });

  it("allows a move under another group", () => {
    expect(accountMoveRefusal(chart, "cash", "assets")).toBeNull();
  });
});

describe("reopenPeriod", () => {
  it("needs accounting delete, which lock and unlock do not", async () => {
    const ctx = createServiceContext({
      actor: {
        type: "user",
        userId: "user-1",
        permissions: {
          accounting: {
            view: ["company-1"],
            create: ["company-1"],
            update: ["company-1"],
            delete: []
          }
        }
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: {} as never,
      system: unreachable,
      pg: unreachable,
      kv: unreachable
    });
    const result = await reopenPeriod(ctx, { periodId: "period-1" });
    expect(result.error).toMatchObject({ category: "forbidden" });
  });
});

describe("createFiscalYearPeriods", () => {
  const january = { data: { startMonth: "January" }, error: null };

  /** A fiscal year read as `settings`, with periods `existing`; an insert
   *  answers each row's id from its period number. */
  function periodsClient(
    existing: number[],
    settings: { data: unknown; error: unknown } = january,
    inserts: unknown[][] = []
  ) {
    return {
      from(table: string) {
        let inserted: { periodNumber: number }[] | null = null;
        const answer = () => {
          if (table === "fiscalYearSettings") return settings;
          if (inserted) {
            return {
              data: inserted.map((row) => ({ id: `p-${row.periodNumber}` })),
              error: null
            };
          }
          return {
            data: existing.map((periodNumber) => ({ periodNumber })),
            error: null
          };
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          insert: (rows: { periodNumber: number }[]) => {
            inserted = rows;
            inserts.push(rows);
            return chain;
          },
          single: async () => answer(),
          maybeSingle: async () => answer(),
          then: (resolve: (value: unknown) => unknown) => resolve(answer())
        };
        return chain;
      }
    };
  }

  it("answers the ids of the periods it created", async () => {
    const client = periodsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = await createFiscalYearPeriods(context(client, client), {
      fiscalYear: 2026
    });
    expect(result).toEqual({ data: { ids: ["p-11", "p-12"] }, error: null });
  });

  // A failed read of the start month must not start the year in January.
  it("creates no period when the fiscal year settings cannot be read", async () => {
    const inserts: unknown[][] = [];
    const client = periodsClient(
      [],
      {
        data: null,
        error: { code: "08006", message: "connection failure" }
      },
      inserts
    );
    const result = await createFiscalYearPeriods(context(client, client), {
      fiscalYear: 2026
    });
    expect(result.error).not.toBeNull();
    expect(inserts).toEqual([]);
  });

  it.each([1999, 2026.5])(
    "refuses fiscal year %s, which the Generate Fiscal Year form refuses",
    async (fiscalYear) => {
      const result = await createFiscalYearPeriods(context(unreachable), {
        fiscalYear
      });
      expect(result.error).toMatchObject({ category: "validation" });
    }
  );
});
