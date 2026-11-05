// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { asCarbonOwnedSettings } from "../../sync/delegation";
import {
  addDaysToIsoDate,
  aggregateJournalEntriesForDate,
  collectUnmappedDimensionValues,
  DEFAULT_POSTING_SYNC_SETTINGS,
  evaluatePeriodLock,
  getDailyConsolidationNarration,
  getDimensionTupleKey,
  getJournalEntrySyncEntityId,
  getPostingSyncSourceTypeSkipReason,
  getZeroJournalSkipReason,
  isBalancedJournal,
  isJournalEntrySyncFailure,
  isPaymentSyncbackEnabled,
  isZeroJournal,
  JournalEntrySyncError,
  netJournalLinesPerAccount,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  runJournalEntryPreflight,
  toDebitSignedAmount
} from "./posting";
import type { Accounting } from "./types";

// ── Daily-consolidation aggregation ────────────────────────────────────────
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

// ── Drain-time backstop ──────────────────────────────────────────────────────
// The policy decisions themselves are in posting-policy.test.ts. The backstop
// derives document-sync flags from the family modes and forwards the memo
// party; a skip returns the decision's message, a push returns null.

describe("getPostingSyncSourceTypeSkipReason", () => {
  const settingsWith = (families?: Record<string, string>) =>
    asCarbonOwnedSettings(
      resolvePostingSyncSettings(
        families ? { settings: { postingSync: { families } } } : null
      )
    );
  const memoJournals = {
    ar: "documents",
    ap: "documents",
    creditMemo: "journals",
    supplierCredit: "journals"
  };

  it.each<
    [
      string,
      string,
      Record<string, string> | undefined,
      Parameters<typeof getPostingSyncSourceTypeSkipReason>[2],
      boolean
    ]
  >([
    ["pushes", "Purchase Receipt", undefined, undefined, true],
    ["skips", "Sales Invoice", undefined, undefined, false],
    [
      "skips",
      "Inventory Adjustment",
      undefined,
      { inventoryAdjustmentEntitySyncEnabled: true },
      false
    ],
    // A journals-mode family has its document sync off, so no double-representation warning.
    [
      "pushes",
      "Sales Invoice",
      { ar: "journals", ap: "documents" },
      undefined,
      true
    ],
    ["pushes", "Credit Memo", memoJournals, { memoParty: "supplier" }, true],
    // Without the party a memo parks as unresolved, a delivery hole in journals mode.
    ["skips", "Credit Memo", memoJournals, undefined, false]
  ])(
    "%s a %s journal (families %o, options %o)",
    (_verb, sourceType, families, options, pushes) => {
      const reason = getPostingSyncSourceTypeSkipReason(
        sourceType,
        settingsWith(families),
        options
      );
      if (pushes) expect(reason).toBeNull();
      else expect(reason).toEqual(expect.any(String));
    }
  );
});

// ── Natural-balance → debit-signed conversion ───────────────────────────────
// Carbon's post-* server functions sign journalLine.amount by the account's
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
  return asCarbonOwnedSettings(
    resolvePostingSyncSettings({
      settings: {
        postingSync: {
          enabled: true,
          dimensionSlots: [{ dimensionId: LOCATION_DIM, target: "class" }],
          onUnmappedDimensionValue: onUnmapped
        }
      }
    })
  );
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

// ── Zero journals ────────────────────────────────────────────────────────────
// Carbon writes a journal pair for an outbound inventory movement even at
// zero cost. A journal whose every line is 0.00 books nothing, so a per-line
// push skips it, and the daily summary never pushes an empty aggregate.

