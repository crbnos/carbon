/**
 * Shared machinery for routing Inngest accounting-sync entry points through
 * the "accountingSyncOperation" ledger.
 *
 * Every entry point (event sync, webhook/scheduled sync, backfill) follows
 * the same two phases:
 *
 * 1. Enqueue — one ledger row per (entityType, entityId, direction) via
 *    enqueueSyncOperation. Re-triggers are absorbed into the live
 *    (Pending/In Flight) row, and event/webhook triggers respect the 60s
 *    completed-row cooldown enforced inside the operations service.
 * 2. Drain — claimPendingOperations moves Pending rows (plus In Flight rows
 *    abandoned for more than 10 minutes) to In Flight, the same entity
 *    syncers that ran before the ledger existed perform the work, and every
 *    claimed row is closed out with completeOperation / failOperation.
 *
 * Because enqueue absorbs duplicates and claim/complete are idempotent, an
 * Inngest retry that re-runs an enqueue or drain step cannot duplicate work.
 *
 * Posting sync (journalEntry) rides the same machinery with two twists:
 * journal events enqueue on an INSERT born Posted (the post-* edge functions
 * insert journals already Posted; reversal inserts skip via reversalOfId) or
 * on a status TRANSITION to Posted/Reversed (getJournalPostingDecision) with
 * trigger "posting", and companies whose posting-sync settings resolve to
 * consolidation "daily" have their journalEntry operations held Pending at
 * claim time for the daily-consolidation cron instead of being pushed
 * individually.
 */
import type { Database } from "@carbon/database";
import {
  type AccountingEntityType,
  type AccountingProvider,
  type BatchSyncResult,
  claimPendingOperations,
  completeOperation,
  enqueueSyncOperation,
  failOperation,
  getJournalEntrySyncEntityId,
  getJournalPostingPolicyDecision,
  insertTerminalSyncOperation,
  isJournalEntrySyncFailure,
  netJournalLinesPerAccount,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  RatelimitError,
  resolvePostingSyncSettings,
  resolveSyncConfig,
  SYNC_OPERATION_STALE_IN_FLIGHT_MS,
  type SyncContext,
  SyncFactory,
  type SyncOperation,
  type SyncOperationDirection,
  type SyncOperationTrigger,
  type SyncResult,
  skipOperation
} from "@carbon/ee/accounting";
import { groupBy } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upper bound on claim iterations per drain so a single Inngest step cannot
 * spin forever on a queue that keeps refilling (25 iterations × the claim
 * batch of 20 = 500 operations).
 */
const MAX_DRAIN_ITERATIONS = 25;

/**
 * An operation claimed more times than this parks as Failed
 * (ATTEMPTS_EXHAUSTED) instead of running again — the backstop for
 * crash-looping ops that cycle In Flight → stale → re-claim forever
 * (claiming increments attemptCount). A human retry from Sync Activity
 * resets the loop deliberately.
 */
export const MAX_SYNC_OPERATION_ATTEMPTS = 10;

/**
 * The sync jobs run with a service-role client, but ledger rows need a
 * non-null createdBy (FK to "user"). None of the sync payloads carry a
 * userId, so operations are attributed to whoever last configured the
 * integration, falling back to the seeded "system" user.
 */
export function getSyncOperationActor(integration: {
  updatedBy: string | null;
}): string {
  return integration.updatedBy ?? "system";
}

/**
 * Idempotency key for one requested sync of one entity in one direction.
 *
 * The ledger has a total unique index on (companyId, integration,
 * idempotencyKey), so the scope must identify the triggering occurrence: the
 * Inngest event id (stable across retries of a run) for live event/webhook
 * syncs, or the backfill run id for backfill runs. Retries of the same
 * delivery are absorbed by the key; later deliveries get a new scope and are
 * deduped by live-row absorption and the completed-row cooldown instead.
 */
export function getSyncOperationIdempotencyKey(args: {
  entityType: string;
  entityId: string;
  direction: SyncOperationDirection;
  scope: string;
}): string {
  return `${args.entityType}:${args.entityId}:${args.direction}:${args.scope}`;
}

export type SyncOperationRequest = {
  entityType: string;
  entityId: string;
  direction: SyncOperationDirection;
  /** Stored on the ledger row (e.g. `{ reversal: true }` for journal reversal pushes). */
  metadata?: Record<string, unknown>;
};

// /********************************************************\
// *        Journal posting decisions (events/sync)         *
// \********************************************************/

/**
 * The slice of the event-system envelope the posting decision needs. The
 * discriminated EventSystemEvent union is assignable: UPDATE events carry
 * the full old AND new rows (`row_to_json` in dispatch_event_batch), which
 * is what makes status-transition detection possible at all.
 */
