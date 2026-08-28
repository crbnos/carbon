import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYNC_OPERATION_ALLOWED_TRANSITIONS } from "./models";
import type {
  SyncOperation,
  SyncOperationDirection,
  SyncOperationStatus,
  SyncOperationTrigger
} from "./types";

/**
 * Service for the "accountingSyncOperation" ledger: one row per attempted
 * sync of one entity in one direction. Enqueue absorbs re-triggers into the
 * live row, drains claim Pending work, and the UI retries/skips/re-sends
 * through guarded transitions.
 */

/**
 * A Completed operation absorbs event/webhook re-triggers for this long.
 */
export const SYNC_OPERATION_COOLDOWN_MS = 60_000;

/**
 * "In Flight" rows older than this are considered abandoned (e.g. a drain
 * that crashed mid-run) and become claimable again.
 */
export const SYNC_OPERATION_STALE_IN_FLIGHT_MS = 10 * 60_000;

const DEFAULT_CLAIM_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 25;
const UNIQUE_VIOLATION = "23505";

/**
 * Live operations hold the partial unique index on
 * (companyId, integration, entityType, entityId, direction): a new enqueue
 * for the same tuple is absorbed instead of creating a duplicate row.
 */
export function isLiveSyncOperationStatus(
  status: SyncOperationStatus
): boolean {
  return status === "Pending" || status === "In Flight";
}

/**
 * Only machine re-triggers (event/webhook) respect the completed-row
 * cooldown; backfill/manual/posting/retry always enqueue.
 */
export function isCooldownTrigger(trigger: SyncOperationTrigger): boolean {
  return trigger === "event" || trigger === "webhook";
}

/**
 * Decide whether an enqueue should be skipped because a Completed operation
 * for the same tuple finished inside the cooldown window.
 */
export function shouldSkipForCooldown(args: {
  trigger: SyncOperationTrigger;
  completedAt: string | null | undefined;
  now?: Date;
  cooldownMs?: number;
}): boolean {
  if (!isCooldownTrigger(args.trigger)) return false;
  if (!args.completedAt) return false;

  const completedAtMs = new Date(args.completedAt).getTime();
  if (Number.isNaN(completedAtMs)) return false;

  const nowMs = (args.now ?? new Date()).getTime();
  return (
    nowMs - completedAtMs < (args.cooldownMs ?? SYNC_OPERATION_COOLDOWN_MS)
  );
}

/**
 * Guard table for UI-driven transitions. Returns null when the transition
 * is allowed, otherwise a descriptive error string.
 */
export function getSyncOperationTransitionError(
  from: SyncOperationStatus,
  to: SyncOperationStatus
): string | null {
  return SYNC_OPERATION_ALLOWED_TRANSITIONS[from].includes(to)
    ? null
    : `invalid transition ${from} → ${to}`;
}

/**
 * PostgREST list literal for excluding entity types from a claim (used
 * with `.not("entityType", "in", ...)`), or null when there is nothing to
 * exclude. Values are double-quoted per PostgREST list syntax so an entity
 * type containing a reserved character cannot corrupt the list.
 */
export function getClaimEntityTypeExclusion(
  excludeEntityTypes: string[] | undefined
): string | null {
  if (!excludeEntityTypes || excludeEntityTypes.length === 0) return null;
  return `(${excludeEntityTypes.map((type) => `"${type}"`).join(",")})`;
}

/**
 * A claim can be scoped by an include filter (`entityTypes`, e.g. the
 * daily-consolidation cron claims only journalEntry operations) OR an
 * exclude filter (`excludeEntityTypes`, e.g. drains hold journalEntry for
 * the cron), never both — combining them invites contradictory filters.
 * Returns the error string for an invalid combination, else null.
 */