describe("zero journals", () => {
  it("skips a per-line journal whose every line is zero", () => {
    const zeroPair = journal("j1", "2026-07-08", [
      { accountId: "acct_a", amount: 0 },
      { accountId: "acct_b", amount: -0 }
    ]);

    expect(isZeroJournal(zeroPair.lines)).toBe(true);
    expect(getZeroJournalSkipReason(zeroPair)).toBe(
      "Journal JE-j1 has no non-zero lines; there is nothing to post to the provider"
    );
  });

  it("treats a sub-cent line as zero, at the 2dp balance precision", () => {
    const subCent = journal("j1", "2026-07-08", [
      { accountId: "acct_a", amount: 0.004 },
      { accountId: "acct_b", amount: -0.004 }
    ]);

    expect(getZeroJournalSkipReason(subCent)).not.toBeNull();
  });

  it("still pushes a journal with one non-zero pair beside a zero pair", () => {
    const mixed = journal("j1", "2026-07-08", [
      { accountId: "acct_a", amount: 0 },
      { accountId: "acct_b", amount: 0 },
      { accountId: "acct_a", amount: 0.01 },
      { accountId: "acct_b", amount: -0.01 }
    ]);

    expect(isZeroJournal(mixed.lines)).toBe(false);
    expect(getZeroJournalSkipReason(mixed)).toBeNull();
  });

  it("does not push an empty daily aggregate (every account nets to zero)", () => {
    const aggregate = aggregateJournalEntriesForDate({
      batchId: "daily:xero:2026-07-08",
      companyId: "co_1",
      postingDate: "2026-07-08",
      journals: [
        journal("j1", "2026-07-08", [
          { accountId: "acct_a", amount: 0 },
          { accountId: "acct_b", amount: 0 }
        ]),
        journal("j2", "2026-07-08", [
          { accountId: "acct_a", amount: 25 },
          { accountId: "acct_b", amount: -25 }
        ]),
        journal("j3", "2026-07-08", [
          { accountId: "acct_a", amount: -25 },
          { accountId: "acct_b", amount: 25 }
        ])
      ]
    });

    expect(aggregate.journal.lines).toEqual([]);
    expect(isZeroJournal(aggregate.journal.lines)).toBe(true);
    expect(getZeroJournalSkipReason(aggregate.journal)).not.toBeNull();
  });

  it("keeps the zero rule out of the preflight, so a zero member nets into its daily batch", () => {
    const result = runJournalEntryPreflight({
      journal: journal("j1", "2026-07-08", [
        { accountId: "acct_a", amount: 0 },
        { accountId: "acct_b", amount: 0 }
      ]),
      accountCodesById: new Map([
        ["acct_a", "1400"],
        ["acct_b", "2100"]
      ]),
      controlAccountIds: new Set<string>(),
      lockDate: null,
      settings: resolvePostingSyncSettings(null)
    });

    expect(result.failure).toBeNull();
  });
});

// ── Preflight, settings resolution and journal-sync helpers ──────────────────

// 3-line balanced fixture: Dr Inventory 150.00, Dr Freight 25.50,
// Cr GRNI accrual 175.50 (Carbon signed amounts: positive = debit)
const receiptJournal = (
  overrides?: Partial<Accounting.JournalEntry>
): Accounting.JournalEntry => ({
  id: "je_123",
  companyId: "company-1",
  journalEntryId: "JE000042",
  description: "Receipt posting",
  postingDate: "2026-07-01",
  status: "Posted",
  sourceType: "Purchase Receipt",
  reversalOfId: null,
  reversedById: null,
  reversal: false,
  lines: [
    {
      id: "line-1",
      accountId: "acc-inventory",
      amount: 150,
      description: "Inventory"
    },
    { id: "line-2", accountId: "acc-freight", amount: 25.5, description: null },
    {
      id: "line-3",
      accountId: "acc-accrual",
      amount: -175.5,
      description: "GRNI accrual"
    }
  ],
  updatedAt: "2026-07-01T12:00:00.000Z",
  ...overrides
});

const ACCOUNT_CODES: ReadonlyMap<string, string> = new Map([
  ["acc-inventory", "1400"],
  ["acc-freight", "5200"],
  ["acc-accrual", "2150"]
]);

/**
 * Build settings through the resolver so stored-fragment shapes (including
 * v2 `sourceTypes: string[]` / `includeManual` overrides — upgraded by the
 * schema shim) are exercised exactly as production reads them.
 */
const makeSettings = (
  fragment?: Record<string, unknown>
): PostingSyncSettings =>
  resolvePostingSyncSettings({
    settings: { postingSync: { enabled: true, ...fragment } }
  });

const passingPreflightArgs = () => ({
  journal: receiptJournal(),
  accountCodesById: ACCOUNT_CODES,
  controlAccountIds: new Set<string>(),
  lockDate: null,
  settings: makeSettings()
});

