import { describe, expect, it } from "vitest";
import { validateDimensionSlots } from "../../../core/dimension-mapping";
import {
  POSTING_SYNC_DEFAULT_SOURCE_TYPES,
  POSTING_SYNC_EXCLUDED_SOURCE_TYPES
} from "../../../core/models";
import {
  addDaysToIsoDate,
  DEFAULT_POSTING_SYNC_SETTINGS,
  evaluatePeriodLock,
  getJournalEntrySyncEntityId,
  getPostingSyncSourceTypeSkipReason,
  isBalancedJournal,
  isJournalEntrySyncFailure,
  JournalEntrySyncError,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  runJournalEntryPreflight
} from "../../../core/posting";
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
  journal: makeJournal(),
  accountCodesById: ACCOUNT_CODES,
  controlAccountIds: new Set<string>(),
  lockDate: null,
  settings: makeSettings()
});

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
    const journal = makeJournal();
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
    const journal = makeJournal();
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
    const journal = makeJournal();
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

describe("getPostingSyncSourceTypeSkipReason", () => {
  it("never pushes document-represented source types in documents mode, even when listed in sourceTypes", () => {
    // Doc-backed types (a synced document carries the amounts) exclude;
    // memos/returns have NO document representation yet, so their skip
    // reason is the loud delivery-hole message instead — either way the
    // journal is never pushed in documents mode.
    const backed = ["Sales Invoice", "Purchase Invoice", "Payment"];

    for (const sourceType of POSTING_SYNC_EXCLUDED_SOURCE_TYPES) {
      const expected = backed.includes(sourceType)
        ? "excluded from posting sync"
        : "no document representation";

      expect(
        getPostingSyncSourceTypeSkipReason(sourceType, makeSettings()),
        `${sourceType} should not push`
      ).toContain(expected);

      expect(
        getPostingSyncSourceTypeSkipReason(
          sourceType,
          makeSettings({ sourceTypes: [sourceType] })
        ),
        `${sourceType} should stay unpushed when explicitly listed`
      ).toContain(expected);
    }
  });

  it("pushes every default source type under default settings", () => {
    for (const sourceType of POSTING_SYNC_DEFAULT_SOURCE_TYPES) {
      expect(
        getPostingSyncSourceTypeSkipReason(sourceType, makeSettings()),
        `${sourceType} should be allowed by default`
      ).toBeNull();
    }
  });

  it("never pushes Manual journals — even a stored includeManual cannot enable them", () => {
    expect(
      getPostingSyncSourceTypeSkipReason("Manual", makeSettings())
    ).toContain("Manual journals are never synced");
    // The v2 shim maps includeManual → sourceTypes.Manual.enabled, but the
    // policy (syncable: false) overrides any stored config: Manual is the
    // only path to arbitrary/unmapped accounts and the external ledger owns
    // manual journals.
    expect(
      getPostingSyncSourceTypeSkipReason(
        "Manual",
        makeSettings({ includeManual: true })
      )
    ).toContain("Manual journals are never synced");
  });

  it("always-on: a narrowed stored sourceTypes list cannot disable an automated type", () => {
    const narrowed = makeSettings({ sourceTypes: ["Purchase Receipt"] });
    expect(
      getPostingSyncSourceTypeSkipReason("Purchase Receipt", narrowed)
    ).toBeNull();
    // Sales Shipment is absent from the stored v2 list, but automated
    // postings always sync — stored per-type enables are parse-compatible
    // legacy fields the decision no longer reads.
    expect(
      getPostingSyncSourceTypeSkipReason("Sales Shipment", narrowed)
    ).toBeNull();
  });

  it("skips journals without a source type", () => {
    expect(getPostingSyncSourceTypeSkipReason(null, makeSettings())).toContain(
      "no source type"
    );
  });
});

describe("resolvePostingSyncSettings", () => {
  it("defaults to ALWAYS-ON posting sync when nothing is stored", () => {
    expect(resolvePostingSyncSettings(undefined)).toEqual(
      DEFAULT_POSTING_SYNC_SETTINGS
    );
    expect(resolvePostingSyncSettings({})).toEqual(
      DEFAULT_POSTING_SYNC_SETTINGS
    );
    expect(resolvePostingSyncSettings({ settings: {} })).toEqual(
      DEFAULT_POSTING_SYNC_SETTINGS
    );

    // Always-on defaults: enabled (legacy field, no longer read by the
    // decision core), documents-mode families, source-type record total over
    // the enum with policy defaults, warn on unmapped dims
    expect(DEFAULT_POSTING_SYNC_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_POSTING_SYNC_SETTINGS.families).toEqual({
      ar: "documents",
      ap: "documents"
    });
    expect(DEFAULT_POSTING_SYNC_SETTINGS.periodLockPolicy).toBe("park");
    expect(DEFAULT_POSTING_SYNC_SETTINGS.onUnmappedDimensionValue).toBe("warn");
    expect(DEFAULT_POSTING_SYNC_SETTINGS.dimensionSlots).toEqual([]);
    expect(DEFAULT_POSTING_SYNC_SETTINGS.consolidation).toBe("individual");
    expect(
      DEFAULT_POSTING_SYNC_SETTINGS.sourceTypes["Purchase Receipt"]
    ).toEqual({ enabled: true, granularity: "individual" });
    expect(
      DEFAULT_POSTING_SYNC_SETTINGS.sourceTypes["Production Event"]
    ).toEqual({ enabled: true, granularity: "daily-summary" });
    expect(DEFAULT_POSTING_SYNC_SETTINGS.sourceTypes.Manual).toEqual({
      enabled: false,
      granularity: "individual"
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
    expect(resolved.families).toEqual({ ar: "documents", ap: "documents" });
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