export function getClaimEntityTypeFilterError(args: {
  entityTypes?: string[];
  excludeEntityTypes?: string[];
}): string | null {
  const hasInclude = !!args.entityTypes && args.entityTypes.length > 0;
  const hasExclude =
    !!args.excludeEntityTypes && args.excludeEntityTypes.length > 0;
  return hasInclude && hasExclude
    ? "entityTypes and excludeEntityTypes are mutually exclusive claim filters"
    : null;
}

// Generated types now include "accountingSyncOperation" (regenerated with
// the v3 work), but dropping this cast trades it for Json-vs-Record friction
// on every metadata write in this file — a standalone cleanup. Until then
// the query builder stays untyped; row payloads are typed locally via
// SyncOperation (core/models.ts).
function syncOperationTable(client: SupabaseClient<Database>): any {
  return client.from("accountingSyncOperation" as any);
}

export type EnqueueSyncOperationInput = {
  companyId: string;
  integration: string;
  entityType: string;
  entityId: string;
  direction: SyncOperationDirection;
  trigger: SyncOperationTrigger;
  idempotencyKey: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
};

async function getLiveOperation(
  client: SupabaseClient<Database>,
  op: Pick<
    EnqueueSyncOperationInput,
    "companyId" | "integration" | "entityType" | "entityId" | "direction"
  >
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const result = await syncOperationTable(client)
    .select("*")
    .eq("companyId", op.companyId)
    .eq("integration", op.integration)
    .eq("entityType", op.entityType)
    .eq("entityId", op.entityId)
    .eq("direction", op.direction)
    .in("status", ["Pending", "In Flight"])
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };
  return { data: (result.data as SyncOperation | null) ?? null, error: null };
}

async function getOperationByIdempotencyKey(
  client: SupabaseClient<Database>,
  op: Pick<
    EnqueueSyncOperationInput,
    "companyId" | "integration" | "idempotencyKey"
  >
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const result = await syncOperationTable(client)
    .select("*")
    .eq("companyId", op.companyId)
    .eq("integration", op.integration)
    .eq("idempotencyKey", op.idempotencyKey)
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };
  return { data: (result.data as SyncOperation | null) ?? null, error: null };
}

/**
 * Enqueue a sync operation.
 *
 * - Same (companyId, integration, idempotencyKey) already exists → returns
 *   the existing row (idempotent).
 * - A Pending/In Flight row exists for the same (entityType, entityId,
 *   direction) → returns it (absorbed). A concurrent insert losing the race
 *   on either unique index (23505) is absorbed the same way.
 * - A Completed row for the same tuple finished < 60s ago and the trigger
 *   is event/webhook → returns { data: null, error: null } (skipped).
 */
export async function enqueueSyncOperation(
  client: SupabaseClient<Database>,
  op: EnqueueSyncOperationInput
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const existingByKey = await getOperationByIdempotencyKey(client, op);
  if (existingByKey.error) return existingByKey;
  if (existingByKey.data) return existingByKey;

  const live = await getLiveOperation(client, op);
  if (live.error) return live;
  if (live.data) return live;

  if (isCooldownTrigger(op.trigger)) {
    const lastCompleted = await syncOperationTable(client)
      .select("completedAt")
      .eq("companyId", op.companyId)
      .eq("integration", op.integration)
      .eq("entityType", op.entityType)
      .eq("entityId", op.entityId)
      .eq("direction", op.direction)
      .eq("status", "Completed")
      .order("completedAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCompleted.error) {
      return { data: null, error: lastCompleted.error.message };
    }

    const completedAt = (
      lastCompleted.data as Pick<SyncOperation, "completedAt"> | null
    )?.completedAt;

    if (shouldSkipForCooldown({ trigger: op.trigger, completedAt })) {
      return { data: null, error: null };
    }
  }

  const inserted = await syncOperationTable(client)
    .insert({
      companyId: op.companyId,
      integration: op.integration,
      entityType: op.entityType,
      entityId: op.entityId,
      direction: op.direction,
      trigger: op.trigger,
      status: "Pending",
      idempotencyKey: op.idempotencyKey,
      metadata: op.metadata ?? null,
      createdBy: op.createdBy
    })
    .select("*")
    .single();

  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      // A concurrent enqueue won the race on one of the unique indexes —
      // absorb by returning whichever row now holds it
      const byKey = await getOperationByIdempotencyKey(client, op);
      if (byKey.data) return byKey;

      const liveRetry = await getLiveOperation(client, op);
      if (liveRetry.data) return liveRetry;
    }

    return { data: null, error: inserted.error.message };
  }

  return { data: inserted.data as SyncOperation, error: null };
}

