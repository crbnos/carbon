import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  compareMonthlyTotals,
  getAdvancedPullCursor,
  getDailyConsolidationBatchKey,
  getJournalPostingDecision,
  getNettedPositiveCents,
  getPositiveCents,
  getPullCursorDecision,
  getPullIdempotencyScope,
  getSweepFloorDate,
  getSyncOperationCloseDecision,
  getSyncOperationFailureRecord,
  getSyncOperationIdempotencyKey,
  getUtcDateString,
  isClaimableConsolidationOperation,
  isDailyConsolidationMarker,
  isJournalEntryPostingEnabled,
  type JournalPostingEventInput,
  MAX_RECONCILIATION_DRIFT_ENTRIES,
  mergePostingSyncReconciliation,
  mergePullCursor,
  partitionConsolidationOperations,
  planJournalPostingOperation,
  resolvePaymentJournalFamily,
  SWEEP_LOOKBACK_DAYS,
  shouldEnqueueMissingDocument,
  toIsoDateString
} from "./accounting-sync-operations";

// ── Journal posting transition detection ────────────────────────────────────
// The event-system envelope carries the FULL old and new rows for UPDATEs
// (row_to_json in dispatch_event_batch), so a posting transition is
// old.status ≠ new.status landing on Posted/Reversed — never "any UPDATE
// that touches a Posted journal".

function journalEvent(
  overrides: Partial<JournalPostingEventInput>
): JournalPostingEventInput {
  return {
    operation: "UPDATE",
    recordId: "je_1",
    new: { id: "je_1", status: "Posted" },
    old: { id: "je_1", status: "Draft" },
    ...overrides
  };
}

describe("getJournalPostingDecision", () => {
  it("enqueues a push when status transitions to Posted", () => {
    const decision = getJournalPostingDecision(journalEvent({}));
    expect(decision).toEqual({
      action: "enqueue",
      entityId: "je_1",
      reversal: false
    });
  });

  it("does not enqueue an UPDATE that leaves status at Posted", () => {
    // e.g. an unrelated column touched on an already-Posted journal
    const decision = getJournalPostingDecision(
      journalEvent({
        new: { id: "je_1", status: "Posted", description: "edited" },
        old: { id: "je_1", status: "Posted", description: "original" }
      })
    );
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("did not change");
    }
  });

  it("enqueues a reversal with the suffixed entity id when status transitions to Reversed", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        new: { id: "je_1", status: "Reversed" },
        old: { id: "je_1", status: "Posted" }
      })
    );
    expect(decision).toEqual({
      action: "enqueue",
      entityId: "je_1:reversal",
      reversal: true
    });
  });

  it("enqueues an INSERT born Posted — the post-* edge functions insert journals already Posted", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        operation: "INSERT",
        new: { id: "je_1", status: "Posted", reversalOfId: null },
        old: null
      })
    );
    expect(decision).toEqual({
      action: "enqueue",
      entityId: "je_1",
      reversal: false
    });
  });

  it("skips INSERTs born Draft (posting arrives later as an UPDATE transition)", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        operation: "INSERT",
        new: { id: "je_1", status: "Draft" },
        old: null
      })
    );
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("INSERT");
    }
  });

  it("skips reversal INSERTs (reversalOfId set) — the original's Reversed transition carries the push", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        operation: "INSERT",
        new: { id: "je_2", status: "Posted", reversalOfId: "je_1" },
        old: null
      })
    );
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("reversalOfId");
    }
  });

  it("skips DELETEs", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        operation: "DELETE",
        new: null,
        old: { id: "je_1", status: "Posted" }
      })
    );
    expect(decision.action).toBe("skip");
  });

  it("skips transitions to a non-posting status", () => {
    const decision = getJournalPostingDecision(
      journalEvent({
        new: { id: "je_1", status: "Draft" },
        old: { id: "je_1", status: "Posted" }
      })
    );
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("'Draft'");
    }
  });

  it("skips UPDATEs whose envelope is missing the old or new status", () => {
    const missingNew = getJournalPostingDecision(
      journalEvent({ new: { id: "je_1" } })
    );
    expect(missingNew.action).toBe("skip");

    const missingOld = getJournalPostingDecision(
      journalEvent({ old: { id: "je_1" } })
    );
    expect(missingOld.action).toBe("skip");
  });
});

describe("isJournalEntryPostingEnabled", () => {
  it("is enabled by default (posting sync is always-on)", () => {
    expect(isJournalEntryPostingEnabled(undefined)).toBe(true);
    expect(isJournalEntryPostingEnabled({})).toBe(true);
  });

  it("honors a stored explicit disable at this seam (legacy escape hatch — the provider configs force it back on for the syncers)", () => {
    expect(
      isJournalEntryPostingEnabled({
        syncConfig: { entities: { journalEntry: { enabled: false } } }
      })
    ).toBe(false);
  });

  it("ignores invalid stored fragments and keeps the always-on default", () => {
    expect(
      isJournalEntryPostingEnabled({
        syncConfig: { entities: { journalEntry: { enabled: "yes" } } }
      })
    ).toBe(true);
  });
});

// ── Structured failure fidelity ──────────────────────────────────────────────
// Journal pre-flight failures surface on SyncResult.error as a structured
// envelope; the drain must record errorCode + Warning/Failed and keep the
// envelope metadata. Everything else keeps the flattened-string behavior.

