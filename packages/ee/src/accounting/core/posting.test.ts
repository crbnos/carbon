import { describe, expect, it } from "vitest";
import {
  aggregateJournalEntriesForDate,
  collectUnmappedDimensionValues,
  getDailyConsolidationNarration,
  getDimensionTupleKey,
  getPostingSyncSourceTypeSkipReason,
  isPaymentSyncbackEnabled,
  JournalEntrySyncError,
  netJournalLinesPerAccount,
  resolvePostingSyncSettings,
  runJournalEntryPreflight,
  toDebitSignedAmount
} from "./posting";
import type { Accounting } from "./types";

// ── Daily-consolidation aggregation (Task 12) ────────────────────────────────
// One aggregated journal per posting date: signed amounts summed per account
// across the member journals, zero-net accounts dropped, balance asserted.

function journal(
  id: string,
  postingDate: string,
  lines: Array<{
    accountId: string | null;
    amount: number;
    dimensions?: Array<{ dimensionId: string; valueId: string }>;
  }>
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
      description: null,
      ...(line.dimensions ? { dimensions: line.dimensions } : {})
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

  it("carries the source type for v3 per-source-type batches", () => {
    expect(
      getDailyConsolidationNarration("2026-07-08", 3, "Production Event")
    ).toBe("Carbon daily summary 2026-07-08 — Production Event — 3 journals");
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

// ── Natural-balance → debit-signed conversion ───────────────────────────────
// Carbon's post-* edge functions sign journalLine.amount by the account's
// NATURAL balance (credit("liability", x) stores +x), so the engine converts
// at fetch time; see toDebitSignedAmount.

describe("toDebitSignedAmount", () => {
  it("keeps Asset/Expense signs (natural balance is debit)", () => {
    expect(toDebitSignedAmount("Asset", 300)).toBe(300);
    expect(toDebitSignedAmount("Expense", 42.5)).toBe(42.5);
    expect(toDebitSignedAmount("Asset", -300)).toBe(-300);
  });

  it("negates Liability/Equity/Revenue (natural balance is credit)", () => {
    expect(toDebitSignedAmount("Liability", 300)).toBe(-300);
    expect(toDebitSignedAmount("Equity", 100)).toBe(-100);
    expect(toDebitSignedAmount("Revenue", 50)).toBe(-50);
    expect(toDebitSignedAmount("Liability", -300)).toBe(300);
  });

  it("passes unknown/missing classes through unchanged", () => {
    expect(toDebitSignedAmount(null, 10)).toBe(10);
    expect(toDebitSignedAmount(undefined, 10)).toBe(10);
  });

  it("balances a real receipt journal: inventory debit + GR/IR credit", () => {
    // As stored by post-receipt: both lines +300 (natural balance)
    const converted = [
      toDebitSignedAmount("Asset", 300), // Raw Materials
      toDebitSignedAmount("Liability", 300) // Goods Received Not Invoiced
    ];
    expect(converted.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ── Dimension pre-flight (Phase 2, spec §3) ─────────────────────────────────

const LOCATION_DIM = "dim_loc";
const ATLANTA = { dimensionId: LOCATION_DIM, valueId: "loc_atl" };
const BOSTON = { dimensionId: LOCATION_DIM, valueId: "loc_bos" };

function dimensionSettings(onUnmapped: "warn" | "drop") {
  return resolvePostingSyncSettings({
    settings: {
      postingSync: {
        enabled: true,
        dimensionSlots: [{ dimensionId: LOCATION_DIM, target: "class" }],
        onUnmappedDimensionValue: onUnmapped
      }
    }
  });
}

describe("collectUnmappedDimensionValues", () => {
  const slots = [{ dimensionId: LOCATION_DIM }];

  it("returns distinct slotted values with no provider mapping", () => {
    const unmapped = collectUnmappedDimensionValues(
      [
        { dimensions: [ATLANTA] },
        { dimensions: [ATLANTA, BOSTON] }, // Atlanta repeats — reported once
        { dimensions: undefined }
      ],
      slots,
      new Map()
    );

    expect(unmapped).toEqual([ATLANTA, BOSTON]);
  });

  it("ignores mapped values and unslotted dimensions entirely", () => {
    const unmapped = collectUnmappedDimensionValues(
      [
        {
          dimensions: [
            ATLANTA,
            { dimensionId: "dim_unslotted", valueId: "x" } // not slotted → untouched
          ]
        }
      ],
      slots,
      new Map([["dim_loc:loc_atl", "opt-1"]])
    );

    expect(unmapped).toEqual([]);
  });

  it("returns [] when no slots are configured", () => {
    expect(
      collectUnmappedDimensionValues([{ dimensions: [ATLANTA] }], [], new Map())
    ).toEqual([]);
  });
});

describe("runJournalEntryPreflight — dimension rule", () => {
  const accountCodesById = new Map([
    ["acct_a", "1400"],
    ["acct_b", "2100"]
  ]);
  const baseArgs = {
    accountCodesById,
    controlAccountIds: new Set<string>(),
    lockDate: null
  };
  const dimensionedJournal = journal("j1", "2026-07-08", [
    { accountId: "acct_a", amount: 100, dimensions: [ATLANTA] },
    { accountId: "acct_b", amount: -100 }
  ]);

  it("parks with UNMAPPED_DIMENSION_VALUES (Warning) under the warn policy", () => {
    const result = runJournalEntryPreflight({
      ...baseArgs,
      journal: dimensionedJournal,
      settings: dimensionSettings("warn"),
      dimensionValueMappings: new Map()
    });

    expect(result.failure?.errorCode).toBe("UNMAPPED_DIMENSION_VALUES");
    expect(result.failure?.warning).toBe(true);
    expect(result.failure?.metadata).toEqual({
      unmappedDimensionValues: [ATLANTA]
    });
  });

  it("passes and reports the dropped values under the drop policy (recorded, never silent)", () => {
    const result = runJournalEntryPreflight({
      ...baseArgs,
      journal: dimensionedJournal,
      settings: dimensionSettings("drop"),
      dimensionValueMappings: new Map()
    });

    expect(result.failure).toBeNull();
    if (result.failure === null) {
      expect(result.pushDate).toBe("2026-07-08");
      expect(result.droppedDimensionValues).toEqual([ATLANTA]);
    }
  });

  it("passes cleanly when every slotted value is mapped", () => {
    const result = runJournalEntryPreflight({
      ...baseArgs,
      journal: dimensionedJournal,
      settings: dimensionSettings("warn"),
      dimensionValueMappings: new Map([["dim_loc:loc_atl", "opt-1"]])
    });

    expect(result.failure).toBeNull();
    if (result.failure === null) {
      expect(result.droppedDimensionValues).toBeUndefined();
    }
  });

  it("skips the rule entirely for callers that do not load dimension mappings", () => {
    const result = runJournalEntryPreflight({
      ...baseArgs,
      journal: dimensionedJournal,
      settings: dimensionSettings("warn")
      // no dimensionValueMappings — legacy path
    });

    expect(result.failure).toBeNull();
  });
});

// ── Dimension-tuple grouping + rounding residue (spec §4) ───────────────────

describe("getDimensionTupleKey", () => {
  it("is canonical: sorted by dimensionId, independent of input order", () => {
    const a = getDimensionTupleKey([
      { dimensionId: "dim_b", valueId: "2" },
      { dimensionId: "dim_a", valueId: "1" }
    ]);
    const b = getDimensionTupleKey([
      { dimensionId: "dim_a", valueId: "1" },
      { dimensionId: "dim_b", valueId: "2" }
    ]);
    expect(a).toBe(b);
    expect(a).toBe("dim_a=1|dim_b=2");
  });

  it("restricts to the slotted dimensions when provided", () => {
    const key = getDimensionTupleKey(
      [ATLANTA, { dimensionId: "dim_unslotted", valueId: "x" }],
      new Set([LOCATION_DIM])
    );
    expect(key).toBe("dim_loc=loc_atl");
  });

  it("returns the empty tuple for lines without dimensions", () => {
    expect(getDimensionTupleKey(undefined)).toBe("");
    expect(getDimensionTupleKey([])).toBe("");
  });
});

describe("aggregateJournalEntriesForDate — dimension tuples", () => {
  it("groups by (accountId, dimension tuple): two locations produce two lines on the same account", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:production-event:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      sourceType: "Production Event",
      journals: [
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 100, dimensions: [ATLANTA] },
          { accountId: "acct_b", amount: -100 }
        ]),
        journal("j2", "2026-07-08", [
          { accountId: "acct_a", amount: 50, dimensions: [BOSTON] },
          { accountId: "acct_b", amount: -50 }
        ]),
        journal("j3", "2026-07-08", [
          { accountId: "acct_a", amount: 25, dimensions: [ATLANTA] },
          { accountId: "acct_b", amount: -25 }
        ])
      ],
      slottedDimensionIds: [LOCATION_DIM]
    });

    expect(aggregate.journal.lines).toEqual([
      expect.objectContaining({
        accountId: "acct_a",
        amount: 125,
        dimensions: [ATLANTA]
      }),
      expect.objectContaining({
        accountId: "acct_a",
        amount: 50,
        dimensions: [BOSTON]
      }),
      expect.objectContaining({ accountId: "acct_b", amount: -175 })
    ]);
    expect(
      aggregate.journal.lines.reduce(
        (sum, line) => sum + Math.round(line.amount * 100),
        0
      )
    ).toBe(0);
  });

  it("keeps unslotted dimensions out of the tuple when slottedDimensionIds is provided", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        journal("j1", "2026-07-08", [
          {
            accountId: "acct_a",
            amount: 100,
            dimensions: [{ dimensionId: "dim_item", valueId: "item_1" }]
          },
          {
            accountId: "acct_a",
            amount: 50,
            dimensions: [{ dimensionId: "dim_item", valueId: "item_2" }]
          },
          { accountId: "acct_b", amount: -150 }
        ])
      ],
      slottedDimensionIds: [LOCATION_DIM]
    });

    // Both item-dimensioned lines collapse into one per-account bucket
    expect(aggregate.journal.lines).toEqual([
      expect.objectContaining({ accountId: "acct_a", amount: 150 }),
      expect.objectContaining({ accountId: "acct_b", amount: -150 })
    ]);
  });

  it("books post-2dp rounding residue to the rounding account when provided", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        // Sub-cent input: +10.005 rounds to 10.01, -10.004 rounds to -10.00
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 10.005 },
          { accountId: "acct_b", amount: -10.004 }
        ])
      ],
      roundingAccountId: "acct_rounding"
    });

    const roundingLine = aggregate.journal.lines.find(
      (line) => line.accountId === "acct_rounding"
    );
    expect(roundingLine?.amount).toBe(-0.01);
    expect(
      aggregate.journal.lines.reduce(
        (sum, line) => sum + Math.round(line.amount * 100),
        0
      )
    ).toBe(0);
  });

  it("still throws UNBALANCED_JOURNAL without a rounding account (legacy behavior)", () => {
    expect(() =>
      aggregateJournalEntriesForDate({
        batchId: "daily:xero:2026-07-08",
        companyId: "co_1",
        postingDate: "2026-07-08",
        journals: [
          journal("j1", "2026-07-08", [
            { accountId: "acct_a", amount: 10.005 },
            { accountId: "acct_b", amount: -10.004 }
          ])
        ]
      })
    ).toThrowError(JournalEntrySyncError);
  });

  it("refuses to bury a real imbalance in the rounding account (residue cap: half a cent per line)", () => {
    expect(() =>
      aggregateJournalEntriesForDate({
        batchId: "daily:xero:2026-07-08",
        companyId: "co_1",
        postingDate: "2026-07-08",
        journals: [
          journal("j1", "2026-07-08", [
            { accountId: "acct_a", amount: 100 },
            { accountId: "acct_b", amount: -95 }
          ])
        ],
        roundingAccountId: "acct_rounding"
      })
    ).toThrowError(JournalEntrySyncError);
  });
});