describe("runJournalEntryPreflight", () => {
  it("passes a fully mapped, balanced, unlocked journal through with its posting date", () => {
    const result = runJournalEntryPreflight(passingPreflightArgs());
    expect(result).toEqual({ failure: null, pushDate: "2026-07-01" });
  });

  it("returns UNMAPPED_ACCOUNTS (warning) with the unmapped account ids in metadata", () => {
    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      accountCodesById: new Map([
        ["acc-inventory", "1400"],
        ["acc-accrual", "2150"]
      ])
    });

    expect(result.failure?.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(result.failure?.warning).toBe(true);
    expect(result.failure?.metadata?.unmappedAccountIds).toEqual([
      "acc-freight"
    ]);
  });

  it("treats lines without an account as UNMAPPED_ACCOUNTS with the line ids in metadata", () => {
    const journal = receiptJournal();
    const brokenLine = journal.lines[1];
    if (!brokenLine) throw new Error("fixture must have 3 lines");
    brokenLine.accountId = null;

    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      journal
    });

    expect(result.failure?.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(result.failure?.metadata?.lineIdsWithoutAccount).toEqual(["line-2"]);
  });

  it("returns CONTROL_ACCOUNT_LINE (warning) when a line hits an AR/AP control account", () => {
    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      controlAccountIds: new Set(["acc-accrual"])
    });

    expect(result.failure?.errorCode).toBe("CONTROL_ACCOUNT_LINE");
    expect(result.failure?.warning).toBe(true);
    expect(result.failure?.metadata?.lineIds).toEqual(["line-3"]);
  });

  it("returns UNBALANCED_JOURNAL as a hard failure (warning: false)", () => {
    const journal = receiptJournal();
    const creditLine = journal.lines[2];
    if (!creditLine) throw new Error("fixture must have 3 lines");
    creditLine.amount = -175.49;

    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      journal
    });

    expect(result.failure?.errorCode).toBe("UNBALANCED_JOURNAL");
    expect(result.failure?.warning).toBe(false);
  });

  it("returns PERIOD_LOCKED (warning) under the park policy when postingDate <= lock date", () => {
    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      lockDate: "2026-07-01" // equal to postingDate → locked
    });

    expect(result.failure?.errorCode).toBe("PERIOD_LOCKED");
    expect(result.failure?.warning).toBe(true);
    expect(result.failure?.metadata).toEqual({
      postingDate: "2026-07-01",
      lockDate: "2026-07-01"
    });
  });

  it("re-dates to lock date + 1 (keeping the original date for the narration) under the redate policy", () => {
    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      lockDate: "2026-07-01",
      settings: makeSettings({ periodLockPolicy: "redate" })
    });

    expect(result).toEqual({
      failure: null,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });
  });

  it("does not lock journals dated after the lock date", () => {
    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      lockDate: "2026-06-30"
    });

    expect(result.failure).toBeNull();
  });

  it("reports unmapped accounts before the balance check", () => {
    const journal = receiptJournal();
    const creditLine = journal.lines[2];
    if (!creditLine) throw new Error("fixture must have 3 lines");
    creditLine.amount = -175.49; // unbalanced AND unmapped

    const result = runJournalEntryPreflight({
      ...passingPreflightArgs(),
      journal,
      accountCodesById: new Map()
    });

    expect(result.failure?.errorCode).toBe("UNMAPPED_ACCOUNTS");
  });
});