export type JournalPostingEventInput = {
  operation: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
  recordId: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export type JournalPostingDecision =
  | { action: "enqueue"; entityId: string; reversal: boolean }
  | { action: "skip"; reason: string };

/**
 * Decide whether a `journal` table event is a posting event worth a ledger
 * operation. Two paths enqueue (spec Phase B §2, amended 2026-07-09):
 *
 * - INSERT born `status='Posted'` with no `reversalOfId` — Carbon's `post-*`
 *   edge functions insert journals already Posted (they are never UPDATEd
 *   from Draft), so INSERT is the posting event on the main path. Reversal
 *   inserts (`reversalOfId` set, see `reverseJournalEntry`) skip: they are
 *   represented by the original journal's Reversed transition below.
 * - UPDATE whose status MOVED to 'Posted' (Draft→Posted flows) or 'Reversed'
 *   (reversal push, suffixed entity id). An UPDATE that touches unrelated
 *   columns while status stays 'Posted' must not re-push.
 */
export function getJournalPostingDecision(
  event: JournalPostingEventInput
): JournalPostingDecision {
  if (event.operation === "INSERT") {
    const insertedStatus =
      typeof event.new?.status === "string" ? event.new.status : null;
    if (insertedStatus !== "Posted") {
      return {
        action: "skip",
        reason: `Journal INSERT with status '${insertedStatus ?? "unknown"}' is not a posting event (only journals born Posted enqueue on INSERT)`
      };
    }
    if (event.new?.reversalOfId != null) {
      return {
        action: "skip",
        reason:
          "Journal INSERT is a reversal entry (reversalOfId set); the original journal's Reversed transition carries the reversal push"
      };
    }
    return {
      action: "enqueue",
      entityId: getJournalEntrySyncEntityId(event.recordId, false),
      reversal: false
    };
  }

  if (event.operation !== "UPDATE") {
    return {
      action: "skip",
      reason: `Journal ${event.operation} is not a posting event (journals enqueue on INSERT born Posted or when an UPDATE moves status to Posted or Reversed)`
    };
  }

  const newStatus =
    typeof event.new?.status === "string" ? event.new.status : null;
  const oldStatus =
    typeof event.old?.status === "string" ? event.old.status : null;

  if (!newStatus || !oldStatus) {
    return {
      action: "skip",
      reason:
        "Journal UPDATE event is missing the old or new status; cannot detect a posting transition"
    };
  }

  if (newStatus === oldStatus) {
    return {
      action: "skip",
      reason: `Journal status did not change (still '${newStatus}'); not a posting transition`
    };
  }

  if (newStatus === "Posted") {
    return {
      action: "enqueue",
      entityId: getJournalEntrySyncEntityId(event.recordId, false),
      reversal: false
    };
  }

  if (newStatus === "Reversed") {
    return {
      action: "enqueue",
      entityId: getJournalEntrySyncEntityId(event.recordId, true),
      reversal: true
    };
  }

  return {
    action: "skip",
    reason: `Journal status transitioned to '${newStatus}', which is not a posting status (only Posted and Reversed enqueue)`
  };
}

/**
 * Journal posting is ALWAYS-ON: enabled in DEFAULT_SYNC_CONFIG and forced on
 * by every provider's build*SyncConfig, so this resolves true for any
 * connected accounting integration. Kept as a function (not a constant) so a
 * future provider that genuinely can't take journals has a seam to say so.
 */
export function isJournalEntryPostingEnabled(
  integrationMetadata: unknown
): boolean {
  return resolveSyncConfig(integrationMetadata).entities.journalEntry.enabled;
}

/**
 * Resolve which AR/AP side a Payment journal's lines touch, from the
 * company's control accounts (accountDefault.receivablesAccount /
 * payablesAccount). Deterministic per build-payment-journal (a payment
 * journal books against exactly one control side); returns null when
 * neither or both sides appear — the policy decision parks that as
 * PAYMENT_FAMILY_UNRESOLVED when the family modes diverge.
 */
export async function resolvePaymentJournalFamily(
  client: SupabaseClient<Database>,
  args: { companyId: string; journalId: string }
): Promise<"ar" | "ap" | null> {
  const defaults = await client
    .from("accountDefault")
    .select("receivablesAccount, payablesAccount")
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (defaults.error || !defaults.data) return null;

  const lines = await client
    .from("journalLine")
    .select("accountId")
    .eq("companyId", args.companyId)
    .eq("journalId", args.journalId);

  if (lines.error || !lines.data) return null;

  const accountIds = new Set(
    lines.data
      .map((line) => line.accountId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const touchesReceivables = accountIds.has(defaults.data.receivablesAccount);
  const touchesPayables = accountIds.has(defaults.data.payablesAccount);

  if (touchesReceivables && !touchesPayables) return "ar";
  if (touchesPayables && !touchesReceivables) return "ap";
  return null;
}

export type TerminalSyncOperationRequest = {
  entityType: string;
  entityId: string;
  direction: SyncOperationDirection;
  status: "Excluded" | "Warning";
  errorCode: string;
  errorMessage: string;
  metadata?: Record<string, unknown>;
};

/**
 * What to do with one journal posting event after the transition check AND
 * the v3 policy decision: skip (not a posting event), enqueue a push, or
 * record a terminal disposition (Excluded/Warning) so the journal is
 * accounted for either way (spec I1).
 */
export type JournalPostingOperationPlan =
  | { action: "skip"; reason: string }
  | { action: "push"; request: SyncOperationRequest }
  | { action: "terminal"; request: TerminalSyncOperationRequest };

/**
 * Compose the event-transition check with the posting-policy decision for
 * one `journal` table event. The Payment control-account lookup runs only
 * when the source type is Payment AND the AR/AP family modes diverge
 * (otherwise the side cannot change the outcome).
 */
export async function planJournalPostingOperation(args: {
  client: SupabaseClient<Database>;
  companyId: string;
  event: JournalPostingEventInput;
  integrationMetadata: unknown;
}): Promise<JournalPostingOperationPlan> {
  const transition = getJournalPostingDecision(args.event);
  if (transition.action === "skip") {
    return { action: "skip", reason: transition.reason };
  }

  const settings = resolvePostingSyncSettings(args.integrationMetadata);
  const syncConfig = resolveSyncConfig(args.integrationMetadata);

  const sourceType =
    typeof args.event.new?.sourceType === "string"
      ? args.event.new.sourceType
      : null;

  const paymentFamily =
    sourceType === "Payment" && settings.families.ar !== settings.families.ap
      ? await resolvePaymentJournalFamily(args.client, {
          companyId: args.companyId,
          journalId: args.event.recordId
        })
      : null;

  return planJournalPostingFromState({
    journalId: args.event.recordId,
    sourceType,
    reversal: transition.reversal,
    settings,
    docSync: {
      invoiceEnabled: syncConfig.entities.invoice.enabled,
      billEnabled: syncConfig.entities.bill.enabled
    },
    paymentFamily,
    inventoryAdjustmentEntitySyncEnabled:
      syncConfig.entities.inventoryAdjustment.enabled
  });
}

/**
 * The STATE-shaped core of the journal posting plan (v5 reconciler): given a
 * posted journal's identity and the resolved settings — no event envelope —
 * route through the v3 policy decision and build the push/terminal request.
 * `planJournalPostingOperation` (event path, backfill) and the reconcile
 * decision core both delegate here, so the policy routing can never diverge
 * between callers. Pure: `paymentFamily` is resolved by the caller when the
 * source type is Payment and the AR/AP family modes diverge.
 */
export function planJournalPostingFromState(args: {
  journalId: string;
  sourceType: string | null;
  reversal: boolean;
  settings: PostingSyncSettings;
  docSync: { invoiceEnabled: boolean; billEnabled: boolean };
  paymentFamily: "ar" | "ap" | null;
  inventoryAdjustmentEntitySyncEnabled: boolean;
}): JournalPostingOperationPlan {
  const entityId = getJournalEntrySyncEntityId(args.journalId, args.reversal);

  const decision = getJournalPostingPolicyDecision({
    sourceType: args.sourceType,
    settings: args.settings,
    docSync: args.docSync,
    paymentFamily: args.paymentFamily,
    inventoryAdjustmentEntitySyncEnabled:
      args.inventoryAdjustmentEntitySyncEnabled
  });

  const baseMetadata = {
    ...(args.reversal ? { reversal: true } : {}),
    ...(args.sourceType ? { sourceType: args.sourceType } : {})
  };

  if (decision.kind === "push") {
    return {
      action: "push",
      request: {
        entityType: "journalEntry",
        entityId,
        direction: "push-to-accounting",
        metadata: { ...baseMetadata, granularity: decision.granularity }
      }
    };
  }

  if (decision.kind === "exclude") {
    return {
      action: "terminal",
      request: {
        entityType: "journalEntry",
        entityId,
        direction: "push-to-accounting",
        status: "Excluded",
        errorCode: decision.reason,
        errorMessage: decision.message,
        metadata: {
          ...baseMetadata,
          ...(decision.backingDocument
            ? { backingDocument: decision.backingDocument }
            : {})
        }
      }
    };
  }

  return {
    action: "terminal",
    request: {
      entityType: "journalEntry",
      entityId,
      direction: "push-to-accounting",
      status: "Warning",
      errorCode: decision.code,
      errorMessage: decision.message,
      metadata: baseMetadata
    }
  };
}

/**
 * Record terminal dispositions (Excluded/Warning at decision time), one
 * ledger row per unique request. Existing rows for a journal absorb the
 * insert (see insertTerminalSyncOperation) — re-deliveries and backfills
 * never churn duplicate terminal rows.
 */
export async function insertTerminalSyncOperations(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    integration: string;
    trigger: SyncOperationTrigger;
    createdBy: string;
    scope: string;
    requests: TerminalSyncOperationRequest[];
  }
): Promise<EnqueueOutcome[]> {
  const outcomes: EnqueueOutcome[] = [];
  const seen = new Set<string>();

  for (const request of args.requests) {
    const idempotencyKey = getSyncOperationIdempotencyKey({
      entityType: request.entityType,
      entityId: request.entityId,
      direction: request.direction,
      scope: args.scope
    });

    if (seen.has(idempotencyKey)) continue;
    seen.add(idempotencyKey);

    const { data, error } = await insertTerminalSyncOperation(client, {
      companyId: args.companyId,
      integration: args.integration,
      entityType: request.entityType,
      entityId: request.entityId,
      direction: request.direction,
      trigger: args.trigger,
      idempotencyKey,
      createdBy: args.createdBy,
      status: request.status,
      errorCode: request.errorCode,
      errorMessage: request.errorMessage,
      ...(request.metadata ? { metadata: request.metadata } : {})
    });

    if (error) {
      outcomes.push({
        entityType: request.entityType,
        entityId: request.entityId,
        direction: request.direction,
        outcome: "error",
        error
      });
    } else if (data) {
      outcomes.push({
        entityType: request.entityType,
        entityId: request.entityId,
        direction: request.direction,
        outcome: "enqueued"
      });
    } else {
      outcomes.push({
        entityType: request.entityType,
        entityId: request.entityId,
        direction: request.direction,
        outcome: "cooldown"
      });
    }
  }

  return outcomes;
}

export type EnqueueOutcome = {
  entityType: string;
  entityId: string;
  direction: SyncOperationDirection;
  /**
   * "enqueued" covers both a newly inserted row and absorption into an
   * existing one — either way an operation now covers the request.
   * "cooldown" means a Completed row for the same tuple finished inside the
   * 60s window (event/webhook triggers only).
   */
  outcome: "enqueued" | "cooldown" | "error";
  error?: string;
};

/**
 * Enqueue one ledger operation per unique request. Duplicate requests in the
 * same call (same entityType, entityId, and direction) are deduped locally.
 */
export async function enqueueSyncOperations(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    integration: string;
    trigger: SyncOperationTrigger;
    createdBy: string;
    scope: string;
    requests: SyncOperationRequest[];
  }
): Promise<EnqueueOutcome[]> {
  const outcomes: EnqueueOutcome[] = [];
  const seen = new Set<string>();

  for (const request of args.requests) {
    const idempotencyKey = getSyncOperationIdempotencyKey({
      ...request,
      scope: args.scope
    });

    if (seen.has(idempotencyKey)) continue;
    seen.add(idempotencyKey);

    const { data, error } = await enqueueSyncOperation(client, {
      companyId: args.companyId,
      integration: args.integration,
      entityType: request.entityType,
      entityId: request.entityId,
      direction: request.direction,
      trigger: args.trigger,
      idempotencyKey,
      createdBy: args.createdBy,
      ...(request.metadata ? { metadata: request.metadata } : {})
    });

    if (error) {
      outcomes.push({ ...request, outcome: "error", error });
    } else if (data) {
      outcomes.push({ ...request, outcome: "enqueued" });
    } else {
      outcomes.push({ ...request, outcome: "cooldown" });
    }
  }

  return outcomes;
}

export type DrainedGroup = {
  entityType: string;
  direction: SyncOperationDirection;
  result: BatchSyncResult;
};

export type DrainSummary = {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  groups: DrainedGroup[];
};

function toSyncErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error == null) return "Unknown sync error";
  return JSON.stringify(error);
}

