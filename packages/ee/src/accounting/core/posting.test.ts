import { describe, expect, it } from "vitest";
import {
  aggregateJournalEntriesForDate,
  getDailyConsolidationNarration,
  getPostingSyncSourceTypeSkipReason,
  JournalEntrySyncError,
  netJournalLinesPerAccount,
  resolvePostingSyncSettings
} from "./posting";
import type { Accounting } from "./types";

// ── Daily-consolidation aggregation (Task 12) ────────────────────────────────
// One aggregated journal per posting date: signed amounts summed per account
// across the member journals, zero-net accounts dropped, balance asserted.

function journal(
  id: string,
  postingDate: string,
  lines: Array<{ accountId: string | null; amount: number }>
): Accounting.JournalEntry {
  return {
    id,
    companyId: "co_1",
    journalEntryId: `JE-${id}`,
    description: null,
    postingDate,
    status: "Posted",
    sourceType: "Purchase Receipt",
    reversalOfId: null,
    reversedById: null,
    reversal: false,
    lines: lines.map((line, index) => ({
      id: `${id}-line-${index}`,
      accountId: line.accountId,
      amount: line.amount,
      description: null
    })),
    updatedAt: "2026-07-08T12:00:00.000Z"
  };
}

describe("netJournalLinesPerAccount", () => {
  it("sums signed amounts per account with cents math", () => {
    const netted = netJournalLinesPerAccount([
      { accountId: "acct_a", amount: 0.1 },
      { accountId: "acct_a", amount: 0.2 },
      { accountId: "acct_b", amount: -0.3 }
    ]);
    // 0.1 + 0.2 must be exactly 0.3, not 0.30000000000000004
    expect(netted.get("acct_a")).toBe(0.3);
    expect(netted.get("acct_b")).toBe(-0.3);
  });

  it("nets lines without an account into the null bucket", () => {
    const netted = netJournalLinesPerAccount([
      { accountId: null, amount: 5 },
      { accountId: null, amount: 2.5 }
    ]);
    expect(netted.get(null)).toBe(7.5);
  });

  it("normalizes a fully-cancelled account to exactly 0", () => {
    const netted = netJournalLinesPerAccount([
      { accountId: "acct_a", amount: 10 },
      { accountId: "acct_a", amount: -10 }
    ]);
    expect(Object.is(netted.get("acct_a"), 0)).toBe(true);
  });
});