export type InsertTerminalSyncOperationInput = EnqueueSyncOperationInput & {
  /** Decision-time disposition: Excluded (policy) or Warning (config hole). */
  status: "Excluded" | "Warning";
  errorCode: string;
  errorMessage: string;
};

async function getLatestOperationForTuple(
  client: SupabaseClient<Database>,
  op: Pick<
    EnqueueSyncOperationInput,
    "companyId" | "integration" | "entityType" | "entityId" | "direction"
  >
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const result = await syncOperationTable(client)
    .select("*")
    .eq("companyId", op.companyId)
    .eq("integration", op.integration)
    .eq("entityType", op.entityType)
    .eq("entityId", op.entityId)
    .eq("direction", op.direction)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };
  return { data: (result.data as SyncOperation | null) ?? null, error: null };
}

/**
 * Record a decision-time disposition directly in a terminal status
 * (spec I1: every posted journal gets exactly one recorded disposition —
 * `Excluded` for policy exclusions, `Warning` for config holes like
 * DOC_SYNC_DISABLED). Idempotent:
 *
 * - same (companyId, integration, idempotencyKey) → returns the existing row;
 * - ANY existing operation for the (entityType, entityId, direction) tuple →
 *   returns it untouched (the journal already has a disposition or a live
 *   push — re-deliveries and backfills never churn new terminal rows);
 * - a concurrent insert losing the unique-index race (23505) is absorbed.
 *
 * `completedAt` is stamped as the disposition-recorded time so the inbox
 * sorts terminal rows consistently with Completed pushes.
 */
export async function insertTerminalSyncOperation(
  client: SupabaseClient<Database>,
  op: InsertTerminalSyncOperationInput
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const existingByKey = await getOperationByIdempotencyKey(client, op);
  if (existingByKey.error) return existingByKey;
  if (existingByKey.data) return existingByKey;

  const existingForTuple = await getLatestOperationForTuple(client, op);
  if (existingForTuple.error) return existingForTuple;
  if (existingForTuple.data) return existingForTuple;

  const inserted = await syncOperationTable(client)
    .insert({
      companyId: op.companyId,
      integration: op.integration,
      entityType: op.entityType,
      entityId: op.entityId,
      direction: op.direction,
      trigger: op.trigger,
      status: op.status,
      idempotencyKey: op.idempotencyKey,
      errorCode: op.errorCode,
      errorMessage: op.errorMessage,
      completedAt: new Date().toISOString(),
      metadata: op.metadata ?? null,
      createdBy: op.createdBy
    })
    .select("*")
    .single();

  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      const byKey = await getOperationByIdempotencyKey(client, op);
      if (byKey.data) return byKey;

      const forTuple = await getLatestOperationForTuple(client, op);
      if (forTuple.data) return forTuple;
    }

    return { data: null, error: inserted.error.message };
  }

  return { data: inserted.data as SyncOperation, error: null };
}