describe("getSyncOperationFailureRecord", () => {
  const operation = { metadata: { reversal: true } };

  it("reports a missing sync result", () => {
    expect(getSyncOperationFailureRecord(operation, undefined)).toEqual({
      errorMessage: "No sync result returned for entity"
    });
  });

  it("keeps errorCode, warning flag and metadata for a structured journal failure", () => {
    const record = getSyncOperationFailureRecord(operation, {
      error: {
        errorCode: "UNMAPPED_ACCOUNTS",
        message: "2 account(s) have no provider account mapping",
        warning: true,
        metadata: { unmappedAccountIds: ["acc_1", "acc_2"] }
      }
    });

    expect(record).toEqual({
      errorCode: "UNMAPPED_ACCOUNTS",
      errorMessage: "2 account(s) have no provider account mapping",
      warning: true,
      // The failure metadata merges OVER the operation's existing metadata
      // so enqueue-time keys (reversal) survive the failure
      metadata: { reversal: true, unmappedAccountIds: ["acc_1", "acc_2"] }
    });
  });

  it("marks hard failures (warning: false) as Failed, not Warning", () => {
    const record = getSyncOperationFailureRecord(operation, {
      error: {
        errorCode: "UNBALANCED_JOURNAL",
        message: "Journal JE-1 does not balance",
        warning: false
      }
    });

    expect(record.warning).toBe(false);
    expect(record.errorCode).toBe("UNBALANCED_JOURNAL");
    // No envelope metadata → the operation's stored metadata is untouched
    expect(record.metadata).toBeUndefined();
  });

  it("flattens non-structured errors to strings exactly as before", () => {
    expect(
      getSyncOperationFailureRecord(operation, {
        error: new Error("Xero API returned 500")
      })
    ).toEqual({ errorMessage: "Xero API returned 500" });

    expect(
      getSyncOperationFailureRecord(operation, { error: "plain string" })
    ).toEqual({ errorMessage: "plain string" });

    expect(
      getSyncOperationFailureRecord(operation, { error: undefined })
    ).toEqual({ errorMessage: "Unknown sync error" });
  });

  it("rejects lookalike envelopes with an unknown errorCode", () => {
    const record = getSyncOperationFailureRecord(operation, {
      error: { errorCode: "NOT_A_REAL_CODE", message: "nope", warning: true }
    });

    expect(record.errorCode).toBeUndefined();
    expect(record.errorMessage).toBe(
      JSON.stringify({
        errorCode: "NOT_A_REAL_CODE",
        message: "nope",
        warning: true
      })
    );
  });
});

describe("getSyncOperationIdempotencyKey", () => {
  it("scopes the key by entity, direction and delivery — the reversal suffix rides in the entityId", () => {
    expect(
      getSyncOperationIdempotencyKey({
        entityType: "journalEntry",
        entityId: "je_1:reversal",
        direction: "push-to-accounting",
        scope: "evt_123"
      })
    ).toBe("journalEntry:je_1:reversal:push-to-accounting:evt_123");
  });
});

// ── Daily-consolidation decisions (Task 12) ──────────────────────────────────

describe("getDailyConsolidationBatchKey", () => {
  it("builds daily:<integration>:<postingDate> (legacy, no source type)", () => {
    expect(getDailyConsolidationBatchKey("xero", "2026-07-08")).toBe(
      "daily:xero:2026-07-08"
    );
    expect(getDailyConsolidationBatchKey("xero", "2026-07-08", null)).toBe(
      "daily:xero:2026-07-08"
    );
  });

  it("builds daily:<integration>:<source-type-slug>:<postingDate> for v3 partitions", () => {
    expect(
      getDailyConsolidationBatchKey("xero", "2026-07-08", "Production Event")
    ).toBe("daily:xero:production-event:2026-07-08");
    expect(
      getDailyConsolidationBatchKey("xero", "2026-07-08", "Job Consumption")
    ).toBe("daily:xero:job-consumption:2026-07-08");
  });

  it("round-trips through the marker detector", () => {
    expect(
      isDailyConsolidationMarker(
        getDailyConsolidationBatchKey("xero", "2026-07-08")
      )
    ).toBe(true);
    expect(
      isDailyConsolidationMarker(
        getDailyConsolidationBatchKey("xero", "2026-07-08", "Production Event")
      )
    ).toBe(true);
    expect(isDailyConsolidationMarker("journal_123")).toBe(false);
    expect(isDailyConsolidationMarker("journal_123:reversal")).toBe(false);
  });
});

describe("toIsoDateString", () => {
  it("passes through ISO date strings and trims timestamps", () => {
    expect(toIsoDateString("2026-07-08")).toBe("2026-07-08");
    expect(toIsoDateString("2026-07-08T14:00:00.000Z")).toBe("2026-07-08");
  });

  it("converts Date objects (driver-dependent date parsing) to UTC dates", () => {
    expect(toIsoDateString(new Date("2026-07-08T00:00:00.000Z"))).toBe(
      "2026-07-08"
    );
  });

  it("returns null for garbage", () => {
    expect(toIsoDateString(null)).toBeNull();
    expect(toIsoDateString(undefined)).toBeNull();
    expect(toIsoDateString(123)).toBeNull();
    expect(toIsoDateString("short")).toBeNull();
    expect(toIsoDateString(new Date("not a date"))).toBeNull();
  });
});

