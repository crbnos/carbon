/**
 * v5 reconciler decision core (spec:
 * .ai/specs/2026-08-12-accounting-sync-reconciler-unification.md, D1).
 *
 * ONE pure, state-shaped answer to "what should happen for this entity right
 * now?" — subsuming the decision logic that previously lived in five places
 * (the event path's per-table branches, the cooldown/transition routing, and
 * the sweep's document/payment diffs and re-drive rules). The event handler,
 * the outbound sweep, and any future caller are just callers: they load
 * state, ask, and apply.
 *
 * Import-light on purpose (no Inngest, no @carbon/auth): the golden decision
 * matrix (reconcile-golden.test.ts) exercises this exhaustively without
 * booting anything.
 *
 * Level-triggered semantics: the decision never looks at what CHANGED (no
 * event deltas, no old/new rows) — only at what IS. Idempotence follows: the
 * same state always produces the same decision, and a decision whose work is
 * already recorded produces "nothing". That is what makes lost events, burst
 * duplicates, and cooldown races unrepresentable rather than specially
 * handled.
 */
import type { PostingSyncSettings } from "@carbon/ee/accounting";
import {
  MAX_REDRIVE_ATTEMPTS,
  planJournalPostingFromState,
  SWEPT_BILL_STATUSES,
  SWEPT_INVOICE_STATUSES,
  SWEPT_PAYMENT_STATUSES,
  type SyncOperationRequest,
  shouldEnqueueMissingDocument,
  type TerminalSyncOperationRequest
} from "./accounting-sync-operations";

/** Entity types the outbound reconciler covers. */
export type ReconcileEntityType =
  | "journalEntry"
  | "bill"
  | "invoice"
  | "payment"
  | "customer"
  | "vendor"
  | "item"
  | "purchaseOrder"
  | "salesOrder";

export type ReconcileRef = {
  entityType: ReconcileEntityType;
  entityId: string;
};

/** The newest ledger operation for the entity's push tuple. */
export type ReconcileLatestOperation = {
  id: string;
  status: string;
  errorCode: string | null;
  attemptCount: number;
  createdAt: string;
};

export type ReconcileEntityInput = {
  entityType: ReconcileEntityType;
  entityId: string;
  /**
   * Current row state, per type:
   * - journalEntry: { status, sourceType, reversalOfId }
   * - bill/invoice/payment: { status, updatedAt? }
   * - master data: { updatedAt? }
   * Null = the row does not exist (deleted; DELETE sync is unimplemented).
   */
  snapshot: {
    status?: string | null;
    sourceType?: string | null;
    reversalOfId?: string | null;
    updatedAt?: string | null;
  } | null;
  /** externalIntegrationMapping state for the entity (push identity). */
  hasMappingWithExternalId: boolean;
  lastSyncedAt: string | null;
  /** A Pending/In Flight push op exists for the tuple. */
  hasLiveOperation: boolean;
  /** Newest push op for the tuple (by createdAt), live or terminal. */
  latestOperation: ReconcileLatestOperation | null;
  /**
   * journalEntry only: whether ANY op row exists for the plain id and for
   * the `${id}:reversal` id (spec I1 coverage — one disposition each).
   */
  journalCoverage?: { normalCovered: boolean; reversalCovered: boolean };
  /**
   * bill only: a posted "Purchase Invoice" journal exists for this bill —
   * the input the account-costed replay needs (the re-drive condition).
   */
  hasPostedBackingJournal?: boolean;
  /**
   * payment only: the document the parked payment settles
   * (latest op's metadata.targetDocumentId) NOW has a provider mapping —
   * the UNSYNCED_DOCUMENT re-drive condition.
   */
  settledDocumentMapped?: boolean;
  context: ReconcileContext;
};

export type ReconcileContext = {
  /** journalEntry posting enabled for this integration (always-on when an
   *  integration is connected; resolved by isJournalEntryPostingEnabled). */
  journalEntryPushEnabled: boolean;
  /** THIS entity type's resolved config: enabled and not pull-only. */
  entityPushEnabled: boolean;
  /** Rillet true — the only provider with outbound payment push. */
  providerSupportsPaymentPush: boolean;
  /** Inputs the journal policy core needs (planJournalPostingFromState). */
  settings: PostingSyncSettings;
  docSync: { invoiceEnabled: boolean; billEnabled: boolean };
  inventoryAdjustmentEnabled: boolean;
  /** Resolved by the executor only for Payment-source journals when the
   * AR/AP family modes diverge (otherwise the side cannot matter). */
  paymentFamily: "ar" | "ap" | null;
};

export type ReconcileAction =
  | { kind: "enqueue"; request: SyncOperationRequest }
  | { kind: "record-terminal"; request: TerminalSyncOperationRequest }
  | { kind: "re-drive"; operationId: string }
  | { kind: "nothing"; reason: string };