export type SyncOperationFailureRecord = {
  errorCode?: string;
  errorMessage: string;
  warning?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Map a sync result's error onto the failOperation payload.
 *
 * Structured journal pre-flight failures (isJournalEntrySyncFailure on
 * SyncResult.error) keep their machine-readable errorCode, land Warning or
 * Failed per the envelope's `warning` flag, and merge the failure's
 * metadata (e.g. unmappedAccountIds) over the operation's existing
 * metadata (so enqueue-time keys like `reversal` survive). Every other
 * error keeps the flattened-string behavior.
 */
export function getSyncOperationFailureRecord(
  operation: Pick<SyncOperation, "metadata">,
  syncResult: Pick<SyncResult, "error"> | undefined
): SyncOperationFailureRecord {
  if (!syncResult) {
    return { errorMessage: "No sync result returned for entity" };
  }

  if (isJournalEntrySyncFailure(syncResult.error)) {
    const failure = syncResult.error;
    return {
      errorCode: failure.errorCode,
      errorMessage: failure.message,
      warning: failure.warning,
      ...(failure.metadata
        ? { metadata: { ...(operation.metadata ?? {}), ...failure.metadata } }
        : {})
    };
  }

  return { errorMessage: toSyncErrorMessage(syncResult.error) };
}

export type SyncOperationCloseDecision =
  | { outcome: "completed"; externalId?: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; record: SyncOperationFailureRecord };

/**
 * Decide how a claimed operation closes from its sync result — the
 * truthful-ledger rules (v4 spec, Pillar C):
 *
 * - error / missing result → Failed (structured Warnings preserved).
 * - "skipped" WITH a remoteId (fast-bailout, already-linked) → Completed
 *   stamping that externalId: the remote copy exists, so Completed is the
 *   truth even though this attempt was a no-op.
 * - "skipped" WITHOUT a remoteId (shouldSync gate, disabled entity,
 *   parked payment) → Skipped with the reason: nothing exists remotely,
 *   so Completed would be a lie — the observed false-green failure mode.
 * - push "success" WITHOUT a remoteId → Failed POSTCONDITION: a push
 *   success must produce an external id/mapping; treating the violation
 *   as failure surfaces the bug instead of recording a phantom sync.
 */
export function getSyncOperationCloseDecision(
  operation: Pick<SyncOperation, "metadata" | "direction">,
  syncResult: SyncResult | undefined
): SyncOperationCloseDecision {
  if (!syncResult || syncResult.status === "error") {
    return {
      outcome: "failed",
      record: getSyncOperationFailureRecord(operation, syncResult)
    };
  }

  if (syncResult.status === "skipped") {
    if (syncResult.remoteId) {
      return { outcome: "completed", externalId: syncResult.remoteId };
    }
    return {
      outcome: "skipped",
      reason: toSyncErrorMessage(syncResult.error ?? "Not eligible for sync")
    };
  }

  if (operation.direction === "push-to-accounting" && !syncResult.remoteId) {
    return {
      outcome: "failed",
      record: {
        errorCode: "POSTCONDITION",
        errorMessage:
          "Sync reported success without a remote id — no external mapping was recorded, so the push is treated as failed"
      }
    };
  }

  return {
    outcome: "completed",
    ...(syncResult.remoteId ? { externalId: syncResult.remoteId } : {})
  };
}

/**
 * Drain the ledger for one company + integration: claim Pending (and stale
 * In Flight) operations, run the same entity syncers the entry points used
 * to call directly, and close every claimed operation out. Claimed rows are
 * grouped by (entityType, direction) so each group is one syncer batch call,
 * exactly like the pre-ledger dispatch.
 *
 * Daily-consolidation hold: when the company's posting-sync settings
 * (resolved from `integrationMetadata`) have consolidation "daily",
 * journalEntry operations are never claimed — they stay Pending for the
 * daily-consolidation cron, which pushes one aggregated provider journal
 * per posting date. Individual-mode journal operations drain normally
 * through the JournalEntrySyncer.
 *
 * A RatelimitError propagates so the caller's retry machinery applies;
 * claimed rows stay In Flight and become re-claimable once stale. Any other
 * group-level error marks that group's operations Failed and the drain
 * continues with the next group.
 */
export async function drainSyncOperations(args: {
  client: SupabaseClient<Database>;
  database: SyncContext["database"];
  companyId: string;
  integration: string;
  provider: AccountingProvider;
  /**
   * `metadata` of the companyIntegration row (already loaded by every
   * caller via getAccountingIntegration) — required so no drain path can
   * silently push daily-consolidation journal operations individually.
   */
  integrationMetadata: unknown;
}): Promise<DrainSummary> {
  const summary: DrainSummary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    groups: []
  };

  const postingSyncSettings = resolvePostingSyncSettings(
    args.integrationMetadata
  );
  // Two hold mechanisms for the consolidation cron's work:
  // - transitional: pure-daily configs (v2 shims) hold ALL journal ops by
  //   entity type — covers legacy Pending rows with no granularity stamp;
  // - v3: otherwise hold only journal ops stamped granularity
  //   "daily-summary"; individual ones drain right here in the event path.
  const excludeEntityTypes: AccountingEntityType[] | undefined =
    postingSyncSettings.consolidation === "daily"
      ? ["journalEntry"]
      : undefined;

  for (let iteration = 0; iteration < MAX_DRAIN_ITERATIONS; iteration++) {
    const claimed = await claimPendingOperations(args.client, {
      companyId: args.companyId,
      integration: args.integration,
      ...(excludeEntityTypes
        ? { excludeEntityTypes }
        : { holdDailySummaryJournalEntries: true })
    });

    if (claimed.error) {
      throw new Error(`Failed to claim sync operations: ${claimed.error}`);
    }

    if (claimed.data.length === 0) break;

    summary.claimed += claimed.data.length;

    // Attempt-cap backstop: claiming increments attemptCount, so a
    // crash-looping op re-claims forever without this. Park it Failed —
    // visible and retryable in Sync Activity — instead of burning another
    // provider call every drain.
    const workable: SyncOperation[] = [];
    for (const operation of claimed.data) {
      if (operation.attemptCount > MAX_SYNC_OPERATION_ATTEMPTS) {
        summary.failed++;
        await failOperation(args.client, {
          id: operation.id,
          companyId: operation.companyId,
          errorCode: "ATTEMPTS_EXHAUSTED",
          errorMessage: `Sync was attempted ${operation.attemptCount} times without reaching a terminal outcome; parked as Failed — retry manually once the underlying issue is fixed`
        });
        continue;
      }
      workable.push(operation);
    }

    const groups = groupBy(
      workable,
      (operation) => `${operation.entityType}:${operation.direction}`
    );

    for (const operations of Object.values(groups)) {
      const first = operations[0];
      if (!first) continue;

      const { entityType, direction } = first;

      try {
        const syncer = SyncFactory.getSyncer({
          database: args.database,
          companyId: args.companyId,
          provider: args.provider,
          config: args.provider.getSyncConfig(
            entityType as AccountingEntityType
          ),
          entityType: entityType as AccountingEntityType
        });

        const entityIds = operations.map((operation) => operation.entityId);
        const result =
          direction === "push-to-accounting"
            ? await syncer.pushBatchToAccounting(entityIds)
            : await syncer.pullBatchFromAccounting(entityIds);

        summary.groups.push({ entityType, direction, result });

        for (const operation of operations) {
          const syncResult = result.results.find((r) =>
            direction === "push-to-accounting"
              ? r.localId === operation.entityId
              : r.remoteId === operation.entityId
          );

          const decision = getSyncOperationCloseDecision(operation, syncResult);

          if (decision.outcome === "failed") {
            summary.failed++;
            // Structured journal pre-flight failures keep their errorCode,
            // Warning/Failed flag and metadata; other errors flatten to a
            // string exactly as before
            await failOperation(args.client, {
              id: operation.id,
              companyId: operation.companyId,
              ...decision.record
            });
            continue;
          }

          if (decision.outcome === "skipped") {
            summary.skipped++;
            await skipOperation(args.client, {
              id: operation.id,
              companyId: operation.companyId,
              reason: decision.reason
            });
            continue;
          }

          summary.completed++;
          await completeOperation(args.client, {
            id: operation.id,
            companyId: operation.companyId,
            ...(decision.externalId ? { externalId: decision.externalId } : {})
          });
        }
      } catch (error) {
        if (error instanceof RatelimitError) {
          const { retryAfterSeconds } = error.rateLimitInfo;
          console.warn(
            `[RATE LIMIT] Drain hit rate limit, will retry after ${retryAfterSeconds}s`
          );
          throw error;
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        for (const operation of operations) {
          summary.failed++;
          await failOperation(args.client, {
            id: operation.id,
            companyId: operation.companyId,
            errorMessage
          });
        }
      }
    }
  }

  return summary;
}

// /********************************************************\
// *      Daily-consolidation decisions (cron, Task 12)     *
// \********************************************************/
// Pure helpers for the accounting-consolidation cron, kept in this
// import-light module (like the journal posting decisions above) so they
// are unit-testable without booting the Inngest client.

export const DAILY_CONSOLIDATION_PREFIX = "daily:";

/** "Production Event" → "production-event" (batch-key segment). */
export function getDailyConsolidationSourceTypeSlug(
  sourceType: string
): string {
  return sourceType.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Batch key for one integration + posting date (+ source type since the v3
 * per-source-type partitions). Used as the marker operation's entityId AND
 * idempotencyKey, and recorded on member operations as
 * `metadata.consolidatedInto`. The sourceType-less form is the legacy key
 * shape — kept so markers completed before the partition change still
 * dedupe their date's legacy members.
 */
export function getDailyConsolidationBatchKey(
  integration: string,
  postingDate: string,
  sourceType?: string | null
): string {
  return sourceType
    ? `${DAILY_CONSOLIDATION_PREFIX}${integration}:${getDailyConsolidationSourceTypeSlug(sourceType)}:${postingDate}`
    : `${DAILY_CONSOLIDATION_PREFIX}${integration}:${postingDate}`;
}

/**
 * True when any enabled journal-represented source type is configured for
 * daily-summary granularity — the v3 trigger for the consolidation cron
 * (alongside the transitional pure-daily `consolidation` flag).
 */
export function hasDailySummarySourceTypes(
  settings: PostingSyncSettings
): boolean {
  return Object.values(settings.sourceTypes).some(
    (config) => config.enabled && config.granularity === "daily-summary"
  );
}

/** Marker operations are recognized by their entityId prefix. */
export function isDailyConsolidationMarker(entityId: string): boolean {
  return entityId.startsWith(DAILY_CONSOLIDATION_PREFIX);
}

/** YYYY-MM-DD in UTC. */
export function getUtcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Normalize a posting date read from the database (ISO string or Date,
 * depending on driver type parsers) to YYYY-MM-DD, or null when it is
 * neither.
 */
export function toIsoDateString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }
  return null;
}