describe("getUtcDateString", () => {
  it("formats the UTC calendar date", () => {
    expect(getUtcDateString(new Date("2026-07-09T01:59:00.000Z"))).toBe(
      "2026-07-09"
    );
    // 23:30 UTC is still the same UTC day regardless of local offsets
    expect(getUtcDateString(new Date("2026-07-08T23:30:00.000Z"))).toBe(
      "2026-07-08"
    );
  });
});

describe("isClaimableConsolidationOperation", () => {
  const now = new Date("2026-07-09T02:00:00.000Z");

  it("claims Pending rows", () => {
    expect(
      isClaimableConsolidationOperation(
        { status: "Pending", lastAttemptAt: null },
        now
      )
    ).toBe(true);
  });

  it("claims only STALE In Flight rows (older than the 10 minute window)", () => {
    expect(
      isClaimableConsolidationOperation(
        { status: "In Flight", lastAttemptAt: "2026-07-09T01:55:00.000Z" },
        now
      )
    ).toBe(false);
    expect(
      isClaimableConsolidationOperation(
        { status: "In Flight", lastAttemptAt: "2026-07-09T01:49:59.000Z" },
        now
      )
    ).toBe(true);
    // No lastAttemptAt matches the claim query's `.lt` behavior: not claimable
    expect(
      isClaimableConsolidationOperation(
        { status: "In Flight", lastAttemptAt: null },
        now
      )
    ).toBe(false);
  });

  it("never claims terminal statuses", () => {
    for (const status of [
      "Completed",
      "Failed",
      "Warning",
      "Skipped"
    ] as const) {
      expect(
        isClaimableConsolidationOperation({ status, lastAttemptAt: null }, now)
      ).toBe(false);
    }
  });
});

describe("partitionConsolidationOperations", () => {
  const today = "2026-07-09";
  const integration = "xero";

  const op = (
    id: string,
    entityId: string,
    metadata: Record<string, unknown> | null = null
  ) => ({ id, entityId, metadata });

  const groupIds = (
    partition: ReturnType<typeof partitionConsolidationOperations>,
    batchKey: string
  ) => partition.byGroup.get(batchKey)?.operations.map((o) => o.id);

  it("splits markers, reversals, dated members, held and missing", () => {
    const partition = partitionConsolidationOperations({
      operations: [
        op("op_marker", "daily:xero:2026-07-07"),
        op("op_rev_meta", "j_rev", { reversal: true }),
        op("op_rev_suffix", "j_orig:reversal"),
        op("op_yesterday_a", "j_a"),
        op("op_yesterday_b", "j_b"),
        op("op_older", "j_c"),
        op("op_today", "j_today"),
        op("op_missing", "j_gone")
      ],
      postingDateByJournalId: new Map([
        ["j_rev", "2026-07-01"],
        ["j_orig", "2026-07-01"],
        ["j_a", "2026-07-08"],
        ["j_b", "2026-07-08"],
        ["j_c", "2026-07-05"],
        ["j_today", "2026-07-09"]
      ]),
      today,
      integration,
      consolidatedBatchKeys: new Set()
    });

    expect(partition.markers.map((o) => o.id)).toEqual(["op_marker"]);
    expect(partition.reversals.map((o) => o.id)).toEqual([
      "op_rev_meta",
      "op_rev_suffix"
    ]);
    // Unstamped (legacy) ops group under the sourceType-less legacy key
    expect([...partition.byGroup.keys()].sort()).toEqual([
      "daily:xero:2026-07-05",
      "daily:xero:2026-07-08"
    ]);
    expect(groupIds(partition, "daily:xero:2026-07-08")).toEqual([
      "op_yesterday_a",
      "op_yesterday_b"
    ]);
    expect(groupIds(partition, "daily:xero:2026-07-05")).toEqual(["op_older"]);
    expect(partition.held.map((o) => o.id)).toEqual(["op_today"]);
    expect(partition.missing.map((o) => o.id)).toEqual(["op_missing"]);
    expect(partition.individual).toEqual([]);
  });

  it("groups stamped members per (source type, posting date) batch key", () => {
    const partition = partitionConsolidationOperations({
      operations: [
        op("op_pe_1", "j_1", {
          sourceType: "Production Event",
          granularity: "daily-summary"
        }),
        op("op_pe_2", "j_2", {
          sourceType: "Production Event",
          granularity: "daily-summary"
        }),
        op("op_jc", "j_3", {
          sourceType: "Job Consumption",
          granularity: "daily-summary"
        }),
        op("op_legacy", "j_4")
      ],
      postingDateByJournalId: new Map([
        ["j_1", "2026-07-08"],
        ["j_2", "2026-07-08"],
        ["j_3", "2026-07-08"],
        ["j_4", "2026-07-08"]
      ]),
      today,
      integration,
      consolidatedBatchKeys: new Set()
    });

    expect([...partition.byGroup.keys()].sort()).toEqual([
      "daily:xero:2026-07-08",
      "daily:xero:job-consumption:2026-07-08",
      "daily:xero:production-event:2026-07-08"
    ]);
    expect(
      groupIds(partition, "daily:xero:production-event:2026-07-08")
    ).toEqual(["op_pe_1", "op_pe_2"]);
    expect(
      partition.byGroup.get("daily:xero:production-event:2026-07-08")
        ?.sourceType
    ).toBe("Production Event");
    expect(groupIds(partition, "daily:xero:2026-07-08")).toEqual(["op_legacy"]);
  });

  it("routes individual-granularity ops to the individual path, never consolidating them", () => {
    const partition = partitionConsolidationOperations({
      operations: [
        op("op_individual", "j_ind", {
          sourceType: "Purchase Receipt",
          granularity: "individual"
        })
      ],
      postingDateByJournalId: new Map([["j_ind", "2026-07-08"]]),
      today,
      integration,
      consolidatedBatchKeys: new Set()
    });
    expect(partition.individual.map((o) => o.id)).toEqual(["op_individual"]);
    expect(partition.byGroup.size).toBe(0);
  });

  it("holds journals dated after today (post-dated) as well", () => {
    const partition = partitionConsolidationOperations({
      operations: [op("op_future", "j_future")],
      postingDateByJournalId: new Map([["j_future", "2026-08-01"]]),
      today,
      integration,
      consolidatedBatchKeys: new Set()
    });
    expect(partition.held.map((o) => o.id)).toEqual(["op_future"]);
  });

  it("routes members of an already-consolidated batch (marker Completed) to the individual path", () => {
    const partition = partitionConsolidationOperations({
      operations: [op("op_backdated", "j_late"), op("op_normal", "j_new")],
      postingDateByJournalId: new Map([
        ["j_late", "2026-07-01"],
        ["j_new", "2026-07-08"]
      ]),
      today,
      integration,
      consolidatedBatchKeys: new Set(["daily:xero:2026-07-01"])
    });

    expect(partition.individual.map((o) => o.id)).toEqual(["op_backdated"]);
    expect(groupIds(partition, "daily:xero:2026-07-08")).toEqual(["op_normal"]);
  });
});

