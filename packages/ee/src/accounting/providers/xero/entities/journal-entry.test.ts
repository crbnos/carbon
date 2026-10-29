// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { validateDimensionSlots } from "../../../core/dimension-mapping";
import { JournalEntrySyncError } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import {
  buildXeroTrackingTarget,
  parseXeroTrackingTarget,
  XERO_MAX_JOURNAL_DIMENSION_SLOTS
} from "../provider";
import { mapJournalEntryToManualJournal } from "./journal-entry";

// 3-line balanced fixture: Dr Inventory 150.00, Dr Freight 25.50,
// Cr GRNI accrual 175.50 (Carbon signed amounts: positive = debit)
const makeJournal = (
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

describe("mapJournalEntryToManualJournal", () => {
  it("maps a 3-line journal with Carbon signs (positive = debit), mapped codes and TaxType NONE", () => {
    const payload = mapJournalEntryToManualJournal({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01"
    });

    expect(payload.Narration).toBe("Carbon JE000042 je_123");
    expect(payload.Date).toBe("2026-07-01");
    expect(payload.Status).toBe("POSTED");
    expect(payload.JournalLines).toEqual([
      {
        LineAmount: 150,
        AccountCode: "1400",
        Description: "Inventory",
        TaxType: "NONE"
      },
      {
        // Line without a description falls back to the journal description
        LineAmount: 25.5,
        AccountCode: "5200",
        Description: "Receipt posting",
        TaxType: "NONE"
      },
      {
        LineAmount: -175.5,
        AccountCode: "2150",
        Description: "GRNI accrual",
        TaxType: "NONE"
      }
    ]);

    // The mapped payload balances exactly like the Carbon journal
    const sum = (payload.JournalLines ?? []).reduce(
      (total, line) => total + Math.round(line.LineAmount * 100),
      0
    );
    expect(sum).toBe(0);
  });

  it("negates every LineAmount and uses the reversal narration for reversal pushes", () => {
    const payload = mapJournalEntryToManualJournal({
      journal: makeJournal({ status: "Reversed", reversal: true }),
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01"
    });

    expect(payload.Narration).toBe("Carbon reversal of JE000042");
    expect((payload.JournalLines ?? []).map((line) => line.LineAmount)).toEqual(
      [-150, -25.5, 175.5]
    );
  });

  it("appends the original date to the narration when the push was re-dated", () => {
    const payload = mapJournalEntryToManualJournal({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });

    expect(payload.Narration).toBe(
      "Carbon JE000042 je_123 | original date 2026-07-01"
    );
    expect(payload.Date).toBe("2026-07-02");
  });

  it("throws the structured UNMAPPED_ACCOUNTS error when a line's account has no code", () => {
    expect(() =>
      mapJournalEntryToManualJournal({
        journal: makeJournal(),
        accountCodesById: new Map([["acc-inventory", "1400"]]),
        pushDate: "2026-07-01"
      })
    ).toThrowError(JournalEntrySyncError);
  });
});

// ── Dimension slots → line Tracking (Phase 2) ────────────────────────────────

describe("mapJournalEntryToManualJournal — dimensions", () => {
  const LOCATION_DIM = "dim_loc";
  const COST_CENTER_DIM = "dim_cc";
  const REGION_CATEGORY = "11111111-1111-1111-1111-111111111111";
  const CC_CATEGORY = "22222222-2222-2222-2222-222222222222";

  const dimensionedJournal = makeJournal({
    lines: [
      {
        id: "line-1",
        accountId: "acc-inventory",
        amount: 150,
        description: "Inventory",
        dimensions: [
          { dimensionId: LOCATION_DIM, valueId: "loc_atl" },
          { dimensionId: COST_CENTER_DIM, valueId: "cc_ops" }
        ]
      },
      {
        id: "line-2",
        accountId: "acc-accrual",
        amount: -150,
        description: null,
        dimensions: [{ dimensionId: LOCATION_DIM, valueId: "loc_bos" }]
      }
    ]
  });

  // Two slots — Xero's org-wide cap on active tracking categories
  const slots = [
    { dimensionId: LOCATION_DIM, target: `tracking:${REGION_CATEGORY}` },
    { dimensionId: COST_CENTER_DIM, target: `tracking:${CC_CATEGORY}` }
  ];

  it("attaches Tracking (category id + option id) per slotted dimension (golden fixture, 2 categories)", () => {
    const payload = mapJournalEntryToManualJournal({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01",
      dimensions: {
        slots,
        optionIdsByValue: new Map([
          ["dim_loc:loc_atl", "opt-atl"],
          ["dim_loc:loc_bos", "opt-bos"],
          ["dim_cc:cc_ops", "opt-ops"]
        ])
      }
    });

    expect(payload.JournalLines?.[0]?.Tracking).toEqual([
      { TrackingCategoryID: REGION_CATEGORY, TrackingOptionID: "opt-atl" },
      { TrackingCategoryID: CC_CATEGORY, TrackingOptionID: "opt-ops" }
    ]);
    expect(payload.JournalLines?.[1]?.Tracking).toEqual([
      { TrackingCategoryID: REGION_CATEGORY, TrackingOptionID: "opt-bos" }
    ]);
  });

  it("omits Tracking for unmapped values (drop path) and when no dimension args are passed", () => {
    const dropped = mapJournalEntryToManualJournal({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01",
      dimensions: {
        slots,
        optionIdsByValue: new Map([["dim_loc:loc_atl", "opt-atl"]])
      }
    });
    expect(dropped.JournalLines?.[0]?.Tracking).toEqual([
      { TrackingCategoryID: REGION_CATEGORY, TrackingOptionID: "opt-atl" }
    ]);
    expect(dropped.JournalLines?.[1]?.Tracking).toBeUndefined();

    const legacy = mapJournalEntryToManualJournal({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01"
    });
    expect(legacy.JournalLines?.[0]?.Tracking).toBeUndefined();
  });

  it("ignores slots whose target is not a tracking target", () => {
    const payload = mapJournalEntryToManualJournal({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      pushDate: "2026-07-01",
      dimensions: {
        slots: [{ dimensionId: LOCATION_DIM, target: "class" }],
        optionIdsByValue: new Map([["dim_loc:loc_atl", "opt-atl"]])
      }
    });
    expect(payload.JournalLines?.[0]?.Tracking).toBeUndefined();
  });
});

describe("Xero dimension slot capacity", () => {
  it("caps slots at Xero's 2 active tracking categories via validateDimensionSlots", () => {
    const targets = [
      { id: "tracking:cat-1", label: "Region", capacity: 1 },
      { id: "tracking:cat-2", label: "Cost Center", capacity: 1 },
      { id: "tracking:cat-3", label: "Extra", capacity: 1 }
    ];

    expect(
      validateDimensionSlots({
        slots: [
          { dimensionId: "dim_a", target: "tracking:cat-1" },
          { dimensionId: "dim_b", target: "tracking:cat-2" }
        ],
        targets,
        maxSlots: XERO_MAX_JOURNAL_DIMENSION_SLOTS
      })
    ).toEqual([]);

    const errors = validateDimensionSlots({
      slots: [
        { dimensionId: "dim_a", target: "tracking:cat-1" },
        { dimensionId: "dim_b", target: "tracking:cat-2" },
        { dimensionId: "dim_c", target: "tracking:cat-3" }
      ],
      targets,
      maxSlots: XERO_MAX_JOURNAL_DIMENSION_SLOTS
    });
    expect(errors.some((error) => error.includes("at most 2"))).toBe(true);
  });
});

describe("Xero tracking targets", () => {
  it("builds and parses tracking:<categoryId> targets", () => {
    expect(buildXeroTrackingTarget("cat-1")).toBe("tracking:cat-1");
    expect(parseXeroTrackingTarget("tracking:cat-1")).toBe("cat-1");
    expect(parseXeroTrackingTarget("class")).toBeNull();
    expect(parseXeroTrackingTarget("tracking:")).toBeNull();
  });
});