/**
 * Mirror of claimPendingOperations' candidate rule so the consolidation
 * pre-scan only plans work the claim can actually take: Pending rows, plus
 * In Flight rows abandoned longer than the stale window.
 */
export function isClaimableConsolidationOperation(
  operation: Pick<SyncOperation, "status" | "lastAttemptAt">,
  now: Date = new Date()
): boolean {
  if (operation.status === "Pending") return true;
  if (operation.status !== "In Flight") return false;
  if (!operation.lastAttemptAt) return false;

  const lastAttemptMs = new Date(operation.lastAttemptAt).getTime();
  if (Number.isNaN(lastAttemptMs)) return false;
  return now.getTime() - lastAttemptMs > SYNC_OPERATION_STALE_IN_FLIGHT_MS;
}

export type ConsolidationOperation = Pick<
  SyncOperation,
  "id" | "entityId" | "metadata"
>;

export type ConsolidationGroup<T> = {
  batchKey: string;
  postingDate: string;
  /** Source type shared by the group's members; null = legacy unstamped ops. */
  sourceType: string | null;
  operations: T[];
};

export type ConsolidationPartition<T extends ConsolidationOperation> = {
  /** Batch marker rows (entityId prefixed "daily:"). */
  markers: T[];
  /** Reversal pushes — individual syncer path, never consolidated. */
  reversals: T[];
  /**
   * Consolidation members grouped per (source type, posting date) batch key
   * (dates strictly before today). Legacy ops with no sourceType stamp
   * group under the sourceType-less legacy batch key.
   */
  byGroup: Map<string, ConsolidationGroup<T>>;
  /**
   * Pushed individually through the normal syncer path: members of a batch
   * whose marker already Completed (late backdated arrivals) and
   * v3 operations stamped granularity "individual" (they normally drain in
   * the event path; the cron just pushes any it happens to claim).
   */
  individual: T[];
  /** Dated today or later — left In Flight for a later run. */
  held: T[];
  /** Journal row not found — failed. */
  missing: T[];
};