// ── Reconciliation comparisons (Task 13) ─────────────────────────────────────

describe("getPositiveCents", () => {
  it("sums only debit (positive) line amounts, in cents", () => {
    expect(
      getPositiveCents([
        { amount: 100.25 },
        { amount: -100.25 },
        { amount: 0.1 },
        { amount: 0.2 }
      ])
    ).toBe(10055);
  });

  it("is zero for an all-credit set", () => {
    expect(getPositiveCents([{ amount: -5 }, { amount: -1.5 }])).toBe(0);
  });
});

describe("getNettedPositiveCents", () => {
  it("nets per account before summing debits (consolidated batches)", () => {
    // acct_a nets to zero across members, so only acct_b's 100 books
    expect(
      getNettedPositiveCents([
        { accountId: "acct_a", amount: 100 },
        { accountId: "acct_c", amount: -100 },
        { accountId: "acct_a", amount: -100 },
        { accountId: "acct_b", amount: 100 }
      ])
    ).toBe(10000);
  });

  it("differs from the raw debit sum exactly when accounts cancel", () => {
    const lines = [
      { accountId: "acct_a", amount: 50 },
      { accountId: "acct_a", amount: -50 },
      { accountId: "acct_b", amount: 25 },
      { accountId: "acct_c", amount: -25 }
    ];
    expect(getPositiveCents(lines)).toBe(7500);
    expect(getNettedPositiveCents(lines)).toBe(2500);
  });
});

describe("compareMonthlyTotals", () => {
  it("reports exactly one drift row for one matching and one mismatched month", () => {
    const drift = compareMonthlyTotals({
      carbonCentsByMonth: new Map([
        ["2026-05", 125000],
        ["2026-06", 200000]
      ]),
      providerCentsByMonth: new Map([
        ["2026-05", 125000],
        ["2026-06", 190000]
      ])
    });

    expect(drift).toEqual([
      {
        type: "mismatch",
        month: "2026-06",
        carbonTotal: 2000,
        providerTotal: 1900
      }
    ]);
  });

  it("tolerates a difference of exactly 0.01 but not more", () => {
    const atBoundary = compareMonthlyTotals({
      carbonCentsByMonth: new Map([["2026-06", 10001]]),
      providerCentsByMonth: new Map([["2026-06", 10000]])
    });
    expect(atBoundary).toEqual([]);

    const overBoundary = compareMonthlyTotals({
      carbonCentsByMonth: new Map([["2026-06", 10002]]),
      providerCentsByMonth: new Map([["2026-06", 10000]])
    });
    expect(overBoundary).toEqual([
      {
        type: "mismatch",
        month: "2026-06",
        carbonTotal: 100.02,
        providerTotal: 100
      }
    ]);
  });

  it("treats a month missing on one side as zero", () => {
    const drift = compareMonthlyTotals({
      carbonCentsByMonth: new Map([["2026-04", 5000]]),
      providerCentsByMonth: new Map()
    });
    expect(drift).toEqual([
      {
        type: "mismatch",
        month: "2026-04",
        carbonTotal: 50,
        providerTotal: 0
      }
    ]);
  });

  it("sorts drift rows by month", () => {
    const drift = compareMonthlyTotals({
      carbonCentsByMonth: new Map([
        ["2026-06", 100],
        ["2026-04", 300]
      ]),
      providerCentsByMonth: new Map()
    });
    expect(drift.map((entry) => entry.month)).toEqual(["2026-04", "2026-06"]);
  });
});

