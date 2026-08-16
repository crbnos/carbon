/**
 * v5 golden decision matrix (spec Step A):
 * .ai/specs/2026-08-12-accounting-sync-reconciler-unification.md
 *
 * Pins the translation from the LEGACY decision sites (event-shaped
 * getJournalPostingDecision / getPaymentPushDecision, the sweep's
 * shouldEnqueueMissingDocument + re-drive conditions, the master-data
 * enqueue-always rule bounded by the cooldown) onto the state-shaped
 * computeReconcileDecision. Where the two deliberately differ, the scenario
 * says so explicitly — every difference is a documented fix, never an
 * accident:
 *
 *  FIX-1  Draft/mid-posting documents reconcile to nothing (legacy event
 *         path enqueued them, producing drain-skip churn and the F5 race).
 *  FIX-2  A parked Failed/Warning document re-enqueues only when the row
 *         actually changed after the failure (legacy event path retried on
 *         ANY touch; the sweep never did).
 *  FIX-3  Master data uses updatedAt vs lastSyncedAt instead of the 60s
 *         completed-row cooldown (no window to swallow a real change, no
 *         window to wait out for a no-op).
 *  FIX-4  A Voided payment with prior operations records nothing (v1 has no
 *         void echo — the legacy transition enqueue only produced a Skipped
 *         park).
 *
 * The journal POLICY routing itself (push vs Excluded vs Warning, metadata,
 * granularity) is shared by construction — both the legacy path and the
 * reconciler call planJournalPostingFromState — so these tests pin the
 * GATE translation (which states produce a plan at all), not the policy
 * table.
 */
import { resolvePostingSyncSettings } from "@carbon/ee/accounting";
import { describe, expect, it } from "vitest";
import {
  getJournalPostingDecision,
  shouldEnqueueMissingDocument
} from "./accounting-sync-operations";
import {
  computeReconcileDecision,
  type ReconcileContext,
  type ReconcileEntityInput
} from "./reconcile";

const settings = resolvePostingSyncSettings({
  settings: { postingSync: { enabled: true } }
});

const baseContext: ReconcileContext = {
  journalEntryPushEnabled: true,
  entityPushEnabled: true,
  providerSupportsPaymentPush: true,
  settings,
  docSync: { invoiceEnabled: true, billEnabled: true },
  inventoryAdjustmentEnabled: false,
  paymentFamily: null
};

function input(
  overrides: Partial<ReconcileEntityInput> & {
    entityType: ReconcileEntityInput["entityType"];
  }
): ReconcileEntityInput {
  return {
    entityId: "entity_1",
    snapshot: null,
    hasMappingWithExternalId: false,
    lastSyncedAt: null,
    hasLiveOperation: false,
    latestOperation: null,
    context: baseContext,
    ...overrides
  };
}

function kinds(decision: ReturnType<typeof computeReconcileDecision>) {
  return decision.actions.map((action) => action.kind);
}

// ── Journals ────────────────────────────────────────────────────────────────

