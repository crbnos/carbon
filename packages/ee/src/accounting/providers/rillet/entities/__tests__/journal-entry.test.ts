import { describe, expect, it } from "vitest";
import {
  DEFAULT_POSTING_SYNC_SETTINGS,
  JournalEntrySyncError,
  type PostingSyncSettings
} from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import {
  getRilletLockDate,
  mapJournalEntryToRilletJournalEntry
} from "../journal-entry";

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

// Carbon account.id -> Rillet account code (mapping externalCode)
const ACCOUNT_CODES: ReadonlyMap<string, string> = new Map([
  ["acc-inventory", "1400"],
  ["acc-freight", "5100"],
  ["acc-accrual", "2100"]
]);

const makeSettings = (
  overrides?: Partial<PostingSyncSettings>
): PostingSyncSettings => ({
  ...DEFAULT_POSTING_SYNC_SETTINGS,
  enabled: true,
  ...overrides
});

describe("mapJournalEntryToRilletJournalEntry", () => {
  it("maps a 3-line journal to unsigned 2-dp string amounts with an explicit side (positive = DEBIT)", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.name).toBe("Receipt posting");
    expect(payload.date).toBe("2026-07-01");
    expect(payload.currency).toBe("USD");
    expect(payload.subsidiary_id).toBeUndefined();
    expect(payload.items).toEqual([
      {
        account_code: "1400",
        amount: { amount: "150.00", currency: "USD" },
        side: "DEBIT",
        description: "Inventory"
      },
      {
        // Line without a description falls back to the journal description
        account_code: "5100",
        amount: { amount: "25.50", currency: "USD" },
        side: "DEBIT",
        description: "Receipt posting"
      },
      {
        account_code: "2100",
        amount: { amount: "175.50", currency: "USD" },
        side: "CREDIT",
        description: "GRNI accrual"
      }
    ]);
  });

  it("produces a balanced payload with >= 2 items: DEBIT cents equal CREDIT cents", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.items.length).toBeGreaterThanOrEqual(2);

    const centsBySide = payload.items.reduce(
      (sides, item) => {
        sides[item.side] += Math.round(Number(item.amount.amount) * 100);
        return sides;
      },
      { DEBIT: 0, CREDIT: 0 }
    );

    expect(centsBySide.DEBIT).toBe(centsBySide.CREDIT);
    expect(centsBySide.DEBIT).toBe(17550);
  });

  it("rounds every amount to a 2-dp string", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal({
        lines: [
          {
            id: "line-1",
            accountId: "acc-inventory",
            amount: 10.567,
            description: null
          },
          {
            id: "line-2",
            accountId: "acc-accrual",
            amount: -10.567,
            description: null
          }
        ]
      }),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.items.map((item) => item.amount.amount)).toEqual([
      "10.57",
      "10.57"
    ]);
  });

  it("propagates the currency onto the payload and every item", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      currency: "EUR",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.currency).toBe("EUR");
    expect(payload.items.every((item) => item.amount.currency === "EUR")).toBe(
      true
    );
  });

  it("includes subsidiary_id only when configured", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: "sub-1",
      pushDate: "2026-07-01"
    });

    expect(payload.subsidiary_id).toBe("sub-1");
  });

  it("flips every side (amounts stay positive) and uses the reversal name for reversal pushes", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal({ status: "Reversed", reversal: true }),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.name).toBe("Reversal of Receipt posting");
    expect(payload.items.map((item) => item.side)).toEqual([
      "CREDIT",
      "CREDIT",
      "DEBIT"
    ]);
    expect(payload.items.map((item) => item.amount.amount)).toEqual([
      "150.00",
      "25.50",
      "175.50"
    ]);
  });

  it("falls back to the readable journal number when the description is empty", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: { ...makeJournal(), description: null },
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });

    expect(payload.name).toBe("Carbon JE000042");
  });

  it("appends the original date to the name when the push was re-dated", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: makeJournal(),
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });

    expect(payload.name).toBe("Receipt posting | original date 2026-07-01");
    expect(payload.date).toBe("2026-07-02");
  });

  it("throws the structured UNMAPPED_ACCOUNTS error when a line's account has no mapping", () => {
    let thrown: unknown;
    try {
      mapJournalEntryToRilletJournalEntry({
        journal: makeJournal(),
        accountCodesById: new Map([["acc-inventory", "1400"]]),
        currency: "USD",
        subsidiaryId: null,
        pushDate: "2026-07-01"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(JournalEntrySyncError);
    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(failure.warning).toBe(true);
    expect(failure.metadata?.unmappedAccountIds).toEqual(["acc-freight"]);
  });
});

// ── Dimension slots → item field refs (Phase 2, Rillet Fields) ───────────────

describe("mapJournalEntryToRilletJournalEntry — dimensions (Fields)", () => {
  const LOCATION_DIM = "dim_loc";
  const DEPARTMENT_FIELD_ID = "f1d10000-0000-0000-0000-000000000001";

  const dimensionedJournal = makeJournal({
    lines: [
      {
        id: "line-1",
        accountId: "acc-inventory",
        amount: 150,
        description: "Inventory",
        dimensions: [{ dimensionId: LOCATION_DIM, valueId: "loc_atl" }]
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

  const fieldIdByDimensionId = new Map([[LOCATION_DIM, DEPARTMENT_FIELD_ID]]);

  it("attaches uuid field refs (field_id + field_value_id — ids, never names) for every dimension on the line", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01",
      dimensions: {
        fieldIdByDimensionId,
        fieldValueIdsByValue: new Map([
          ["dim_loc:loc_atl", "fv-atl"],
          ["dim_loc:loc_bos", "fv-bos"]
        ])
      }
    });

    expect(payload.items[0]?.fields).toEqual([
      { field_id: DEPARTMENT_FIELD_ID, field_value_id: "fv-atl" }
    ]);
    expect(payload.items[1]?.fields).toEqual([
      { field_id: DEPARTMENT_FIELD_ID, field_value_id: "fv-bos" }
    ]);
  });

  it("omits fields for unmapped values (drop path) and when no dimension args are passed", () => {
    const dropped = mapJournalEntryToRilletJournalEntry({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01",
      dimensions: {
        fieldIdByDimensionId,
        fieldValueIdsByValue: new Map([["dim_loc:loc_atl", "fv-atl"]])
      }
    });
    expect(dropped.items[0]?.fields).toEqual([
      { field_id: DEPARTMENT_FIELD_ID, field_value_id: "fv-atl" }
    ]);
    expect(dropped.items[1]?.fields).toBeUndefined();

    const legacy = mapJournalEntryToRilletJournalEntry({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01"
    });
    expect(legacy.items[0]?.fields).toBeUndefined();
  });

  it("reuses upserted value ids on later pushes: an updated lookup resolves without re-creating", () => {
    // Simulates the autoCreate flow: the ensure step upserted Boston and
    // added it to the shared lookup — the mapper then resolves both values
    const lookup = new Map([["dim_loc:loc_atl", "fv-atl"]]);
    lookup.set("dim_loc:loc_bos", "fv-bos-upserted");

    const payload = mapJournalEntryToRilletJournalEntry({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01",
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue: lookup }
    });

    expect(payload.items[1]?.fields).toEqual([
      { field_id: DEPARTMENT_FIELD_ID, field_value_id: "fv-bos-upserted" }
    ]);
  });

  it("omits a dimension whose Field was not provisioned (no field mapping)", () => {
    const payload = mapJournalEntryToRilletJournalEntry({
      journal: dimensionedJournal,
      accountCodesById: ACCOUNT_CODES,
      currency: "USD",
      subsidiaryId: null,
      pushDate: "2026-07-01",
      dimensions: {
        fieldIdByDimensionId: new Map(), // LOCATION_DIM Field not provisioned
        fieldValueIdsByValue: new Map([["dim_loc:loc_atl", "fv-atl"]])
      }
    });
    expect(payload.items[0]?.fields).toBeUndefined();
  });
});

describe("getRilletLockDate (closed-books source)", () => {
  it("returns ONLY the manual settings.lockDate, normalized to YYYY-MM-DD", () => {
    expect(getRilletLockDate(makeSettings({ lockDate: "2026-06-30" }))).toBe(
      "2026-06-30"
    );
    expect(
      getRilletLockDate(makeSettings({ lockDate: "2026-06-30T00:00:00.000Z" }))
    ).toBe("2026-06-30");
  });

  it("returns null when no manual lock date is stored (the Rillet API cannot read a close date)", () => {
    expect(getRilletLockDate(makeSettings())).toBeNull();
  });
});