/**
 * Split claimed journalEntry operations into their consolidation buckets.
 * Reversals are detected by enqueue metadata (`reversal: true`) with the
 * ":reversal" entityId suffix as a fallback.
 */
export function partitionConsolidationOperations<
  T extends ConsolidationOperation
>(args: {
  operations: T[];
  postingDateByJournalId: ReadonlyMap<string, string>;
  today: string;
  integration: string;
  /** Batch keys whose marker is already Completed (summary already pushed). */
  consolidatedBatchKeys: ReadonlySet<string>;
}): ConsolidationPartition<T> {
  const partition: ConsolidationPartition<T> = {
    markers: [],
    reversals: [],
    byGroup: new Map(),
    individual: [],
    held: [],
    missing: []
  };

  for (const operation of args.operations) {
    if (isDailyConsolidationMarker(operation.entityId)) {
      partition.markers.push(operation);
      continue;
    }

    const { journalId, reversal } = parseJournalEntrySyncEntityId(
      operation.entityId
    );
    if (operation.metadata?.reversal === true || reversal) {
      partition.reversals.push(operation);
      continue;
    }

    // v3: individual-granularity journal ops never consolidate
    if (operation.metadata?.granularity === "individual") {
      partition.individual.push(operation);
      continue;
    }

    const postingDate = args.postingDateByJournalId.get(journalId);
    if (!postingDate) {
      partition.missing.push(operation);
      continue;
    }

    if (postingDate >= args.today) {
      partition.held.push(operation);
      continue;
    }

    const sourceType =
      typeof operation.metadata?.sourceType === "string"
        ? operation.metadata.sourceType
        : null;
    const batchKey = getDailyConsolidationBatchKey(
      args.integration,
      postingDate,
      sourceType
    );

    if (args.consolidatedBatchKeys.has(batchKey)) {
      partition.individual.push(operation);
      continue;
    }

    const group = partition.byGroup.get(batchKey);
    if (group) {
      group.operations.push(operation);
    } else {
      partition.byGroup.set(batchKey, {
        batchKey,
        postingDate,
        sourceType,
        operations: [operation]
      });
    }
  }

  return partition;
}