/**
 * Claim up to `limit` operations for a drain: Pending rows plus "In Flight"
 * rows whose lastAttemptAt is older than 10 minutes (abandoned by a crashed
 * drain). Claimed rows move to "In Flight" with lastAttemptAt = now and
 * attemptCount incremented. Rows claimed by a concurrent drain in between
 * are skipped (optimistic lock on status + attemptCount).
 *
 * `excludeEntityTypes` leaves matching rows un-claimed (still Pending) —
 * the exclusion is applied inside the queries so held rows never consume
 * the claim limit. The daily-consolidation hold uses this: journalEntry
 * operations for companies whose posting-sync settings resolve to
 * consolidation "daily" are drained by the consolidation cron, never
 * pushed individually.
 *
 * `entityTypes` is the include-only counterpart (the consolidation cron
 * claims ONLY journalEntry operations). Mutually exclusive with
 * `excludeEntityTypes` — see getClaimEntityTypeFilterError.
 */
export async function claimPendingOperations(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    integration: string;
    limit?: number;
    entityTypes?: string[];
    excludeEntityTypes?: string[];
    /**
     * Leave journalEntry operations stamped `metadata.granularity =
     * "daily-summary"` un-claimed (still Pending) — they belong to the
     * daily-consolidation cron. Individual-granularity (and legacy
     * unstamped) journal operations claim normally. The event-path drain
     * sets this whenever it is not holding ALL journal operations via the
     * transitional consolidation flag.
     */
    holdDailySummaryJournalEntries?: boolean;
  }
): Promise<{ data: SyncOperation[]; error: string | null }> {
  const filterError = getClaimEntityTypeFilterError(args);
  if (filterError) return { data: [], error: filterError };

  const limit = args.limit ?? DEFAULT_CLAIM_LIMIT;
  const inclusion =
    args.entityTypes && args.entityTypes.length > 0 ? args.entityTypes : null;
  const exclusion = getClaimEntityTypeExclusion(args.excludeEntityTypes);
  // NOT (entityType = journalEntry AND metadata->>granularity = daily-summary)
  const dailySummaryHold =
    "entityType.neq.journalEntry,metadata->>granularity.is.null,metadata->>granularity.neq.daily-summary";
  const now = new Date();
  const staleBefore = new Date(
    now.getTime() - SYNC_OPERATION_STALE_IN_FLIGHT_MS
  ).toISOString();

  let pendingQuery = syncOperationTable(client)
    .select("*")
    .eq("companyId", args.companyId)
    .eq("integration", args.integration)
    .eq("status", "Pending");

  if (inclusion) {
    pendingQuery = pendingQuery.in("entityType", inclusion);
  } else if (exclusion) {
    pendingQuery = pendingQuery.not("entityType", "in", exclusion);
  }
  if (args.holdDailySummaryJournalEntries) {
    pendingQuery = pendingQuery.or(dailySummaryHold);
  }

  const pending = await pendingQuery
    .order("createdAt", { ascending: true })
    .limit(limit);

  if (pending.error) return { data: [], error: pending.error.message };

  let staleQuery = syncOperationTable(client)
    .select("*")
    .eq("companyId", args.companyId)
    .eq("integration", args.integration)
    .eq("status", "In Flight")
    .lt("lastAttemptAt", staleBefore);

  if (inclusion) {
    staleQuery = staleQuery.in("entityType", inclusion);
  } else if (exclusion) {
    staleQuery = staleQuery.not("entityType", "in", exclusion);
  }
  if (args.holdDailySummaryJournalEntries) {
    staleQuery = staleQuery.or(dailySummaryHold);
  }

  const stale = await staleQuery
    .order("createdAt", { ascending: true })
    .limit(limit);

  if (stale.error) return { data: [], error: stale.error.message };

  const candidates = [
    ...((pending.data ?? []) as SyncOperation[]),
    ...((stale.data ?? []) as SyncOperation[])
  ]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);

  const claimed: SyncOperation[] = [];

  for (const candidate of candidates) {
    const updated = await syncOperationTable(client)
      .update({
        status: "In Flight",
        lastAttemptAt: now.toISOString(),
        attemptCount: candidate.attemptCount + 1,
        updatedAt: now.toISOString()
      })
      .eq("id", candidate.id)
      .eq("companyId", candidate.companyId)
      .eq("status", candidate.status)
      .eq("attemptCount", candidate.attemptCount)
      .select("*");

    if (updated.error) return { data: claimed, error: updated.error.message };

    const claimedRow = ((updated.data ?? []) as SyncOperation[])[0];
    if (claimedRow) claimed.push(claimedRow);
  }

  return { data: claimed, error: null };
}

