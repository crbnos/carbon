import { describe, expect, it } from "vitest";
import {
  JOURNAL_ENTRY_SOURCE_TYPES,
  POSTING_POLICY,
  POSTING_SYNC_DEFAULT_SOURCE_TYPES,
  POSTING_SYNC_EXCLUDED_SOURCE_TYPES
} from "./models";
import {
  getJournalPostingPolicyDecision,
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "./posting";

/** Resolve a v3 stored fragment exactly as production reads it. */
const settingsWith = (
  fragment?: Record<string, unknown>
): PostingSyncSettings =>
  resolvePostingSyncSettings({
    settings: { postingSync: { enabled: true, ...fragment } }
  });

const DOC_SYNC_ON = { invoiceEnabled: true, billEnabled: true };
const DOC_SYNC_OFF = { invoiceEnabled: false, billEnabled: false };

// ── POSTING_POLICY totality & structure ──────────────────────────────────────

describe("POSTING_POLICY", () => {
  it("is structurally valid for every source type", () => {
    for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
      const entry = POSTING_POLICY[sourceType];
      expect(["journal", "document"]).toContain(entry.representation);

      if (entry.representation === "document") {
        expect(
          entry.family,
          `${sourceType} is document-represented and must carry a family`
        ).toBeDefined();
        expect(
          entry.backingEntityType,
          `${sourceType} must declare its backing entity (or explicit null)`
        ).not.toBeUndefined();
      } else {
        expect(entry.family).toBeUndefined();
      }

      if (entry.family === "per-line") {
        expect(sourceType).toBe("Payment");
      }
    }
  });

  it("derives the frozen v2 default/excluded lists exactly (behavior parity)", () => {
    expect([...POSTING_SYNC_DEFAULT_SOURCE_TYPES].sort()).toEqual(
      [
        "Purchase Receipt",
        "Sales Shipment",
        "Transfer Receipt",
        "Inventory Adjustment",
        "Production Order",
        "Production Event",
        "Job Consumption",
        "Job Receipt",
        "Job Close",
        "Asset Depreciation",
        "Asset Disposal",
        "Non-Conformance",
        "Inbound Inspection"
      ].sort()
    );

    expect([...POSTING_SYNC_EXCLUDED_SOURCE_TYPES].sort()).toEqual(
      [
        "Sales Invoice",
        "Purchase Invoice",
        "Payment",
        "Credit Memo",
        "Debit Memo",
        "Sales Return",
        "Purchase Return"
      ].sort()
    );
  });
});

// ── getJournalPostingPolicyDecision ──────────────────────────────────────────