export type ReconcileDecision = { actions: ReconcileAction[] };

const nothing = (reason: string): ReconcileDecision => ({
  actions: [{ kind: "nothing", reason }]
});

const MASTER_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "customer",
  "vendor",
  "item",
  "purchaseOrder",
  "salesOrder"
]);

export function computeReconcileDecision(
  input: ReconcileEntityInput
): ReconcileDecision {
  if (!input.snapshot) {
    return nothing("entity not found (deleted rows are not synced)");
  }

  switch (input.entityType) {
    case "journalEntry":
      return reconcileJournal(input);
    case "bill":
    case "invoice":
      return reconcileDocument(input);
    case "payment":
      return reconcilePayment(input);
    default:
      if (MASTER_ENTITY_TYPES.has(input.entityType)) {
        return reconcileMasterData(input);
      }
      return nothing(`entity type '${input.entityType}' is not reconciled`);
  }
}

/**
 * Journals (spec I1): every Posted/Reversed journal carries exactly one
 * recorded disposition per push identity (the plain id, and `:reversal` for
 * Reversed journals). Missing dispositions route through the SAME policy
 * core the event path and backfill use (planJournalPostingFromState) — push
 * ops enqueue, policy exclusions record terminally.
 *
 * A journal row that IS a reversal entry (reversalOfId set) is never its own
 * push identity — the original journal's `:reversal` disposition carries it.
 */
function reconcileJournal(input: ReconcileEntityInput): ReconcileDecision {
  const snapshot = input.snapshot;
  if (!snapshot) return nothing("entity not found");

  if (snapshot.reversalOfId != null) {
    return nothing(
      "reversal entry — represented by the original journal's :reversal disposition"
    );
  }
  if (snapshot.status !== "Posted" && snapshot.status !== "Reversed") {
    return nothing(
      `journal status '${snapshot.status ?? "unknown"}' is not posted`
    );
  }
  if (!input.context.journalEntryPushEnabled) {
    return nothing("posting sync (journalEntry) is disabled");
  }

  const coverage = input.journalCoverage ?? {
    normalCovered: false,
    reversalCovered: false
  };

  const actions: ReconcileAction[] = [];

  const plan = (reversal: boolean): void => {
    const planned = planJournalPostingFromState({
      journalId: input.entityId,
      sourceType: snapshot.sourceType ?? null,
      reversal,
      settings: input.context.settings,
      docSync: input.context.docSync,
      paymentFamily: input.context.paymentFamily,
      inventoryAdjustmentEntitySyncEnabled:
        input.context.inventoryAdjustmentEnabled
    });
    if (planned.action === "push") {
      actions.push({ kind: "enqueue", request: planned.request });
    } else if (planned.action === "terminal") {
      actions.push({ kind: "record-terminal", request: planned.request });
    }
  };

  if (!coverage.normalCovered) plan(false);
  if (snapshot.status === "Reversed" && !coverage.reversalCovered) plan(true);

  if (actions.length === 0) {
    return nothing("journal disposition already recorded");
  }
  return { actions };
}

/**
 * Documents (bills, invoices). Posted-set statuses only — the transient
 * mid-posting "Pending" is deliberately not reconciled (the posting edge
 * function's own status flip re-raises the hint seconds later, after the
 * posting journal exists; this removes the F5 race at the source instead of
 * parking a premature Warning).
 *
 * Order of rules:
 * 1. Re-drive: a bill parked Warning UNMAPPED_ACCOUNTS whose posted
 *    "Purchase Invoice" journal NOW exists flips back to Pending (capped).
 * 2. Missing remotely: shouldEnqueueMissingDocument (no mapping + no live op
 *    + latest null/Completed — the lost-event and phantom-success classes).
 * 3. Changed since a Failed/Warning attempt: the document was edited after
 *    the failure recorded — a genuinely new attempt is warranted (fix-the-
 *    data-and-save retries without waiting for a human or the re-drive).
 * 4. Otherwise nothing — parked dispositions belong to humans/policy.
 */