describe("golden: journals", () => {
  it("posted + uncovered ⇔ legacy INSERT-born-Posted enqueue", () => {
    // Legacy gate:
    expect(
      getJournalPostingDecision({
        operation: "INSERT",
        recordId: "je_1",
        new: { status: "Posted", reversalOfId: null },
        old: null
      }).action
    ).toBe("enqueue");

    // Reconcile (Purchase Receipt is push-enabled by policy default):
    const decision = computeReconcileDecision(
      input({
        entityType: "journalEntry",
        entityId: "je_1",
        snapshot: { status: "Posted", sourceType: "Purchase Receipt" },
        journalCoverage: { normalCovered: false, reversalCovered: false }
      })
    );
    expect(kinds(decision)).toEqual(["enqueue"]);
    const action = decision.actions[0];
    if (action?.kind === "enqueue") {
      expect(action.request.entityId).toBe("je_1");
      expect(action.request.metadata).toMatchObject({
        sourceType: "Purchase Receipt"
      });
    }
  });

  it("doc-backed source type ⇔ legacy terminal Excluded", () => {
    const decision = computeReconcileDecision(
      input({
        entityType: "journalEntry",
        entityId: "je_1",
        snapshot: { status: "Posted", sourceType: "Purchase Invoice" },
        journalCoverage: { normalCovered: false, reversalCovered: false }
      })
    );
    expect(kinds(decision)).toEqual(["record-terminal"]);
    const action = decision.actions[0];
    if (action?.kind === "record-terminal") {
      expect(action.request.status).toBe("Excluded");
      expect(action.request.errorCode).toBe("DOC_BACKED");
    }
  });

  it("posted + covered ⇔ legacy same-status-UPDATE skip", () => {
    expect(
      getJournalPostingDecision({
        operation: "UPDATE",
        recordId: "je_1",
        new: { status: "Posted" },
        old: { status: "Posted" }
      }).action
    ).toBe("skip");

    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "journalEntry",
            entityId: "je_1",
            snapshot: { status: "Posted", sourceType: "Purchase Receipt" },
            journalCoverage: { normalCovered: true, reversalCovered: false }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("reversed + only reversal uncovered ⇔ legacy Reversed-transition enqueue of the :reversal id", () => {
    expect(
      getJournalPostingDecision({
        operation: "UPDATE",
        recordId: "je_1",
        new: { status: "Reversed" },
        old: { status: "Posted" }
      })
    ).toMatchObject({ action: "enqueue", entityId: "je_1:reversal" });

    const decision = computeReconcileDecision(
      input({
        entityType: "journalEntry",
        entityId: "je_1",
        snapshot: { status: "Reversed", sourceType: "Purchase Receipt" },
        journalCoverage: { normalCovered: true, reversalCovered: false }
      })
    );
    expect(kinds(decision)).toEqual(["enqueue"]);
    const action = decision.actions[0];
    if (action?.kind === "enqueue") {
      expect(action.request.entityId).toBe("je_1:reversal");
      expect(action.request.metadata).toMatchObject({ reversal: true });
    }
  });

  it("reversed + fully uncovered produces BOTH dispositions (sweep-heal semantics)", () => {
    const decision = computeReconcileDecision(
      input({
        entityType: "journalEntry",
        entityId: "je_1",
        snapshot: { status: "Reversed", sourceType: "Purchase Receipt" },
        journalCoverage: { normalCovered: false, reversalCovered: false }
      })
    );
    expect(kinds(decision)).toEqual(["enqueue", "enqueue"]);
  });

  it("reversal entry row ⇔ legacy reversalOfId-INSERT skip", () => {
    expect(
      getJournalPostingDecision({
        operation: "INSERT",
        recordId: "je_2",
        new: { status: "Posted", reversalOfId: "je_1" },
        old: null
      }).action
    ).toBe("skip");

    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "journalEntry",
            entityId: "je_2",
            snapshot: {
              status: "Posted",
              sourceType: "Purchase Receipt",
              reversalOfId: "je_1"
            }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("draft journal ⇔ legacy draft-INSERT skip", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "journalEntry",
            entityId: "je_1",
            snapshot: { status: "Draft", sourceType: "Purchase Receipt" }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("posting sync disabled ⇔ legacy handler gate skip", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "journalEntry",
            entityId: "je_1",
            snapshot: { status: "Posted", sourceType: "Purchase Receipt" },
            journalCoverage: { normalCovered: false, reversalCovered: false },
            context: { ...baseContext, journalEntryPushEnabled: false }
          })
        )
      )
    ).toEqual(["nothing"]);
  });
});

// ── Documents ───────────────────────────────────────────────────────────────

describe("golden: documents", () => {
  const openBill = { status: "Open", updatedAt: "2026-08-12T01:00:00Z" };

  it("posted + lost event (no ops, no mapping) ⇔ sweep diff enqueue", () => {
    expect(
      shouldEnqueueMissingDocument({
        hasMapping: false,
        hasLiveOperation: false,
        latestOperationStatus: null
      })
    ).toBe(true);

    expect(
      kinds(
        computeReconcileDecision(
          input({ entityType: "bill", snapshot: openBill })
        )
      )
    ).toEqual(["enqueue"]);
  });

  it("phantom success (latest Completed, no mapping) ⇔ sweep diff enqueue", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: openBill,
            latestOperation: {
              id: "op_1",
              status: "Completed",
              errorCode: null,
              attemptCount: 1,
              createdAt: "2026-08-12T00:00:00Z"
            }
          })
        )
      )
    ).toEqual(["enqueue"]);
  });

  it("mapped ⇔ sweep diff nothing", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: openBill,
            hasMappingWithExternalId: true
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("live operation ⇔ absorbed", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: openBill,
            hasLiveOperation: true
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("Warning UNMAPPED_ACCOUNTS + backing journal now posted ⇔ sweep re-drive", () => {
    const decision = computeReconcileDecision(
      input({
        entityType: "bill",
        snapshot: openBill,
        hasPostedBackingJournal: true,
        latestOperation: {
          id: "op_1",
          status: "Warning",
          errorCode: "UNMAPPED_ACCOUNTS",
          attemptCount: 2,
          createdAt: "2026-08-12T00:00:00Z"
        }
      })
    );
    expect(decision.actions).toEqual([
      { kind: "re-drive", operationId: "op_1" }
    ]);
  });

  it("re-drive respects the attempt cap and the missing-journal condition", () => {
    const parked = {
      id: "op_1",
      status: "Warning",
      errorCode: "UNMAPPED_ACCOUNTS",
      attemptCount: 5,
      createdAt: "2026-08-12T00:00:00Z"
    };
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: { status: "Open", updatedAt: "2026-08-11T00:00:00Z" },
            hasPostedBackingJournal: true,
            latestOperation: parked
          })
        )
      )
    ).toEqual(["nothing"]);
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: { status: "Open", updatedAt: "2026-08-11T00:00:00Z" },
            hasPostedBackingJournal: false,
            latestOperation: { ...parked, attemptCount: 1 }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("FIX-1: draft and mid-posting documents reconcile to nothing", () => {
    for (const status of ["Draft", "Pending"]) {
      expect(
        kinds(
          computeReconcileDecision(
            input({ entityType: "bill", snapshot: { status } })
          )
        )
      ).toEqual(["nothing"]);
    }
  });

  it("FIX-2: a parked Failed document re-enqueues only when edited after the failure", () => {
    const failed = {
      id: "op_1",
      status: "Failed",
      errorCode: null,
      attemptCount: 1,
      createdAt: "2026-08-12T00:00:00Z"
    };
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: { status: "Open", updatedAt: "2026-08-12T01:00:00Z" },
            latestOperation: failed
          })
        )
      )
    ).toEqual(["enqueue"]);
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "bill",
            snapshot: { status: "Open", updatedAt: "2026-08-11T00:00:00Z" },
            latestOperation: failed
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("push disabled ⇔ config-gate nothing", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "invoice",
            snapshot: { status: "Submitted" },
            context: { ...baseContext, entityPushEnabled: false }
          })
        )
      )
    ).toEqual(["nothing"]);
  });
});