describe("getJournalPostingPolicyDecision", () => {
  it("pushes enabled journal-represented types with their configured granularity", () => {
    const settings = settingsWith();

    expect(
      getJournalPostingPolicyDecision({
        sourceType: "Purchase Receipt",
        settings,
        docSync: DOC_SYNC_ON
      })
    ).toEqual({ kind: "push", granularity: "individual" });

    // Manufacturing defaults: Production Event + Job Consumption summarize
    expect(
      getJournalPostingPolicyDecision({
        sourceType: "Production Event",
        settings,
        docSync: DOC_SYNC_ON
      })
    ).toEqual({ kind: "push", granularity: "daily-summary" });
  });

  it("always-on: a stored enabled:false cannot exclude an automated type; Manual is permanently excluded (MANUAL_DISABLED)", () => {
    // Always-on model: automated journal types push regardless of any stored
    // per-type enable flag (kept in the schema for backward-compatible
    // parsing but never read by the decision).
    const settings = settingsWith({
      sourceTypes: {
        "Purchase Receipt": { enabled: false, granularity: "individual" }
      }
    });

    const stillPushes = getJournalPostingPolicyDecision({
      sourceType: "Purchase Receipt",
      settings,
      docSync: DOC_SYNC_ON
    });
    expect(stillPushes).toMatchObject({ kind: "push" });

    // Manual is the only non-syncable type (POSTING_POLICY syncable: false) —
    // excluded permanently, regardless of stored config.
    const manual = getJournalPostingPolicyDecision({
      sourceType: "Manual",
      settings,
      docSync: DOC_SYNC_ON
    });
    expect(manual).toMatchObject({
      kind: "exclude",
      reason: "MANUAL_DISABLED"
    });
  });

  it("excludes unknown and missing source types", () => {
    const settings = settingsWith();
    expect(
      getJournalPostingPolicyDecision({
        sourceType: "Not A Source Type",
        settings,
        docSync: DOC_SYNC_ON
      })
    ).toMatchObject({ kind: "exclude", reason: "SOURCE_TYPE_DISABLED" });
    expect(
      getJournalPostingPolicyDecision({
        sourceType: null,
        settings,
        docSync: DOC_SYNC_ON
      })
    ).toMatchObject({ kind: "exclude", reason: "SOURCE_TYPE_DISABLED" });
  });

  it("hands Inventory Adjustment to the entity syncer when that sync is enabled", () => {
    const decision = getJournalPostingPolicyDecision({
      sourceType: "Inventory Adjustment",
      settings: settingsWith(),
      docSync: DOC_SYNC_ON,
      inventoryAdjustmentEntitySyncEnabled: true
    });
    expect(decision).toMatchObject({
      kind: "exclude",
      reason: "DOC_BACKED",
      backingDocument: { entityType: "inventoryAdjustment" }
    });
  });

  describe("documents mode (default families)", () => {
    it("DOC_BACKED when the backing document sync is enabled", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Sales Invoice",
        settings: settingsWith(),
        docSync: DOC_SYNC_ON
      });
      expect(decision).toMatchObject({
        kind: "exclude",
        reason: "DOC_BACKED",
        backingDocument: { entityType: "invoice" }
      });
    });

    it("parks DOC_SYNC_DISABLED when the backing document sync is off (delivery hole must be loud)", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Purchase Invoice",
        settings: settingsWith(),
        docSync: DOC_SYNC_OFF
      });
      expect(decision).toMatchObject({
        kind: "warn",
        code: "DOC_SYNC_DISABLED"
      });
    });

    it("parks memos/returns as DOC_SYNC_DISABLED (no document representation exists yet)", () => {
      for (const sourceType of [
        "Credit Memo",
        "Debit Memo",
        "Sales Return",
        "Purchase Return"
      ]) {
        const decision = getJournalPostingPolicyDecision({
          sourceType,
          settings: settingsWith(),
          docSync: DOC_SYNC_ON
        });
        expect(decision, sourceType).toMatchObject({
          kind: "warn",
          code: "DOC_SYNC_DISABLED"
        });
      }
    });

    it("DOC_BACKED for Payment regardless of doc flags (cash application is provider-native)", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Payment",
        settings: settingsWith(),
        docSync: DOC_SYNC_OFF,
        paymentFamily: "ar"
      });
      expect(decision).toMatchObject({
        kind: "exclude",
        reason: "DOC_BACKED",
        backingDocument: { entityType: "payment" }
      });
    });
  });

  describe("journals mode", () => {
    const journalsAr = settingsWith({
      families: { ar: "journals", ap: "documents" }
    });

    it("pushes the family's journals with forced individual granularity", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Sales Invoice",
        settings: journalsAr,
        docSync: { invoiceEnabled: false, billEnabled: true }
      });
      expect(decision).toEqual({ kind: "push", granularity: "individual" });

      // memos ride the family too — no document exists to double-post against
      const memo = getJournalPostingPolicyDecision({
        sourceType: "Credit Memo",
        settings: journalsAr,
        docSync: { invoiceEnabled: false, billEnabled: true }
      });
      expect(memo).toEqual({ kind: "push", granularity: "individual" });
    });

    it("parks DOUBLE_REPRESENTATION when the document sync is contradictorily enabled", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Sales Invoice",
        settings: journalsAr,
        docSync: DOC_SYNC_ON
      });
      expect(decision).toMatchObject({
        kind: "warn",
        code: "DOUBLE_REPRESENTATION"
      });
    });

    it("leaves the other family in documents mode untouched", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Purchase Invoice",
        settings: journalsAr,
        docSync: { invoiceEnabled: false, billEnabled: true }
      });
      expect(decision).toMatchObject({
        kind: "exclude",
        reason: "DOC_BACKED",
        backingDocument: { entityType: "bill" }
      });
    });
  });

  describe("none mode", () => {
    it("excludes the family with FAMILY_OFF (explicit, visible opt-out)", () => {
      const settings = settingsWith({
        families: { ar: "none", ap: "documents" }
      });
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Sales Invoice",
        settings,
        docSync: DOC_SYNC_ON
      });
      expect(decision).toMatchObject({ kind: "exclude", reason: "FAMILY_OFF" });
    });
  });

  describe("Payment per-line family resolution", () => {
    const diverging = settingsWith({
      families: { ar: "journals", ap: "documents" }
    });

    it("follows the resolved side when family modes diverge", () => {
      expect(
        getJournalPostingPolicyDecision({
          sourceType: "Payment",
          settings: diverging,
          docSync: { invoiceEnabled: false, billEnabled: true },
          paymentFamily: "ar"
        })
      ).toEqual({ kind: "push", granularity: "individual" });

      expect(
        getJournalPostingPolicyDecision({
          sourceType: "Payment",
          settings: diverging,
          docSync: { invoiceEnabled: false, billEnabled: true },
          paymentFamily: "ap"
        })
      ).toMatchObject({ kind: "exclude", reason: "DOC_BACKED" });
    });

    it("parks PAYMENT_FAMILY_UNRESOLVED when the side is unknown and modes diverge", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Payment",
        settings: diverging,
        docSync: { invoiceEnabled: false, billEnabled: true },
        paymentFamily: null
      });
      expect(decision).toMatchObject({
        kind: "warn",
        code: "PAYMENT_FAMILY_UNRESOLVED"
      });
    });

    it("needs no side when both families share a mode", () => {
      const decision = getJournalPostingPolicyDecision({
        sourceType: "Payment",
        settings: settingsWith(),
        docSync: DOC_SYNC_ON,
        paymentFamily: null
      });
      expect(decision).toMatchObject({
        kind: "exclude",
        reason: "DOC_BACKED"
      });
    });
  });
});