// /********************************************************\
// *       Reconciliation comparisons (cron, Task 13)       *
// \********************************************************/
// Pure helpers for the accounting-reconciliation cron (same import-light
// rationale as the consolidation decisions above).

export const MAX_RECONCILIATION_DRIFT_ENTRIES = 100;

export type ReconciliationDriftEntry =
  | { type: "missing"; externalId: string; journalId: string; amount?: number }
  | {
      type: "mismatch";
      month: string;
      carbonTotal: number;
      providerTotal: number;
    };

export type ReconciliationReport = {
  runAt: string;
  drift: ReconciliationDriftEntry[];
};

/** Sum of positive (debit) line amounts, in cents. */
export function getPositiveCents(
  lines: ReadonlyArray<{ amount: number }>
): number {
  return lines.reduce((sum, line) => {
    const cents = Math.round(line.amount * 100);
    return cents > 0 ? sum + cents : sum;
  }, 0);
}

/**
 * Debit total (cents) of what a consolidated batch actually booked: member
 * lines are netted per account first (zero nets drop), mirroring
 * aggregateJournalEntriesForDate.
 */
export function getNettedPositiveCents(
  lines: ReadonlyArray<{ accountId: string | null; amount: number }>
): number {
  let sum = 0;
  for (const amount of netJournalLinesPerAccount(lines).values()) {
    const cents = Math.round(amount * 100);
    if (cents > 0) sum += cents;
  }
  return sum;
}

/**
 * Compare per-month debit totals (cents). A month drifts when the absolute
 * difference exceeds 0.01 (strictly more than one cent — a single rounding
 * cent is tolerated). Months present on either side participate; a missing
 * side counts as zero.
 */
export function compareMonthlyTotals(args: {
  carbonCentsByMonth: ReadonlyMap<string, number>;
  providerCentsByMonth: ReadonlyMap<string, number>;
}): Array<Extract<ReconciliationDriftEntry, { type: "mismatch" }>> {
  const months = new Set([
    ...args.carbonCentsByMonth.keys(),
    ...args.providerCentsByMonth.keys()
  ]);

  const drift: Array<Extract<ReconciliationDriftEntry, { type: "mismatch" }>> =
    [];

  for (const month of [...months].sort()) {
    const carbonCents = args.carbonCentsByMonth.get(month) ?? 0;
    const providerCents = args.providerCentsByMonth.get(month) ?? 0;
    if (Math.abs(carbonCents - providerCents) > 1) {
      drift.push({
        type: "mismatch",
        month,
        carbonTotal: carbonCents / 100,
        providerTotal: providerCents / 100
      });
    }
  }

  return drift;
}

/**
 * Merge `lastReconciliation` into
 * `metadata.settings.postingSync.lastReconciliation` without clobbering any
 * other key: credentials, syncConfig, sibling settings keys and the stored
 * postingSync fields (enabled, sourceTypes, ...) all survive. Drift is
 * capped at MAX_RECONCILIATION_DRIFT_ENTRIES.
 */
export function mergePostingSyncReconciliation(
  metadata: unknown,
  report: ReconciliationReport
): Record<string, unknown> {
  const base =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)
      : {};
  const settings =
    typeof base.settings === "object" && base.settings !== null
      ? (base.settings as Record<string, unknown>)
      : {};
  const postingSync =
    typeof settings.postingSync === "object" && settings.postingSync !== null
      ? (settings.postingSync as Record<string, unknown>)
      : {};

  return {
    ...base,
    settings: {
      ...settings,
      postingSync: {
        ...postingSync,
        lastReconciliation: {
          runAt: report.runAt,
          drift: report.drift.slice(0, MAX_RECONCILIATION_DRIFT_ENTRIES)
        }
      }
    }
  };
}

// /********************************************************\
// *           QBO CDC decisions (cron, Task C9)            *
// \********************************************************/
// Pure helpers for the quickbooks-cdc cron (same import-light rationale as
// the consolidation and reconciliation helpers above).

/**
 * QBO CDC entity name → Carbon accounting entity type, limited to the
 * entity types the QBO integration syncs. The CDC call is asked only about
 * these names.
 */
/**
 * Normalize any ISO 8601 string (offsets included — QBO timestamps arrive
 * like "2026-07-08T13:07:59-07:00") to UTC ISO; null when unparseable.
 */
function toUtcIsoString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type PullCursorDecision = {
  /** UTC ISO timestamp for the listChanges call's since parameter. */
  changedSince: string;
  /** True when the wanted cursor predates the provider's lookback cap. */
  clamped: boolean;
  /** Where the pre-clamp cursor came from. */
  source: "cursor" | "connectTime" | "fallback";
};

/**
 * Resolve the since cursor for one pull-sweep run:
 *
 * - Stored cursor `metadata.settings.pullCursor` (advanced by prior runs).
 * - Default: the integration row's `updatedAt` — the closest thing to
 *   connect time available (companyIntegration has no createdAt column);
 *   it is at-or-after the install, so pre-connect history is never
 *   pulled.
 * - Clamp: providers whose change feed is capped (QBO CDC reaches back 30
 *   days; `pullLookbackDays` 29 keeps a margin) have older cursors clamped
 *   and reported (`clamped`); the pre-window tail is left to two-way owner
 *   semantics / a manual backfill to recover. Providers without a cap are
 *   never clamped.
 */
export function getPullCursorDecision(args: {
  integrationMetadata: unknown;
  integrationUpdatedAt: string | null;
  maxLookbackDays?: number;
  now?: Date;
}): PullCursorDecision {
  const now = args.now ?? new Date();

  const settings =
    typeof args.integrationMetadata === "object" &&
    args.integrationMetadata !== null
      ? (args.integrationMetadata as { settings?: unknown }).settings
      : undefined;
  const storedCursor = toUtcIsoString(
    typeof settings === "object" && settings !== null
      ? (settings as Record<string, unknown>).pullCursor
      : undefined
  );
  const connectTime = toUtcIsoString(args.integrationUpdatedAt);

  const clampFloor =
    args.maxLookbackDays !== undefined
      ? new Date(
          now.getTime() - args.maxLookbackDays * 24 * 60 * 60_000
        ).toISOString()
      : null;

  const cursor = storedCursor ?? connectTime;
  if (!cursor) {
    return {
      changedSince: clampFloor ?? now.toISOString(),
      clamped: false,
      source: "fallback"
    };
  }

  const source = storedCursor ? ("cursor" as const) : ("connectTime" as const);
  // Both sides are toISOString output, so lexicographic order is
  // chronological order
  if (clampFloor && cursor < clampFloor) {
    return { changedSince: clampFloor, clamped: true, source };
  }
  return { changedSince: cursor, clamped: false, source };
}

