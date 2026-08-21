// Unit tests for the reconciliation cron's tie-out helpers. The helpers
// live in accounting-sync-operations.ts (the import-light module — no
// Inngest client, no @carbon/auth) exactly like the sweep and
// consolidation decisions, so this file stays runnable without booting
// either.
import { describe, expect, it } from "vitest";
import {
  buildRemoteAccountRefIndex,
  computeTieOutDeltas,
  DOC_BACKED_ERROR_CODE,
  findAccountingPeriodForDate,
  foldTieOutBuckets,
  getBackingDocumentEntityType,
  getLatestOperationsByEntityId,
  getOperationTieOutBucket,
  getTieOutScopeStart,
  isBackingDocumentDelivered,
  TIE_OUT_BUCKETS_LEAST_DELIVERED_FIRST,
  TIE_OUT_DEFAULT_LOOKBACK_DAYS,
  type TieOutBucket
} from "./accounting-sync-operations";

// ── Disposition → bucket ────────────────────────────────────────────────────

describe("getOperationTieOutBucket", () => {
  const bucketOf = (
    status: string,
    errorCode: string | null = null,
    docBackedDelivered = false
  ) =>
    getOperationTieOutBucket(
      { status: status as any, errorCode },
      { docBackedDelivered }
    );

  it("maps Completed to synced", () => {
    expect(bucketOf("Completed")).toBe("synced");
  });

  it("maps Excluded/DOC_BACKED to docBacked only while the backing document is delivered", () => {
    expect(bucketOf("Excluded", DOC_BACKED_ERROR_CODE, true)).toBe("docBacked");
    // an undelivered doc-backed journal has NOT reached the external GL —
    // it is pending, never silently "accounted for" (spec §5)
    expect(bucketOf("Excluded", DOC_BACKED_ERROR_CODE, false)).toBe("pending");
  });

  it("maps other Excluded reasons to excluded", () => {
    expect(bucketOf("Excluded", "FAMILY_OFF")).toBe("excluded");
    expect(bucketOf("Excluded", "SOURCE_TYPE_DISABLED")).toBe("excluded");
    expect(bucketOf("Excluded", null)).toBe("excluded");
  });

  it("maps Pending and In Flight to pending", () => {
    expect(bucketOf("Pending")).toBe("pending");
    expect(bucketOf("In Flight")).toBe("pending");
  });

  it("maps Failed, Warning and Skipped to blocked", () => {
    expect(bucketOf("Failed")).toBe("blocked");
    expect(bucketOf("Warning", "UNMAPPED_ACCOUNTS")).toBe("blocked");
    expect(bucketOf("Skipped")).toBe("blocked");
  });
});

describe("foldTieOutBuckets", () => {
  it("returns pending for a journal with no operations", () => {
    expect(foldTieOutBuckets([])).toBe("pending");
  });

  it("picks the least-delivered bucket when a journal has a normal and a :reversal op", () => {
    expect(foldTieOutBuckets(["synced", "pending"])).toBe("pending");
    expect(foldTieOutBuckets(["docBacked", "blocked"])).toBe("blocked");
    expect(foldTieOutBuckets(["excluded", "synced"])).toBe("excluded");
    expect(foldTieOutBuckets(["synced", "synced"])).toBe("synced");
  });

  it("orders delivery exactly blocked > pending > excluded > docBacked > synced", () => {
    expect(TIE_OUT_BUCKETS_LEAST_DELIVERED_FIRST).toEqual([
      "blocked",
      "pending",
      "excluded",
      "docBacked",
      "synced"
    ]);
    // folding the full list from any order lands on blocked
    const shuffled: TieOutBucket[] = [
      "synced",
      "docBacked",
      "blocked",
      "excluded",
      "pending"
    ];
    expect(foldTieOutBuckets(shuffled)).toBe("blocked");
  });
});

// ── Latest-row-per-entity fold ──────────────────────────────────────────────