describe("mergePostingSyncReconciliation", () => {
  const report = {
    runAt: "2026-07-13T03:00:00.000Z",
    drift: [
      {
        type: "missing" as const,
        externalId: "mj_1",
        journalId: "j_1",
        amount: 100
      }
    ]
  };

  it("preserves credentials, syncConfig and sibling settings keys", () => {
    const metadata = {
      credentials: { type: "oauth2", accessToken: "secret" },
      syncConfig: { entities: { journalEntry: { enabled: true } } },
      defaultSalesAccountCode: "200",
      settings: {
        other: { keep: true },
        postingSync: {
          enabled: true,
          consolidation: "daily",
          sourceTypes: ["Purchase Receipt"]
        }
      }
    };

    const merged = mergePostingSyncReconciliation(metadata, report);

    expect(merged.credentials).toEqual(metadata.credentials);
    expect(merged.syncConfig).toEqual(metadata.syncConfig);
    expect(merged.defaultSalesAccountCode).toBe("200");
    expect((merged.settings as Record<string, unknown>).other).toEqual({
      keep: true
    });

    const postingSync = (merged.settings as Record<string, any>).postingSync;
    expect(postingSync.enabled).toBe(true);
    expect(postingSync.consolidation).toBe("daily");
    expect(postingSync.sourceTypes).toEqual(["Purchase Receipt"]);
    expect(postingSync.lastReconciliation).toEqual({
      runAt: report.runAt,
      drift: report.drift
    });
  });

  it("replaces a previous report instead of accumulating", () => {
    const metadata = {
      settings: {
        postingSync: {
          enabled: true,
          lastReconciliation: {
            runAt: "2026-07-06T03:00:00.000Z",
            drift: [{ type: "mismatch", month: "2026-05" }]
          }
        }
      }
    };

    const merged = mergePostingSyncReconciliation(metadata, report);
    const postingSync = (merged.settings as Record<string, any>).postingSync;
    expect(postingSync.lastReconciliation.runAt).toBe(report.runAt);
    expect(postingSync.lastReconciliation.drift).toEqual(report.drift);
  });

  it("builds the settings path from nothing (null metadata)", () => {
    const merged = mergePostingSyncReconciliation(null, report);
    expect(
      (merged.settings as Record<string, any>).postingSync.lastReconciliation
        .runAt
    ).toBe(report.runAt);
  });

  it("caps drift at 100 entries", () => {
    const bigReport = {
      runAt: report.runAt,
      drift: Array.from({ length: 150 }, (_, index) => ({
        type: "missing" as const,
        externalId: `mj_${index}`,
        journalId: `j_${index}`
      }))
    };

    const merged = mergePostingSyncReconciliation({}, bigReport);
    const stored = (merged.settings as Record<string, any>).postingSync
      .lastReconciliation.drift;
    expect(stored).toHaveLength(MAX_RECONCILIATION_DRIFT_ENTRIES);
    expect(stored[0].externalId).toBe("mj_0");
    expect(stored[99].externalId).toBe("mj_99");
  });
});

// ── Pull-sweep cursor decisions ──────────────────────────────────────────────

describe("getPullCursorDecision", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");
  // 29 days before `now` (QBO CDC caps the lookback at 30)
  const clampFloor = "2026-06-10T12:00:00.000Z";
  const maxLookbackDays = 29;

  it("uses the stored settings.pullCursor, normalized to UTC", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: {
          settings: { pullCursor: "2026-07-08T13:07:59-07:00" }
        },
        integrationUpdatedAt: "2026-07-01T00:00:00.000Z",
        maxLookbackDays,
        now
      })
    ).toEqual({
      changedSince: "2026-07-08T20:07:59.000Z",
      clamped: false,
      source: "cursor"
    });
  });

  it("defaults to the integration's updatedAt (connect time) when no cursor is stored", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: { settings: {} },
        integrationUpdatedAt: "2026-07-01T00:00:00.000Z",
        maxLookbackDays,
        now
      })
    ).toEqual({
      changedSince: "2026-07-01T00:00:00.000Z",
      clamped: false,
      source: "connectTime"
    });
  });

  it("clamps cursors older than a capped provider's window and reports it", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: {
          settings: { pullCursor: "2026-01-01T00:00:00.000Z" }
        },
        integrationUpdatedAt: null,
        maxLookbackDays,
        now
      })
    ).toEqual({
      changedSince: clampFloor,
      clamped: true,
      source: "cursor"
    });
  });

  it("clamps a stale connect-time default the same way", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: null,
        integrationUpdatedAt: "2026-01-01T00:00:00.000Z",
        maxLookbackDays,
        now
      })
    ).toEqual({
      changedSince: clampFloor,
      clamped: true,
      source: "connectTime"
    });
  });

  it("falls back to the clamp floor when neither a parseable cursor nor updatedAt exists", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: { settings: { pullCursor: "not a date" } },
        integrationUpdatedAt: null,
        maxLookbackDays,
        now
      })
    ).toEqual({
      changedSince: clampFloor,
      clamped: false,
      source: "fallback"
    });
  });

  it("never clamps a provider without a lookback cap (Rillet)", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: {
          settings: { pullCursor: "2026-01-01T00:00:00.000Z" }
        },
        integrationUpdatedAt: null,
        now
      })
    ).toEqual({
      changedSince: "2026-01-01T00:00:00.000Z",
      clamped: false,
      source: "cursor"
    });
  });

  it("uncapped fallback is `now` when nothing usable is stored", () => {
    expect(
      getPullCursorDecision({
        integrationMetadata: null,
        integrationUpdatedAt: null,
        now
      })
    ).toEqual({
      changedSince: now.toISOString(),
      clamped: false,
      source: "fallback"
    });
  });
});