// ── Payments ────────────────────────────────────────────────────────────────

describe("golden: payments", () => {
  it("posted + no ops ⇔ legacy Posted-transition enqueue / sweep no-op-rows rule", () => {
    // Legacy oracle (getPaymentPushDecision, deleted with v5): a transition
    // to Posted enqueued the payment row id — state-shaped, that is a
    // Posted payment with no recorded push operation.
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            entityId: "pay_1",
            snapshot: { status: "Posted" }
          })
        )
      )
    ).toEqual(["enqueue"]);
  });

  it("posted with a recorded op ⇔ covered", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            snapshot: { status: "Posted" },
            latestOperation: {
              id: "op_1",
              status: "Skipped",
              errorCode: null,
              attemptCount: 1,
              createdAt: "2026-08-12T00:00:00Z"
            }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("draft ⇔ legacy draft-INSERT skip", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({ entityType: "payment", snapshot: { status: "Draft" } })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("provider without payment push ⇔ nothing", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            snapshot: { status: "Posted" },
            context: { ...baseContext, providerSupportsPaymentPush: false }
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("re-drives a payment parked UNSYNCED_DOCUMENT once its settled document is mapped", () => {
    // The dependency-chain heal: invoice fails -> payment parks -> invoice
    // syncs -> the payment must follow without a human retry (mirror of
    // the bill UNMAPPED_ACCOUNTS re-drive).
    const parked = {
      id: "op_1",
      status: "Warning",
      errorCode: "UNSYNCED_DOCUMENT",
      attemptCount: 3,
      createdAt: "2026-08-12T00:00:00Z"
    };
    expect(
      computeReconcileDecision(
        input({
          entityType: "payment",
          snapshot: { status: "Posted" },
          latestOperation: parked,
          settledDocumentMapped: true
        })
      ).actions
    ).toEqual([{ kind: "re-drive", operationId: "op_1" }]);

    // Still unmapped -> stays parked; attempt cap respected
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            snapshot: { status: "Posted" },
            latestOperation: parked,
            settledDocumentMapped: false
          })
        )
      )
    ).toEqual(["nothing"]);
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            snapshot: { status: "Posted" },
            latestOperation: { ...parked, attemptCount: 5 },
            settledDocumentMapped: true
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("FIX-4: a Voided payment with prior ops records nothing (no void echo in v1)", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "payment",
            snapshot: { status: "Voided" },
            latestOperation: {
              id: "op_1",
              status: "Completed",
              errorCode: null,
              attemptCount: 1,
              createdAt: "2026-08-12T00:00:00Z"
            }
          })
        )
      )
    ).toEqual(["nothing"]);
  });
});

// ── Master data ─────────────────────────────────────────────────────────────

describe("golden: master data", () => {
  it("no mapping ⇔ legacy enqueue-on-any-write", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "customer",
            snapshot: { updatedAt: "2026-08-12T01:00:00Z" }
          })
        )
      )
    ).toEqual(["enqueue"]);
  });

  it("FIX-3: unchanged since last sync ⇔ nothing (replaces the 60s cooldown)", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "customer",
            snapshot: { updatedAt: "2026-08-12T00:00:00Z" },
            hasMappingWithExternalId: true,
            lastSyncedAt: "2026-08-12T00:30:00Z"
          })
        )
      )
    ).toEqual(["nothing"]);
  });

  it("FIX-3: changed after last sync ⇔ enqueue immediately (no cooldown window to swallow it)", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({
            entityType: "customer",
            snapshot: { updatedAt: "2026-08-12T01:00:00Z" },
            hasMappingWithExternalId: true,
            lastSyncedAt: "2026-08-12T00:30:00Z"
          })
        )
      )
    ).toEqual(["enqueue"]);
  });

  it("deleted row ⇔ legacy DELETE skip", () => {
    expect(
      kinds(
        computeReconcileDecision(
          input({ entityType: "customer", snapshot: null })
        )
      )
    ).toEqual(["nothing"]);
  });
});