/**
 * Fetch operations by id, companyId-scoped. Claim state lives in the
 * ledger, not in caller memory, so stateless callers can re-load the
 * operations they hold by id.
 */
export async function getSyncOperationsByIds(
  client: SupabaseClient<Database>,
  args: { companyId: string; ids: string[] }
): Promise<{ data: SyncOperation[]; error: string | null }> {
  if (args.ids.length === 0) return { data: [], error: null };

  const result = await syncOperationTable(client)
    .select("*")
    .eq("companyId", args.companyId)
    .in("id", args.ids);

  if (result.error) return { data: [], error: result.error.message };
  return { data: (result.data ?? []) as SyncOperation[], error: null };
}

/**
 * Replace an operation's metadata without touching its status — for
 * callers that need to persist progression on an "In Flight" operation
 * where completeOperation/failOperation don't apply (they always
 * transition the status). Same replace-not-merge metadata contract as
 * those two.
 */
export async function updateOperationMetadata(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const updated = await syncOperationTable(client)
    .update({
      metadata: args.metadata,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as SyncOperation, error: null };
}

/**
 * Mark an operation Completed (clears any previous error fields).
 *
 * `metadata`, when provided, replaces the operation's metadata (same
 * contract as failOperation) — the daily-consolidation cron passes the
 * operation's existing metadata merged with `consolidatedInto` so member
 * operations record which batch absorbed them.
 */
export async function completeOperation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const now = new Date().toISOString();

  const updated = await syncOperationTable(client)
    .update({
      status: "Completed",
      completedAt: now,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
      ...(args.externalId ? { externalId: args.externalId } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {})
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as SyncOperation, error: null };
}

/**
 * Mark an operation Failed — or Warning when `warning: true` (pre-flight
 * conditions the user can fix, e.g. unmapped accounts).
 *
 * `metadata`, when provided, replaces the operation's metadata — the drain
 * passes a structured failure's metadata (e.g. unmappedAccountIds) merged
 * over the operation's existing metadata.
 */
export async function failOperation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    errorCode?: string;
    errorMessage: string;
    warning?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const now = new Date().toISOString();

  const updated = await syncOperationTable(client)
    .update({
      status: args.warning ? "Warning" : "Failed",
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage,
      updatedAt: now,
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {})
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as SyncOperation, error: null };
}

/**
 * Accounts currently blocking a sync: the distinct account ids named by
 * parked UNMAPPED_ACCOUNTS journal operations (metadata.unmappedAccountIds),
 * minus any that have since been mapped. Feeds the "Blocking sync" rows in the
 * Account Mapping tab so an arbitrary (non-posting-default) account that held
 * up a journal is surfaced with a mapping control.
 */
export async function getAccountsBlockingSync(
  client: SupabaseClient<Database>,
  args: { companyId: string; integration: string }
): Promise<{
  data: Array<{ id: string; number: string | null; name: string }> | null;
  error: string | null;
}> {
  const ops = await syncOperationTable(client)
    .select("metadata")
    .eq("companyId", args.companyId)
    .eq("integration", args.integration)
    .eq("status", "Warning")
    .eq("errorCode", "UNMAPPED_ACCOUNTS");
  if (ops.error) return { data: null, error: ops.error.message };

  const accountIds = new Set<string>();
  for (const op of (ops.data ?? []) as Array<{
    metadata: { unmappedAccountIds?: unknown } | null;
  }>) {
    const ids = op.metadata?.unmappedAccountIds;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0) accountIds.add(id);
      }
    }
  }
  if (accountIds.size === 0) return { data: [], error: null };

  const mapped = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("entityType", "account")
    .eq("integration", args.integration)
    .eq("companyId", args.companyId);
  if (mapped.error) return { data: null, error: mapped.error.message };
  const mappedSet = new Set((mapped.data ?? []).map((row) => row.entityId));

  const remaining = [...accountIds].filter((id) => !mappedSet.has(id));
  if (remaining.length === 0) return { data: [], error: null };

  const accounts = await client
    .from("account")
    .select("id, number, name")
    .in("id", remaining)
    .order("number", { ascending: true });
  if (accounts.error) return { data: null, error: accounts.error.message };
  return { data: accounts.data ?? [], error: null };
}