describe("getAdvancedPullCursor", () => {
  it("advances to the max LastUpdatedTime seen, normalizing offsets to UTC", () => {
    expect(
      getAdvancedPullCursor({
        changedSince: "2026-07-08T00:00:00.000Z",
        lastUpdatedTimes: [
          "2026-07-08T23:00:00Z",
          // 18:00 -07:00 = 2026-07-09T01:00:00Z — chronologically later
          // despite the smaller wall-clock time
          "2026-07-08T18:00:00-07:00",
          null
        ]
      })
    ).toBe("2026-07-09T01:00:00.000Z");
  });

  it("never regresses: an empty or all-older change set keeps changedSince", () => {
    expect(
      getAdvancedPullCursor({
        changedSince: "2026-07-08T00:00:00.000Z",
        lastUpdatedTimes: []
      })
    ).toBe("2026-07-08T00:00:00.000Z");

    expect(
      getAdvancedPullCursor({
        changedSince: "2026-07-08T00:00:00.000Z",
        lastUpdatedTimes: ["2026-07-01T00:00:00.000Z", "garbage", null]
      })
    ).toBe("2026-07-08T00:00:00.000Z");
  });
});

describe("getPullIdempotencyScope", () => {
  it("scopes by the change's updatedAt — stable across cron retries", () => {
    expect(
      getPullIdempotencyScope(
        "2026-07-08T13:07:59-07:00",
        "2026-07-08T00:00:00.000Z"
      )
    ).toBe("pull:2026-07-08T13:07:59-07:00");
  });

  it("falls back to the run's changedSince when the record has no timestamp", () => {
    expect(getPullIdempotencyScope(null, "2026-07-08T00:00:00.000Z")).toBe(
      "pull:2026-07-08T00:00:00.000Z"
    );
  });

  it("composes with the established idempotency-key scheme", () => {
    expect(
      getSyncOperationIdempotencyKey({
        entityType: "customer",
        entityId: "63",
        direction: "pull-from-accounting",
        scope: getPullIdempotencyScope(
          "2026-07-08T13:07:59-07:00",
          "2026-07-08T00:00:00.000Z"
        )
      })
    ).toBe("customer:63:pull-from-accounting:pull:2026-07-08T13:07:59-07:00");
  });
});

describe("mergePullCursor", () => {
  it("writes settings.pullCursor (NOT under postingSync) preserving every sibling", () => {
    const metadata = {
      credentials: { type: "oauth2", accessToken: "secret" },
      syncConfig: { entities: { customer: { enabled: true } } },
      settings: {
        postingSync: { enabled: true, consolidation: "daily" },
        other: { keep: true },
        pullCursor: "2026-07-01T00:00:00.000Z"
      }
    };

    const merged = mergePullCursor(metadata, "2026-07-08T20:07:59.000Z");

    expect(merged.credentials).toEqual(metadata.credentials);
    expect(merged.syncConfig).toEqual(metadata.syncConfig);
    const settings = merged.settings as Record<string, unknown>;
    expect(settings.postingSync).toEqual({
      enabled: true,
      consolidation: "daily"
    });
    expect(settings.other).toEqual({ keep: true });
    expect(settings.pullCursor).toBe("2026-07-08T20:07:59.000Z");
  });

  it("builds the settings path from nothing", () => {
    expect(mergePullCursor(null, "2026-07-08T00:00:00.000Z")).toEqual({
      settings: { pullCursor: "2026-07-08T00:00:00.000Z" }
    });
  });
});

// ── v3 posting dispositions (plan + payment family) ─────────────────────────

/**
 * Minimal supabase stub for resolvePaymentJournalFamily: accountDefault
 * resolves the control accounts, journalLine resolves the line accountIds.
 */
function stubPaymentClient(args: {
  receivables: string;
  payables: string;
  lineAccounts: string[];
}): SupabaseClient<Database> {
  return {
    from(table: string) {
      if (table === "accountDefault") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  receivablesAccount: args.receivables,
                  payablesAccount: args.payables
                },
                error: null
              })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: args.lineAccounts.map((accountId) => ({ accountId })),
              error: null
            })
          })
        })
      };
    }
  } as unknown as SupabaseClient<Database>;
}

/** Client that throws if touched — non-Payment paths must not query. */
const untouchableClient = new Proxy(
  {},
  {
    get() {
      throw new Error("planJournalPostingOperation touched the client");
    }
  }
) as SupabaseClient<Database>;

const postingEnabledMetadata = (overrides?: {
  postingSync?: Record<string, unknown>;
  entities?: Record<string, Record<string, unknown>>;
}) => ({
  syncConfig: {
    entities: {
      journalEntry: { enabled: true, direction: "push-to-accounting" },
      ...(overrides?.entities ?? {})
    }
  },
  settings: {
    postingSync: { enabled: true, ...(overrides?.postingSync ?? {}) }
  }
});