/**
 * Cursor advance rule (Celigo: the cursor only moves over provably-covered
 * work): the max of the changedSince actually used and every remote
 * updated-at the provider returned — deleted stubs and dependency-skipped
 * changes included, because log-and-skip is their terminal handling. Never
 * a server time, which could outrun a lagging snapshot. The sweep calls
 * this only after every enqueue succeeded and the drain returned.
 */
export function getAdvancedPullCursor(args: {
  changedSince: string;
  lastUpdatedTimes: ReadonlyArray<string | null>;
}): string {
  let max = toUtcIsoString(args.changedSince) ?? args.changedSince;
  for (const value of args.lastUpdatedTimes) {
    const iso = toUtcIsoString(value);
    if (iso && iso > max) max = iso;
  }
  return max;
}

/**
 * Idempotency scope for one sweep-observed change: `pull:<updatedAt>` is
 * stable across cron retries — the cursor only advances after success, so
 * a retried run re-reads the same window and rebuilds the same keys,
 * absorbing into the existing ledger rows. Changes missing an updatedAt
 * fall back to the run's changedSince (still stable for unclamped runs;
 * live-row absorption and the completed-row cooldown cover the clamped
 * edge, where changedSince shifts with `now`).
 */
export function getPullIdempotencyScope(
  updatedAt: string | null,
  changedSince: string
): string {
  return `pull:${updatedAt ?? changedSince}`;
}

/**
 * Merge `cursor` into `metadata.settings.pullCursor` without clobbering
 * any sibling key — same raw-metadata read-modify-write contract as
 * mergePostingSyncReconciliation, but the cursor is a settings-level key,
 * NOT a postingSync one.
 */
export function mergePullCursor(
  metadata: unknown,
  cursor: string
): Record<string, unknown> {
  const base =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)
      : {};
  const settings =
    typeof base.settings === "object" && base.settings !== null
      ? (base.settings as Record<string, unknown>)
      : {};

  return {
    ...base,
    settings: {
      ...settings,
      pullCursor: cursor
    }
  };
}

// /********************************************************\
// *      Outbound-sweep decisions (cron, v4 Pillar B)      *
// \********************************************************/
// Pure helpers for the accounting-outbound-sweep cron (same import-light
// rationale as the pull-sweep cursor helpers above).

/**
 * How far back the outbound sweep diffs. Short on purpose: the sweep
 * repairs LOST EVENTS (at most as old as the outage that lost them), not
 * history — pushing a company's pre-integration past is the explicit
 * backfill's job. With a 30-minute cadence, anything inside the window
 * gets hundreds of repair chances before aging out.
 */
export const SWEEP_LOOKBACK_DAYS = 7;

/**
 * Ops parked Warning re-drive at most this many attempts (claiming
 * increments attemptCount) before a human has to act — stops a genuinely
 * broken op from churning every half hour forever.
 */
export const MAX_REDRIVE_ATTEMPTS = 5;

/**
 * Document statuses the outbound sweep treats as posted — the
 * per-provider SYNCABLE_STATUSES minus the transient "Pending"
 * (mid-posting: the post route flips Draft → Pending BEFORE the edge
 * function writes the posting journal, so diffing Pending would race the
 * same way the event path does; the document re-enters the diff as soon
 * as posting lands a terminal status).
 */
export const SWEPT_BILL_STATUSES = [
  "Open",
  "Return",
  "Debit Note Issued",
  "Partially Paid",
  "Paid",
  "Overdue"
] as const;
export const SWEPT_INVOICE_STATUSES = [
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
] as const;
export const SWEPT_PAYMENT_STATUSES = ["Posted", "Voided"] as const;

/**
 * The sweep window's lower bound: `todayIso - SWEEP_LOOKBACK_DAYS`, raised
 * to the entity's syncFromDate when that is later (never push before the
 * configured start). ISO date strings, lexicographic comparison.
 */
export function getSweepFloorDate(args: {
  todayIso: string;
  syncFromDate?: string | null;
}): string {
  const lookbackFloor = parseDate(args.todayIso)
    .subtract({ days: SWEEP_LOOKBACK_DAYS })
    .toString();
  const syncFrom = args.syncFromDate?.slice(0, 10);
  return syncFrom && syncFrom > lookbackFloor ? syncFrom : lookbackFloor;
}

/**
 * The outbound sweep's document diff rule. Enqueue iff nothing exists
 * remotely (no mapping), nothing is about to run (no live op), and
 * nothing parked it: no rows at all is a pure lost event, and a latest
 * row of Completed is a phantom success (a truthful Completed push
 * implies a mapping). A latest row of Skipped/Warning/Failed/Excluded
 * means the entity is deliberately parked — the capped re-drive rules or
 * a human own it, not the diff (re-enqueueing those every sweep would
 * churn forever).
 */
export function shouldEnqueueMissingDocument(args: {
  hasMapping: boolean;
  hasLiveOperation: boolean;
  latestOperationStatus: string | null;
}): boolean {
  if (args.hasMapping || args.hasLiveOperation) return false;
  return (
    args.latestOperationStatus === null ||
    args.latestOperationStatus === "Completed"
  );
}

// /********************************************************\
// *        Tie-out computations (cron, v4 Pillar E)        *
// \********************************************************/
// Pure helpers for the accounting-reconciliation cron's per-period ×
// per-account tie-out pass (v3 spec §5). Kept in this import-light module
// so they are unit-testable without booting the Inngest client (same
// rationale as the sweep helpers above); tests live in
// accounting-reconciliation.test.ts.

/**
 * Default tie-out lookback when the company has no
 * `postingSync.syncFromDate` — matches the reconciliation presence window.
 */
export const TIE_OUT_DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Lower bound of the tie-out scope: `postingSync.syncFromDate` when set,
 * else `todayIso - TIE_OUT_DEFAULT_LOOKBACK_DAYS`. ISO date strings.
 */
export function getTieOutScopeStart(args: {
  todayIso: string;
  syncFromDate?: string | null;
}): string {
  const syncFrom = args.syncFromDate?.slice(0, 10);
  if (syncFrom) return syncFrom;
  return parseDate(args.todayIso)
    .subtract({ days: TIE_OUT_DEFAULT_LOOKBACK_DAYS })
    .toString();
}

/**
 * The five tie-out amount buckets a posted journal's debit-signed line
 * amounts land in, based on its sync disposition (spec §5 internal
 * completeness: carbonPosted = synced + docBacked + excluded + pending +
 * blocked).
 */