describe("aggregateJournalEntriesForDate", () => {
  it("aggregates 3 journals over 2 accounts into one balanced payload with summed lines", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 100 },
          { accountId: "acct_b", amount: -100 }
        ]),
        journal("j2", "2026-07-08", [
          { accountId: "acct_a", amount: 50.25 },
          { accountId: "acct_b", amount: -50.25 }
        ]),
        journal("j3", "2026-07-08", [
          { accountId: "acct_a", amount: 25.5 },
          { accountId: "acct_b", amount: -25.5 }
        ])
      ]
    });

    expect(aggregate.journal.id).toBe("daily:xero:2026-07-08");
    expect(aggregate.journal.postingDate).toBe("2026-07-08");
    expect(aggregate.journal.status).toBe("Posted");
    expect(aggregate.journalIds).toEqual(["j1", "j2", "j3"]);
    expect(aggregate.narration).toBe(
      "Carbon daily summary 2026-07-08 — 3 journals"
    );

    expect(aggregate.journal.lines).toHaveLength(2);
    expect(aggregate.journal.lines).toEqual([
      expect.objectContaining({ accountId: "acct_a", amount: 175.75 }),
      expect.objectContaining({ accountId: "acct_b", amount: -175.75 })
    ]);

    // The aggregate itself balances
    const total = aggregate.journal.lines.reduce(
      (sum, line) => sum + Math.round(line.amount * 100),
      0
    );
    expect(total).toBe(0);
  });

  it("drops accounts that net to zero across journals", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 100 },
          { accountId: "acct_c", amount: -100 }
        ]),
        journal("j2", "2026-07-08", [
          { accountId: "acct_a", amount: -100 },
          { accountId: "acct_b", amount: 100 }
        ])
      ]
    });

    // acct_a nets to zero and is dropped; b and c survive
    expect(aggregate.journal.lines.map((line) => line.accountId)).toEqual([
      "acct_b",
      "acct_c"
    ]);
    expect(aggregate.journal.lines.map((line) => line.amount)).toEqual([
      100, -100
    ]);
  });

  it("produces an empty-line aggregate when every account fully cancels (net-zero day)", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 100 },
          { accountId: "acct_b", amount: -100 }
        ]),
        journal("j2", "2026-07-08", [
          { accountId: "acct_a", amount: -100 },
          { accountId: "acct_b", amount: 100 }
        ])
      ]
    });

    expect(aggregate.journal.lines).toEqual([]);
  });

  it("throws JournalEntrySyncError UNBALANCED_JOURNAL on unbalanced input", () => {
    const build = () =>
      aggregateJournalEntriesForDate({
        batchId: "daily:xero:2026-07-08",
        companyId: "co_1",
        postingDate: "2026-07-08",
        journals: [
          journal("j1", "2026-07-08", [
            { accountId: "acct_a", amount: 100 },
            { accountId: "acct_b", amount: -90 }
          ])
        ]
      });

    expect(build).toThrowError(JournalEntrySyncError);
    try {
      build();
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNBALANCED_JOURNAL");
      expect(failure.warning).toBe(false);
      expect(failure.metadata).toEqual({
        postingDate: "2026-07-08",
        journalIds: ["j1"]
      });
    }
  });

  it("throws a plain Error when a member journal is dated off the batch date", () => {
    expect(() =>
      aggregateJournalEntriesForDate({
        batchId: "daily:xero:2026-07-08",
        companyId: "co_1",
        postingDate: "2026-07-08",
        journals: [
          journal("j1", "2026-07-09", [
            { accountId: "acct_a", amount: 100 },
            { accountId: "acct_b", amount: -100 }
          ])
        ]
      })
    ).toThrowError(/dated 2026-07-09, not 2026-07-08/);
  });

  it("throws a plain Error on an empty member list", () => {
    expect(() =>
      aggregateJournalEntriesForDate({
        batchId: "daily:xero:2026-07-08",
        companyId: "co_1",
        postingDate: "2026-07-08",
        journals: []
      })
    ).toThrowError(/zero journals/);
  });
});

describe("getDailyConsolidationNarration", () => {
  it("matches the spec narration format", () => {
    expect(getDailyConsolidationNarration("2026-07-08", 12)).toBe(
      "Carbon daily summary 2026-07-08 — 12 journals"
    );
  });
});

// ── Source-type gate ─────────────────────────────────────────────────────────

describe("getPostingSyncSourceTypeSkipReason", () => {
  const settings = resolvePostingSyncSettings(null);

  it("pushes the quality-scrap source types by default", () => {
    expect(
      getPostingSyncSourceTypeSkipReason("Non-Conformance", settings)
    ).toBeNull();
    expect(
      getPostingSyncSourceTypeSkipReason("Inbound Inspection", settings)
    ).toBeNull();
  });

  it("pushes Inventory Adjustment journals by default", () => {
    expect(
      getPostingSyncSourceTypeSkipReason("Inventory Adjustment", settings)
    ).toBeNull();
    expect(
      getPostingSyncSourceTypeSkipReason("Inventory Adjustment", settings, {
        inventoryAdjustmentEntitySyncEnabled: false
      })
    ).toBeNull();
  });

  it("skips Inventory Adjustment journals while the entity syncer owns them", () => {
    const reason = getPostingSyncSourceTypeSkipReason(
      "Inventory Adjustment",
      settings,
      { inventoryAdjustmentEntitySyncEnabled: true }
    );
    expect(reason).toContain("double-post");
  });

  it("keeps document-backed source types excluded regardless of the guard", () => {
    expect(
      getPostingSyncSourceTypeSkipReason("Sales Invoice", settings, {
        inventoryAdjustmentEntitySyncEnabled: true
      })
    ).toContain("document-backed");
  });

  it("skips unknown source types with a not-enabled reason", () => {
    expect(
      getPostingSyncSourceTypeSkipReason("Not A Source Type", settings)
    ).toContain("not enabled");
  });
});