describe("resolvePostingSyncSettings", () => {
  it.each([undefined, {}, { settings: {} }])(
    "resolves %o to the defaults",
    (metadata) => {
      expect(resolvePostingSyncSettings(metadata)).toEqual(
        DEFAULT_POSTING_SYNC_SETTINGS
      );
    }
  );

  // Memo families are opt-in; invoices and bills sync as documents.
  it("defaults ar/ap to documents mode and the memo families to none", () => {
    expect(DEFAULT_POSTING_SYNC_SETTINGS.families).toEqual({
      ar: "documents",
      ap: "documents",
      creditMemo: "none",
      supplierCredit: "none"
    });
  });

  it("upgrades a stored v2 fragment (global daily consolidation) through the shim", () => {
    const resolved = resolvePostingSyncSettings({
      settings: {
        postingSync: {
          enabled: true,
          consolidation: "daily",
          lockDate: "2026-06-30"
        }
      }
    });

    expect(resolved.enabled).toBe(true);
    expect(resolved.lockDate).toBe("2026-06-30");
    expect(resolved.periodLockPolicy).toBe("park");
    // v2 daily consolidation → every enabled type daily-summary, so the
    // transitional derived hold flag stays "daily"
    expect(resolved.consolidation).toBe("daily");
    expect(resolved.sourceTypes["Purchase Receipt"]).toEqual({
      enabled: true,
      granularity: "daily-summary"
    });
    expect(resolved.sourceTypes.Manual.enabled).toBe(false);
    expect(resolved.families).toEqual({
      ar: "documents",
      ap: "documents",
      creditMemo: "none",
      supplierCredit: "none"
    });
  });

  it("upgrades a stored v2 sourceTypes array + includeManual through the shim", () => {
    const resolved = resolvePostingSyncSettings({
      settings: {
        postingSync: {
          enabled: true,
          sourceTypes: ["Purchase Receipt"],
          includeManual: true,
          consolidation: "individual"
        }
      }
    });

    expect(resolved.sourceTypes["Purchase Receipt"]).toEqual({
      enabled: true,
      granularity: "individual"
    });
    expect(resolved.sourceTypes["Sales Shipment"].enabled).toBe(false);
    expect(resolved.sourceTypes.Manual).toEqual({
      enabled: true,
      granularity: "individual"
    });
    expect(resolved.consolidation).toBe("individual");
  });

  it("ignores an invalid stored fragment instead of throwing", () => {
    const resolved = resolvePostingSyncSettings({
      settings: { postingSync: { consolidation: "weekly", enabled: "yes" } }
    });

    expect(resolved).toEqual(DEFAULT_POSTING_SYNC_SETTINGS);
  });
});

describe("journal sync entity-id contract", () => {
  it("round-trips plain and reversal entity ids", () => {
    expect(getJournalEntrySyncEntityId("je_123", false)).toBe("je_123");
    expect(getJournalEntrySyncEntityId("je_123", true)).toBe("je_123:reversal");

    expect(parseJournalEntrySyncEntityId("je_123")).toEqual({
      journalId: "je_123",
      reversal: false
    });
    expect(parseJournalEntrySyncEntityId("je_123:reversal")).toEqual({
      journalId: "je_123",
      reversal: true
    });
  });
});

describe("isJournalEntrySyncFailure", () => {
  it("detects the structured failure envelope on SyncResult.error", () => {
    const failure = new JournalEntrySyncError({
      errorCode: "PERIOD_LOCKED",
      message: "locked",
      warning: true
    }).failure;

    expect(isJournalEntrySyncFailure(failure)).toBe(true);
    expect(isJournalEntrySyncFailure("PERIOD_LOCKED: locked")).toBe(false);
    expect(isJournalEntrySyncFailure(null)).toBe(false);
    expect(
      isJournalEntrySyncFailure({ errorCode: "SOMETHING_ELSE", message: "x" })
    ).toBe(false);
  });

  it("formats the error message as '<code>: <detail>' for string-flattening paths", () => {
    const error = new JournalEntrySyncError({
      errorCode: "UNBALANCED_JOURNAL",
      message: "does not balance",
      warning: false
    });

    expect(error.message).toBe("UNBALANCED_JOURNAL: does not balance");
  });
});

describe("period-lock date helpers", () => {
  it("evaluates the boundary as locked (postingDate == lockDate)", () => {
    expect(
      evaluatePeriodLock({
        postingDate: "2026-07-01",
        lockDate: "2026-07-01",
        policy: "park"
      })
    ).toEqual({ locked: true, policy: "park", lockDate: "2026-07-01" });

    expect(
      evaluatePeriodLock({
        postingDate: "2026-07-02",
        lockDate: "2026-07-01",
        policy: "park"
      })
    ).toEqual({ locked: false });

    expect(
      evaluatePeriodLock({
        postingDate: "2026-07-01",
        lockDate: null,
        policy: "park"
      })
    ).toEqual({ locked: false });
  });

  it("rolls month and year boundaries when adding a day", () => {
    expect(addDaysToIsoDate("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToIsoDate("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });
});

describe("isBalancedJournal", () => {
  it("balances at 2dp without floating-point drift", () => {
    expect(
      isBalancedJournal([{ amount: 0.1 }, { amount: 0.2 }, { amount: -0.3 }])
    ).toBe(true);
    expect(isBalancedJournal([{ amount: 100 }, { amount: -99.99 }])).toBe(
      false
    );
    expect(isBalancedJournal([])).toBe(true);
  });
});