describe("resolvePaymentJournalFamily", () => {
  it("resolves AR when the lines touch the receivables control account", async () => {
    const family = await resolvePaymentJournalFamily(
      stubPaymentClient({
        receivables: "acc-ar",
        payables: "acc-ap",
        lineAccounts: ["acc-bank", "acc-ar"]
      }),
      { companyId: "co_1", journalId: "je_1" }
    );
    expect(family).toBe("ar");
  });

  it("resolves AP when the lines touch the payables control account", async () => {
    const family = await resolvePaymentJournalFamily(
      stubPaymentClient({
        receivables: "acc-ar",
        payables: "acc-ap",
        lineAccounts: ["acc-bank", "acc-ap"]
      }),
      { companyId: "co_1", journalId: "je_1" }
    );
    expect(family).toBe("ap");
  });

  it("returns null when neither or both control sides appear", async () => {
    expect(
      await resolvePaymentJournalFamily(
        stubPaymentClient({
          receivables: "acc-ar",
          payables: "acc-ap",
          lineAccounts: ["acc-bank"]
        }),
        { companyId: "co_1", journalId: "je_1" }
      )
    ).toBeNull();

    expect(
      await resolvePaymentJournalFamily(
        stubPaymentClient({
          receivables: "acc-ar",
          payables: "acc-ap",
          lineAccounts: ["acc-ar", "acc-ap"]
        }),
        { companyId: "co_1", journalId: "je_1" }
      )
    ).toBeNull();
  });
});

describe("planJournalPostingOperation", () => {
  it("skips non-posting events without touching the policy", async () => {
    const plan = await planJournalPostingOperation({
      client: untouchableClient,
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_1",
        new: { id: "je_1", status: "Draft" },
        old: null
      },
      integrationMetadata: postingEnabledMetadata()
    });
    expect(plan.action).toBe("skip");
  });

  it("plans a push with granularity + sourceType metadata for enabled journal types", async () => {
    const plan = await planJournalPostingOperation({
      client: untouchableClient,
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_1",
        new: {
          id: "je_1",
          status: "Posted",
          reversalOfId: null,
          sourceType: "Production Event"
        },
        old: null
      },
      integrationMetadata: postingEnabledMetadata()
    });

    expect(plan).toEqual({
      action: "push",
      request: {
        entityType: "journalEntry",
        entityId: "je_1",
        direction: "push-to-accounting",
        metadata: {
          sourceType: "Production Event",
          granularity: "daily-summary"
        }
      }
    });
  });

  it("records DOC_BACKED exclusions with the backing document entity", async () => {
    const plan = await planJournalPostingOperation({
      client: untouchableClient,
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_1",
        new: {
          id: "je_1",
          status: "Posted",
          reversalOfId: null,
          sourceType: "Sales Invoice"
        },
        old: null
      },
      integrationMetadata: postingEnabledMetadata()
    });

    expect(plan.action).toBe("terminal");
    if (plan.action !== "terminal") throw new Error("expected terminal");
    expect(plan.request.status).toBe("Excluded");
    expect(plan.request.errorCode).toBe("DOC_BACKED");
    expect(plan.request.metadata).toMatchObject({
      sourceType: "Sales Invoice",
      backingDocument: { entityType: "invoice" }
    });
  });

  it("parks DOC_SYNC_DISABLED as a Warning when the backing document sync is off", async () => {
    const plan = await planJournalPostingOperation({
      client: untouchableClient,
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_1",
        new: {
          id: "je_1",
          status: "Posted",
          reversalOfId: null,
          sourceType: "Sales Invoice"
        },
        old: null
      },
      integrationMetadata: postingEnabledMetadata({
        entities: { invoice: { enabled: false } }
      })
    });

    expect(plan.action).toBe("terminal");
    if (plan.action !== "terminal") throw new Error("expected terminal");
    expect(plan.request.status).toBe("Warning");
    expect(plan.request.errorCode).toBe("DOC_SYNC_DISABLED");
  });

  it("suffixes reversal pushes and stamps reversal metadata", async () => {
    const plan = await planJournalPostingOperation({
      client: untouchableClient,
      companyId: "co_1",
      event: {
        operation: "UPDATE",
        recordId: "je_1",
        new: { id: "je_1", status: "Reversed", sourceType: "Purchase Receipt" },
        old: { id: "je_1", status: "Posted" }
      },
      integrationMetadata: postingEnabledMetadata()
    });

    expect(plan).toEqual({
      action: "push",
      request: {
        entityType: "journalEntry",
        entityId: "je_1:reversal",
        direction: "push-to-accounting",
        metadata: {
          reversal: true,
          sourceType: "Purchase Receipt",
          granularity: "individual"
        }
      }
    });
  });

  it("resolves the Payment side from control-account lines when family modes diverge", async () => {
    const metadata = postingEnabledMetadata({
      postingSync: {
        families: { ar: "journals", ap: "documents" }
      },
      entities: { invoice: { enabled: false } }
    });

    const arPlan = await planJournalPostingOperation({
      client: stubPaymentClient({
        receivables: "acc-ar",
        payables: "acc-ap",
        lineAccounts: ["acc-bank", "acc-ar"]
      }),
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_1",
        new: {
          id: "je_1",
          status: "Posted",
          reversalOfId: null,
          sourceType: "Payment"
        },
        old: null
      },
      integrationMetadata: metadata
    });
    expect(arPlan.action).toBe("push");

    const unresolvedPlan = await planJournalPostingOperation({
      client: stubPaymentClient({
        receivables: "acc-ar",
        payables: "acc-ap",
        lineAccounts: ["acc-bank"]
      }),
      companyId: "co_1",
      event: {
        operation: "INSERT",
        recordId: "je_2",
        new: {
          id: "je_2",
          status: "Posted",
          reversalOfId: null,
          sourceType: "Payment"
        },
        old: null
      },
      integrationMetadata: metadata
    });
    expect(unresolvedPlan.action).toBe("terminal");
    if (unresolvedPlan.action !== "terminal")
      throw new Error("expected terminal");
    expect(unresolvedPlan.request.errorCode).toBe("PAYMENT_FAMILY_UNRESOLVED");
  });
});