export type TieOutBucket =
  | "synced"
  | "docBacked"
  | "excluded"
  | "pending"
  | "blocked";

/**
 * Delivery order, LEAST delivered first — the fold order for a journal
 * with both a normal and a :reversal operation.
 */
export const TIE_OUT_BUCKETS_LEAST_DELIVERED_FIRST: readonly TieOutBucket[] = [
  "blocked",
  "pending",
  "excluded",
  "docBacked",
  "synced"
];

export const DOC_BACKED_ERROR_CODE = "DOC_BACKED";

/**
 * Map one journalEntry operation's disposition onto its tie-out bucket:
 *
 * - Completed → synced;
 * - Excluded/DOC_BACKED → docBacked only while the backing document is
 *   actually delivered (its own op Completed, or an external mapping
 *   exists), else pending — a doc-backed journal is only "in the GL" if
 *   the document really synced (spec §5);
 * - other Excluded → excluded;
 * - Pending / In Flight → pending;
 * - Failed / Warning / Skipped → blocked.
 */
export function getOperationTieOutBucket(
  operation: Pick<SyncOperation, "status" | "errorCode">,
  args: { docBackedDelivered: boolean }
): TieOutBucket {
  switch (operation.status) {
    case "Completed":
      return "synced";
    case "Excluded":
      if (operation.errorCode === DOC_BACKED_ERROR_CODE) {
        return args.docBackedDelivered ? "docBacked" : "pending";
      }
      return "excluded";
    case "Pending":
    case "In Flight":
      return "pending";
    default:
      // Failed | Warning | Skipped
      return "blocked";
  }
}

/**
 * Fold a journal's per-operation buckets into ONE bucket for its full
 * line amounts: the LEAST-delivered bucket wins (blocked > pending >
 * excluded > docBacked > synced). A journal with no operations at all is
 * pending — it has been posted but nothing has decided it yet.
 */
export function foldTieOutBuckets(
  buckets: readonly TieOutBucket[]
): TieOutBucket {
  let least: TieOutBucket | null = null;
  for (const bucket of buckets) {
    if (
      least === null ||
      TIE_OUT_BUCKETS_LEAST_DELIVERED_FIRST.indexOf(bucket) <
        TIE_OUT_BUCKETS_LEAST_DELIVERED_FIRST.indexOf(least)
    ) {
      least = bucket;
    }
  }
  return least ?? "pending";
}

/**
 * Latest operation per entityId (by createdAt). Terminal re-dispositions
 * insert new rows for the same tuple over time; the newest row is the
 * journal's current disposition (mirrors getLatestOperationForTuple in
 * the operations service).
 */
export function getLatestOperationsByEntityId<
  T extends Pick<SyncOperation, "entityId" | "createdAt">
>(operations: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const operation of operations) {
    const existing = latest.get(operation.entityId);
    if (!existing || operation.createdAt > existing.createdAt) {
      latest.set(operation.entityId, operation);
    }
  }
  return latest;
}

export type TieOutPeriod = {
  id: string;
  /** YYYY-MM-DD (normalize DATE reads before calling). */
  startDate: string;
  /** YYYY-MM-DD. */
  endDate: string;
};

/**
 * The accounting period whose [startDate, endDate] contains the date
 * (inclusive), or null. ISO date strings compare lexicographically.
 */
export function findAccountingPeriodForDate<T extends TieOutPeriod>(
  periods: readonly T[],
  isoDate: string | null
): T | null {
  if (!isoDate) return null;
  const day = isoDate.slice(0, 10);
  return (
    periods.find(
      (period) =>
        period.startDate.slice(0, 10) <= day &&
        day <= period.endDate.slice(0, 10)
    ) ?? null
  );
}

/** `metadata.backingDocument.entityType` of a DOC_BACKED disposition, or null. */
export function getBackingDocumentEntityType(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const backing = metadata?.backingDocument;
  if (typeof backing !== "object" || backing === null) return null;
  const entityType = (backing as Record<string, unknown>).entityType;
  return typeof entityType === "string" ? entityType : null;
}

/**
 * A DOC_BACKED journal counts as delivered only while its backing
 * document's own operation is Completed OR the document already carries an
 * external mapping (a truthful Completed push implies one; the mapping
 * also covers documents linked outside the ledger, e.g. backfills).
 */
export function isBackingDocumentDelivered(args: {
  latestOperationStatus: string | null;
  hasExternalMapping: boolean;
}): boolean {
  return args.latestOperationStatus === "Completed" || args.hasExternalMapping;
}

/**
 * Fold account-mapping rows (entityType "account") into a reverse index:
 * remote account ref → Carbon account.id. Both the mapping's externalId
 * (QBO AccountRef.value = provider account id) and its metadata
 * externalCode (Xero AccountCode / Rillet account_code) are indexed —
 * providers address journal lines by different refs. Consolidation
 * mappings are many-to-one (several Carbon accounts → one provider
 * account); the first row wins, so pass rows in a stable order.
 */
export function buildRemoteAccountRefIndex(
  mappings: ReadonlyArray<{
    entityId: string;
    externalId: string | null;
    metadata: unknown;
  }>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const mapping of mappings) {
    const refs: Array<string | null> = [mapping.externalId];
    if (
      typeof mapping.metadata === "object" &&
      mapping.metadata !== null &&
      !Array.isArray(mapping.metadata)
    ) {
      const externalCode = (mapping.metadata as Record<string, unknown>)
        .externalCode;
      if (typeof externalCode === "string") refs.push(externalCode);
    }
    for (const ref of refs) {
      if (!ref) continue;
      if (!index.has(ref)) index.set(ref, mapping.entityId);
    }
  }
  return index;
}

export type TieOutCellCents = {
  carbonPostedCents: number;
  syncedCents: number;
  docBackedCents: number;
  excludedCents: number;
  pendingCents: number;
  blockedCents: number;
  /** null = no provider fetch succeeded for this cell. */
  providerCents: number | null;
};

/**
 * The two tie-out invariants as deltas (cents):
 * internal = carbonPosted − (synced+docBacked+excluded+pending+blocked);
 * external = synced − provider (null while providerCents is null).
 */
export function computeTieOutDeltas(cell: TieOutCellCents): {
  internalDeltaCents: number;
  externalDeltaCents: number | null;
} {
  const accounted =
    cell.syncedCents +
    cell.docBackedCents +
    cell.excludedCents +
    cell.pendingCents +
    cell.blockedCents;
  return {
    internalDeltaCents: cell.carbonPostedCents - accounted,
    externalDeltaCents:
      cell.providerCents === null ? null : cell.syncedCents - cell.providerCents
  };
}