function reconcileDocument(input: ReconcileEntityInput): ReconcileDecision {
  const snapshot = input.snapshot;
  if (!snapshot) return nothing("entity not found");

  if (!input.context.entityPushEnabled) {
    return nothing(`${input.entityType} push is disabled in the sync config`);
  }

  const postedStatuses: readonly string[] =
    input.entityType === "bill" ? SWEPT_BILL_STATUSES : SWEPT_INVOICE_STATUSES;
  if (!snapshot.status || !postedStatuses.includes(snapshot.status)) {
    return nothing(
      `${input.entityType} status '${snapshot.status ?? "unknown"}' is not posted`
    );
  }

  const latest = input.latestOperation;

  if (
    input.entityType === "bill" &&
    !input.hasLiveOperation &&
    latest?.status === "Warning" &&
    latest.errorCode === "UNMAPPED_ACCOUNTS" &&
    input.hasPostedBackingJournal === true &&
    latest.attemptCount < MAX_REDRIVE_ATTEMPTS
  ) {
    return { actions: [{ kind: "re-drive", operationId: latest.id }] };
  }

  if (
    shouldEnqueueMissingDocument({
      hasMapping: input.hasMappingWithExternalId,
      hasLiveOperation: input.hasLiveOperation,
      latestOperationStatus: latest?.status ?? null
    })
  ) {
    return {
      actions: [
        {
          kind: "enqueue",
          request: {
            entityType: input.entityType,
            entityId: input.entityId,
            direction: "push-to-accounting"
          }
        }
      ]
    };
  }

  if (
    !input.hasLiveOperation &&
    latest !== null &&
    (latest?.status === "Failed" || latest?.status === "Warning") &&
    snapshot.updatedAt != null &&
    snapshot.updatedAt > latest.createdAt
  ) {
    return {
      actions: [
        {
          kind: "enqueue",
          request: {
            entityType: input.entityType,
            entityId: input.entityId,
            direction: "push-to-accounting"
          }
        }
      ]
    };
  }

  return nothing(
    input.hasMappingWithExternalId
      ? "document already represented remotely"
      : "document disposition is parked (human retry or re-drive owns it)"
  );
}

/**
 * Payments (Phase G — Rillet only). Strictest rule: only a Posted/Voided
 * payment with NO push operation at all enqueues (payment mapping ids are
 * composite, so a mapping-based phantom check does not apply; ineligible
 * payments park as Skipped on first drain and leave the set). A Voided
 * payment that already has operations records nothing — v1 has no void
 * echo (the syncer parks voids as Skipped by design).
 */
function reconcilePayment(input: ReconcileEntityInput): ReconcileDecision {
  const snapshot = input.snapshot;
  if (!snapshot) return nothing("entity not found");

  if (!input.context.providerSupportsPaymentPush) {
    return nothing("provider has no outbound payment push");
  }
  const posted: readonly string[] = SWEPT_PAYMENT_STATUSES;
  if (!snapshot.status || !posted.includes(snapshot.status)) {
    return nothing(
      `payment status '${snapshot.status ?? "unknown"}' is not posted`
    );
  }

  // Re-drive (mirror of the bill UNMAPPED_ACCOUNTS rule): a payment parked
  // because its settled document had not synced flips back to Pending once
  // that document has a provider mapping — the fix-arrives-later path the
  // dependency chain creates (invoice fails → payment parks → invoice
  // heals → payment must follow without a human).
  const latest = input.latestOperation;
  if (
    !input.hasLiveOperation &&
    latest?.status === "Warning" &&
    latest.errorCode === "UNSYNCED_DOCUMENT" &&
    input.settledDocumentMapped === true &&
    latest.attemptCount < MAX_REDRIVE_ATTEMPTS
  ) {
    return { actions: [{ kind: "re-drive", operationId: latest.id }] };
  }

  if (input.hasLiveOperation || input.latestOperation !== null) {
    return nothing("payment already has a recorded push operation");
  }

  return {
    actions: [
      {
        kind: "enqueue",
        request: {
          entityType: "payment",
          entityId: input.entityId,
          direction: "push-to-accounting"
        }
      }
    ]
  };
}

/**
 * Master data (customer/vendor/item/PO/SO). State-shaped change detection:
 * enqueue when nothing exists remotely, or when the row changed since the
 * last successful sync (updatedAt > mapping.lastSyncedAt). This REPLACES
 * the 60s completed-row cooldown with something strictly better: an
 * unchanged just-synced entity reconciles to nothing (no window to expire),
 * and a changed one enqueues immediately (no window to swallow it). The
 * drain's fast-bailout remains the backstop for false positives.
 */
function reconcileMasterData(input: ReconcileEntityInput): ReconcileDecision {
  const snapshot = input.snapshot;
  if (!snapshot) return nothing("entity not found");

  if (!input.context.entityPushEnabled) {
    return nothing(`${input.entityType} push is disabled in the sync config`);
  }
  if (input.hasLiveOperation) {
    return nothing("a live operation already covers this entity");
  }
  if (
    input.hasMappingWithExternalId &&
    input.lastSyncedAt != null &&
    snapshot.updatedAt != null &&
    snapshot.updatedAt <= input.lastSyncedAt
  ) {
    return nothing("unchanged since the last successful sync");
  }

  return {
    actions: [
      {
        kind: "enqueue",
        request: {
          entityType: input.entityType,
          entityId: input.entityId,
          direction: "push-to-accounting"
        }
      }
    ]
  };
}