describe("getLatestOperationsByEntityId", () => {
  it("keeps the newest row per entityId by createdAt", () => {
    const latest = getLatestOperationsByEntityId([
      { entityId: "j1", createdAt: "2026-08-01T00:00:00Z", status: "Failed" },
      {
        entityId: "j1",
        createdAt: "2026-08-05T00:00:00Z",
        status: "Completed"
      },
      { entityId: "j2", createdAt: "2026-08-02T00:00:00Z", status: "Pending" }
    ] as any[]);

    expect(latest.size).toBe(2);
    expect((latest.get("j1") as any).status).toBe("Completed");
    expect((latest.get("j2") as any).status).toBe("Pending");
  });

  it("is insensitive to input order", () => {
    const latest = getLatestOperationsByEntityId([
      { entityId: "j1", createdAt: "2026-08-05T00:00:00Z", status: "Excluded" },
      { entityId: "j1", createdAt: "2026-08-01T00:00:00Z", status: "Failed" }
    ] as any[]);

    expect((latest.get("j1") as any).status).toBe("Excluded");
  });
});

// ── Period resolution + scope ───────────────────────────────────────────────

describe("findAccountingPeriodForDate", () => {
  const periods = [
    { id: "p-jul", startDate: "2026-07-01", endDate: "2026-07-31" },
    { id: "p-aug", startDate: "2026-08-01", endDate: "2026-08-31" }
  ];

  it("finds the period containing the date, boundaries inclusive", () => {
    expect(findAccountingPeriodForDate(periods, "2026-07-15")?.id).toBe(
      "p-jul"
    );
    expect(findAccountingPeriodForDate(periods, "2026-08-01")?.id).toBe(
      "p-aug"
    );
    expect(findAccountingPeriodForDate(periods, "2026-08-31")?.id).toBe(
      "p-aug"
    );
  });

  it("returns null for a date outside every period or a null date", () => {
    expect(findAccountingPeriodForDate(periods, "2026-06-30")).toBeNull();
    expect(findAccountingPeriodForDate(periods, null)).toBeNull();
  });

  it("slices timestamps down to the calendar day", () => {
    expect(
      findAccountingPeriodForDate(periods, "2026-07-15T10:30:00Z")?.id
    ).toBe("p-jul");
  });
});

describe("getTieOutScopeStart", () => {
  it("uses the posting-sync syncFromDate when set (sliced to a date)", () => {
    expect(
      getTieOutScopeStart({
        todayIso: "2026-08-11",
        syncFromDate: "2026-01-15T00:00:00Z"
      })
    ).toBe("2026-01-15");
  });

  it("falls back to the default lookback window", () => {
    expect(TIE_OUT_DEFAULT_LOOKBACK_DAYS).toBe(90);
    expect(getTieOutScopeStart({ todayIso: "2026-08-11" })).toBe("2026-05-13");
    expect(
      getTieOutScopeStart({ todayIso: "2026-08-11", syncFromDate: null })
    ).toBe("2026-05-13");
  });
});

// ── DOC_BACKED delivery ─────────────────────────────────────────────────────

describe("getBackingDocumentEntityType", () => {
  it("reads metadata.backingDocument.entityType", () => {
    expect(
      getBackingDocumentEntityType({ backingDocument: { entityType: "bill" } })
    ).toBe("bill");
  });

  it("returns null for missing or malformed metadata", () => {
    expect(getBackingDocumentEntityType(null)).toBeNull();
    expect(getBackingDocumentEntityType({})).toBeNull();
    expect(
      getBackingDocumentEntityType({ backingDocument: "bill" })
    ).toBeNull();
    expect(
      getBackingDocumentEntityType({ backingDocument: { entityType: 42 } })
    ).toBeNull();
  });
});

describe("isBackingDocumentDelivered", () => {
  it("delivered when the document's own op is Completed", () => {
    expect(
      isBackingDocumentDelivered({
        latestOperationStatus: "Completed",
        hasExternalMapping: false
      })
    ).toBe(true);
  });

  it("delivered when the document carries an external mapping", () => {
    expect(
      isBackingDocumentDelivered({
        latestOperationStatus: null,
        hasExternalMapping: true
      })
    ).toBe(true);
  });

  it("NOT delivered when the op is non-Completed and no mapping exists", () => {
    for (const status of [null, "Pending", "Failed", "Warning", "Skipped"]) {
      expect(
        isBackingDocumentDelivered({
          latestOperationStatus: status,
          hasExternalMapping: false
        })
      ).toBe(false);
    }
  });
});