// ── Truthful-ledger close decisions (v4 spec, Pillar C) ─────────────────────

describe("getSyncOperationCloseDecision", () => {
  const pushOp = { metadata: null, direction: "push-to-accounting" as const };
  const pullOp = { metadata: null, direction: "pull-from-accounting" as const };

  it("fails when the syncer returned no result for the entity", () => {
    const decision = getSyncOperationCloseDecision(pushOp, undefined);
    expect(decision.outcome).toBe("failed");
  });

  it("fails on an error result, preserving the failure record", () => {
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "error",
      action: "none",
      localId: "pi_1",
      error: "boom"
    });
    expect(decision).toEqual({
      outcome: "failed",
      record: { errorMessage: "boom" }
    });
  });

  it("completes a skip that carries a remoteId — the remote copy exists", () => {
    // Fast-bailout ("Already synced - local unchanged") and already-linked
    // hard-skips return the mapping's externalId; recording Completed with
    // that id is the truth.
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "skipped",
      action: "none",
      localId: "pi_1",
      remoteId: "remote-1",
      error: "Already synced - local unchanged"
    });
    expect(decision).toEqual({ outcome: "completed", externalId: "remote-1" });
  });

  it("records Skipped (not Completed) for a no-op with nothing behind it", () => {
    // The observed false-green failure mode: a shouldSync gate ("Bill must
    // be posted…") closing as Completed with no external mapping.
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "skipped",
      action: "none",
      localId: "pi_1",
      error: "Bill must be posted before syncing"
    });
    expect(decision).toEqual({
      outcome: "skipped",
      reason: "Bill must be posted before syncing"
    });
  });

  it("defaults the skip reason when the syncer supplied none", () => {
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "skipped",
      action: "none",
      localId: "pi_1"
    });
    expect(decision).toEqual({
      outcome: "skipped",
      reason: "Not eligible for sync"
    });
  });

  it("fails a push success that produced no remote id (POSTCONDITION)", () => {
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "success",
      action: "created",
      localId: "pi_1"
    });
    expect(decision.outcome).toBe("failed");
    if (decision.outcome === "failed") {
      expect(decision.record.errorCode).toBe("POSTCONDITION");
    }
  });

  it("completes a push success with its remote id", () => {
    const decision = getSyncOperationCloseDecision(pushOp, {
      status: "success",
      action: "created",
      localId: "pi_1",
      remoteId: "remote-1"
    });
    expect(decision).toEqual({ outcome: "completed", externalId: "remote-1" });
  });

  it("completes a pull success without requiring a remote id", () => {
    const decision = getSyncOperationCloseDecision(pullOp, {
      status: "success",
      action: "created",
      localId: "pay_1"
    });
    expect(decision).toEqual({ outcome: "completed" });
  });
});

// ── Outbound-sweep decisions (v4 spec, Pillar B) ────────────────────────────

describe("getSweepFloorDate", () => {
  it("looks back SWEEP_LOOKBACK_DAYS from today", () => {
    expect(SWEEP_LOOKBACK_DAYS).toBe(7);
    expect(getSweepFloorDate({ todayIso: "2026-08-11" })).toBe("2026-08-04");
  });

  it("raises the floor to syncFromDate when that is later", () => {
    expect(
      getSweepFloorDate({ todayIso: "2026-08-11", syncFromDate: "2026-08-08" })
    ).toBe("2026-08-08");
  });

  it("ignores a syncFromDate older than the lookback window", () => {
    expect(
      getSweepFloorDate({ todayIso: "2026-08-11", syncFromDate: "2026-01-01" })
    ).toBe("2026-08-04");
  });

  it("accepts a timestamp-shaped syncFromDate (date part only)", () => {
    expect(
      getSweepFloorDate({
        todayIso: "2026-08-11",
        syncFromDate: "2026-08-09T14:00:00.000Z"
      })
    ).toBe("2026-08-09");
  });
});

describe("shouldEnqueueMissingDocument", () => {
  const base = {
    hasMapping: false,
    hasLiveOperation: false,
    latestOperationStatus: null as string | null
  };

  it("enqueues a pure lost event (no mapping, no ops at all)", () => {
    expect(shouldEnqueueMissingDocument(base)).toBe(true);
  });

  it("enqueues a phantom success (latest op Completed but no mapping)", () => {
    // The observed pi_Rhnz signature: a pre-truthful-ledger Completed row
    // with nothing behind it. A real Completed push implies a mapping.
    expect(
      shouldEnqueueMissingDocument({
        ...base,
        latestOperationStatus: "Completed"
      })
    ).toBe(true);
  });

  it("leaves mapped documents alone", () => {
    expect(shouldEnqueueMissingDocument({ ...base, hasMapping: true })).toBe(
      false
    );
  });

  it("leaves documents with a live operation alone", () => {
    expect(
      shouldEnqueueMissingDocument({ ...base, hasLiveOperation: true })
    ).toBe(false);
  });

  it("never re-enqueues parked dispositions (the re-drive rules own those)", () => {
    for (const status of ["Skipped", "Warning", "Failed", "Excluded"]) {
      expect(
        shouldEnqueueMissingDocument({
          ...base,
          latestOperationStatus: status
        }),
        `latest ${status} must not re-enqueue`
      ).toBe(false);
    }
  });
});