// ── Documents-mode payment sync-back gate (Phase 0.4) ────────────────────────
// Inbound payment pull is allowed for a family only when it is in `documents`
// mode; a missing/invalid config defaults to documents (sync-back enabled).

describe("isPaymentSyncbackEnabled", () => {
  function metadata(family: "ar" | "ap", mode: string) {
    return { settings: { postingSync: { families: { [family]: mode } } } };
  }

  it("returns true when the family is in documents mode", () => {
    expect(isPaymentSyncbackEnabled(metadata("ar", "documents"), "ar")).toBe(
      true
    );
    expect(isPaymentSyncbackEnabled(metadata("ap", "documents"), "ap")).toBe(
      true
    );
  });

  it("returns false when the family is in journals mode", () => {
    expect(isPaymentSyncbackEnabled(metadata("ar", "journals"), "ar")).toBe(
      false
    );
    expect(isPaymentSyncbackEnabled(metadata("ap", "journals"), "ap")).toBe(
      false
    );
  });

  it("returns false when the family is set to none", () => {
    expect(isPaymentSyncbackEnabled(metadata("ar", "none"), "ar")).toBe(false);
    expect(isPaymentSyncbackEnabled(metadata("ap", "none"), "ap")).toBe(false);
  });

  it("defaults to enabled (documents) for absent or invalid metadata", () => {
    expect(isPaymentSyncbackEnabled(undefined, "ar")).toBe(true);
    expect(isPaymentSyncbackEnabled(null, "ap")).toBe(true);
    expect(isPaymentSyncbackEnabled({}, "ar")).toBe(true);
    expect(isPaymentSyncbackEnabled({ settings: {} }, "ap")).toBe(true);
    // A bad stored fragment resolves to defaults, not a crash.
    expect(
      isPaymentSyncbackEnabled(
        { settings: { postingSync: { families: "nonsense" } } },
        "ar"
      )
    ).toBe(true);
  });

  it("gates each family independently", () => {
    const meta = {
      settings: {
        postingSync: { families: { ar: "documents", ap: "journals" } }
      }
    };
    expect(isPaymentSyncbackEnabled(meta, "ar")).toBe(true);
    expect(isPaymentSyncbackEnabled(meta, "ap")).toBe(false);
  });
});