/**
 * Mark an operation Skipped — the drain's close-out for a syncer no-op
 * with NO remote copy behind it (shouldSync gate, config-disabled entity,
 * parked payment). Truthful-ledger rule (v4 spec, Pillar C): such a no-op
 * must never read Completed; the reason lands in errorMessage (errorCode
 * stays null so the inbox renders it neutrally, not as an error badge).
 * `completedAt` is stamped so terminal rows sort consistently. A no-op
 * whose result carries a remoteId (fast-bailout, already-linked) still
 * closes Completed — the remote copy exists, so Completed is the truth.
 */
export async function skipOperation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    reason: string;
  }
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const now = new Date().toISOString();

  const updated = await syncOperationTable(client)
    .update({
      status: "Skipped",
      errorCode: null,
      errorMessage: args.reason,
      completedAt: now,
      updatedAt: now
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as SyncOperation, error: null };
}

/**
 * UI-driven status transition (Retry / Skip / Re-send) with the guard
 * table: Failed|Warning|Skipped → Pending, Failed|Warning|Pending →
 * Skipped, Completed → Pending. Anything else returns an error string.
 * Stamps updatedBy.
 */
export async function transitionOperation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    to: SyncOperationStatus;
    userId: string;
  }
): Promise<{ data: SyncOperation | null; error: string | null }> {
  const existing = await syncOperationTable(client)
    .select("*")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (existing.error) return { data: null, error: existing.error.message };
  if (!existing.data) {
    return { data: null, error: `Sync operation ${args.id} not found` };
  }

  const from = (existing.data as SyncOperation).status;
  const transitionError = getSyncOperationTransitionError(from, args.to);
  if (transitionError) return { data: null, error: transitionError };

  const updated = await syncOperationTable(client)
    .update({
      status: args.to,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .eq("status", from) // guard against a concurrent transition
    .select("*")
    .single();

  if (updated.error) return { data: null, error: updated.error.message };
  return { data: updated.data as SyncOperation, error: null };
}

/**
 * List sync operations for the activity/error-inbox UI, newest first, with
 * an optional status filter and offset pagination. `count` is the total for
 * the current filter. `entityType` narrows to one entity type — the
 * consolidation and reconciliation crons page journalEntry operations
 * without wading through every other entity's history.
 */
export async function getSyncOperations(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    integration: string;
    status?: SyncOperationStatus | SyncOperationStatus[];
    entityType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{
  data: SyncOperation[];
  count: number | null;
  error: string | null;
}> {
  const limit = args.limit ?? DEFAULT_PAGE_SIZE;
  const offset = args.offset ?? 0;

  let query = syncOperationTable(client)
    .select("*", { count: "exact" })
    .eq("companyId", args.companyId)
    .eq("integration", args.integration);

  if (args.status) {
    query = Array.isArray(args.status)
      ? query.in("status", args.status)
      : query.eq("status", args.status);
  }

  if (args.entityType) {
    query = query.eq("entityType", args.entityType);
  }

  const result = await query
    .order("createdAt", { ascending: false })
    .range(offset, offset + limit - 1);

  if (result.error) {
    return { data: [], count: null, error: result.error.message };
  }

  return {
    data: (result.data ?? []) as SyncOperation[],
    count: result.count ?? null,
    error: null
  };
}