// ── Remote-ref → Carbon account index ───────────────────────────────────────

describe("buildRemoteAccountRefIndex", () => {
  it("indexes both the externalId and the metadata externalCode", () => {
    const index = buildRemoteAccountRefIndex([
      {
        entityId: "acc_1",
        externalId: "xero-uuid-1",
        metadata: { externalCode: "1200", externalName: "Inventory" }
      }
    ]);

    // QBO addresses by provider account id; Xero/Rillet by code
    expect(index.get("xero-uuid-1")).toBe("acc_1");
    expect(index.get("1200")).toBe("acc_1");
  });

  it("skips null refs and tolerates non-object metadata", () => {
    const index = buildRemoteAccountRefIndex([
      { entityId: "acc_1", externalId: null, metadata: null },
      { entityId: "acc_2", externalId: "77", metadata: "junk" },
      { entityId: "acc_3", externalId: "88", metadata: ["not", "a", "record"] }
    ]);

    expect(index.size).toBe(2);
    expect(index.get("77")).toBe("acc_2");
    expect(index.get("88")).toBe("acc_3");
  });

  it("first mapping wins on a shared ref (many-to-one consolidation)", () => {
    const index = buildRemoteAccountRefIndex([
      { entityId: "acc_1", externalId: "shared", metadata: null },
      { entityId: "acc_2", externalId: "shared", metadata: null }
    ]);

    expect(index.get("shared")).toBe("acc_1");
  });
});

// ── Delta math ──────────────────────────────────────────────────────────────

describe("computeTieOutDeltas", () => {
  it("is zero-delta when every posted cent is accounted for and matches the provider", () => {
    const { internalDeltaCents, externalDeltaCents } = computeTieOutDeltas({
      carbonPostedCents: 100_00,
      syncedCents: 40_00,
      docBackedCents: 30_00,
      excludedCents: 10_00,
      pendingCents: 15_00,
      blockedCents: 5_00,
      providerCents: 40_00
    });

    expect(internalDeltaCents).toBe(0);
    expect(externalDeltaCents).toBe(0);
  });

  it("surfaces internal drift: posted amounts no disposition covers", () => {
    const { internalDeltaCents } = computeTieOutDeltas({
      carbonPostedCents: 100_00,
      syncedCents: 90_00,
      docBackedCents: 0,
      excludedCents: 0,
      pendingCents: 0,
      blockedCents: 0,
      providerCents: null
    });

    expect(internalDeltaCents).toBe(10_00);
  });

  it("surfaces external drift as synced − provider, and NULLs it without a fetch", () => {
    const drifted = computeTieOutDeltas({
      carbonPostedCents: 50_00,
      syncedCents: 50_00,
      docBackedCents: 0,
      excludedCents: 0,
      pendingCents: 0,
      blockedCents: 0,
      providerCents: 45_00
    });
    expect(drifted.externalDeltaCents).toBe(5_00);

    const unfetched = computeTieOutDeltas({
      carbonPostedCents: 50_00,
      syncedCents: 50_00,
      docBackedCents: 0,
      excludedCents: 0,
      pendingCents: 0,
      blockedCents: 0,
      providerCents: null
    });
    expect(unfetched.externalDeltaCents).toBeNull();
  });

  it("handles net-credit (negative debit-signed) cells", () => {
    const { internalDeltaCents, externalDeltaCents } = computeTieOutDeltas({
      carbonPostedCents: -25_00,
      syncedCents: -25_00,
      docBackedCents: 0,
      excludedCents: 0,
      pendingCents: 0,
      blockedCents: 0,
      providerCents: -25_00
    });

    expect(internalDeltaCents).toBe(0);
    expect(externalDeltaCents).toBe(0);
  });
});
