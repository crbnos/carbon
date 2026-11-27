// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  aggregateJournalEntriesForDate,
  claimPendingOperations,
  completeOperation,
  createMappingService,
  enqueueSyncOperation,
  failOperation,
  getAccountingIntegration,
  getPostingSyncSourceTypeSkipReason,
  getProviderIntegration,
  getSyncOperations,
  isAccountingSyncEnabled,
  JournalEntrySyncError,
  type JournalEntrySyncer,
  mapJournalEntryToManualJournal,
  type PostingSyncSettings,
  ProviderID,
  parseJournalEntrySyncEntityId,
  RatelimitError,
  remoteCreateKey,
  resolvePostingSyncSettings,
  runJournalEntryPreflight,
  type SyncContext,
  SyncFactory,
  type SyncOperation,
  transitionOperation,
  updateOperationMetadata,
  XERO_REDATED_NARRATION,
  type XeroProvider
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * Daily-consolidation cron (posting sync, spec Phase B §6).
 *
 * Companies whose posting-sync settings resolve to consolidation "daily"
 * have their journalEntry operations HELD at drain time (the drain excludes
 * the entity type at claim time — see accounting-sync-operations.ts). This
 * cron (02:00 UTC) is the only consumer of those held operations:
 *
 * 1. Pre-scan the claimable journalEntry operations (Pending + stale
 *    In Flight) and resolve each journal's posting date.
 * 2. For every candidate date (strictly before today, UTC) reserve a batch
 *    MARKER operation with idempotencyKey `daily:<integration>:<date>`.
 *    enqueueSyncOperation's return-existing semantics make this the re-run
 *    guard: a marker that is already Completed means that date's summary
 *    was pushed — late (backdated) members for such a date are pushed
 *    INDIVIDUALLY through the normal syncer path instead of silently
 *    re-consolidating or stranding.
 * 3. Claim the journalEntry operations (include-only claim), partition them
 *    (markers / reversals / by-date members / held / missing), and per date
 *    build ONE aggregated journal (aggregateJournalEntriesForDate), run the
 *    SAME pre-flights as individual pushes (runJournalEntryPreflight with
 *    the syncer's cached account-code map, control accounts and lock date),
 *    and push it via createManualJournal.
 * 4. On success every member operation is Completed with
 *    `metadata.consolidatedInto = <batch key>` and externalId = the created
 *    ManualJournalID; the marker is completed LAST (commit point). On a
 *    pre-flight failure the whole batch lands Warning/Failed on every
 *    member (errorCode from the pre-flight, metadata listing the member
 *    journal ids) and the marker records the same failure.
 *
 * Reversal operations (metadata.reversal) are never consolidated — they are
 * pushed individually through JournalEntrySyncer.pushToAccounting in the
 * same run (the overridden single push preserves structured pre-flight
 * failures; the base BATCH workflow would flatten them to strings).
 *
 * Operations dated today or later stay unpushed: they are left In Flight
 * and recovered by the stale-claim rule on a later run once their date has
 * passed (attemptCount ticks once per held day; journals post-dated far
 * into the future will show a growing attempt count until their date
 * arrives). A RatelimitError aborts the company's step so Inngest retries;
 * claimed rows stay In Flight and become re-claimable once stale.
 */
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import {
  type IsolatedStepOutcome,
  runIsolatedCompanyStep
} from "./accounting-auth-failure";
import {
  type ConsolidationGroup,
  getSyncOperationActor,
  getSyncOperationFailureRecord,
  getUtcDateString,
  hasDailySummarySourceTypes,
  isClaimableConsolidationOperation,
  isDailyConsolidationMarker,
  partitionConsolidationOperations,
  toIsoDateString
} from "./accounting-sync-operations";

const logger = getLogger("jobs", "accounting-consolidation");

/** Same bound as the drain: 25 iterations × claim batch of 20 = 500 ops. */
const MAX_CLAIM_ITERATIONS = 25;

/** Pre-scan page size (aligned with the claim bound above). */
const PRESCAN_LIMIT = 500;

const JOURNAL_ID_CHUNK_SIZE = 300;

/** The summary push a marker recorded before its create: the Narration sent and the journals in it. */
function readConsolidationPush(
  metadata: SyncOperation["metadata"]
): { narration: string; journalIds: string[] } | null {
  const push = (metadata as { push?: unknown } | null)?.push as
    | { narration?: unknown; journalIds?: unknown }
    | undefined;
  if (typeof push?.narration !== "string" || !Array.isArray(push.journalIds)) {
    return null;
  }
  return {
    narration: push.narration,
    journalIds: push.journalIds.filter(
      (id): id is string => typeof id === "string"
    )
  };
}

/** The journals a Completed marker's summary booked (empty for a day closed with none). */
function readBookedJournalIds(marker: SyncOperation): string[] {
  const journalIds = (marker.metadata as { journalIds?: unknown } | null)
    ?.journalIds;
  return Array.isArray(journalIds)
    ? journalIds.filter((id): id is string => typeof id === "string")
    : [];
}

/** A day whose push failed: a later run reopens its marker and pushes the day again. */
const REOPENABLE_MARKER_STATUSES: ReadonlyArray<SyncOperation["status"]> = [
  "Failed",
  "Warning"
];

/**
 * A day that is settled: its summary went out (Completed), or a person or a
 * policy closed it (Skipped, Excluded). Its later members push on their own.
 */
const SETTLED_MARKER_STATUSES: ReadonlyArray<SyncOperation["status"]> = [
  "Completed",
  "Skipped",
  "Excluded"
];

type ConsolidationSummary = {
  claimed: number;
  batchesPushed: number;
  batchesEmpty: number;
  batchesFailed: number;
  membersCompleted: number;
  membersSkipped: number;
  membersFailed: number;
  individualCompleted: number;
  individualSkipped: number;
  individualFailed: number;
  held: number;
};

const emptySummary = (): ConsolidationSummary => ({
  claimed: 0,
  batchesPushed: 0,
  batchesEmpty: 0,
  batchesFailed: 0,
  membersCompleted: 0,
  membersSkipped: 0,
  membersFailed: 0,
  individualCompleted: 0,
  individualSkipped: 0,
  individualFailed: 0,
  held: 0
});

async function getJournalPostingDates(
  database: SyncContext["database"],
  companyId: string,
  journalIds: string[]
): Promise<Map<string, string>> {
  const postingDateByJournalId = new Map<string, string>();

  for (let i = 0; i < journalIds.length; i += JOURNAL_ID_CHUNK_SIZE) {
    const chunk = journalIds.slice(i, i + JOURNAL_ID_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const rows = await database
      .selectFrom("journal")
      .select(["id", "postingDate"])
      .where("companyId", "=", companyId)
      .where("id", "in", chunk)
      .execute();

    for (const row of rows) {
      const isoDate = toIsoDateString(row.postingDate);
      if (isoDate) postingDateByJournalId.set(row.id, isoDate);
    }
  }

  return postingDateByJournalId;
}

async function consolidateCompany(args: {
  companyId: string;
  providerId: ProviderID;
  database: SyncContext["database"];
}): Promise<ConsolidationSummary & { skippedReason?: string }> {
  const { companyId, providerId, database } = args;
  const client = getCarbonServiceRole();

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  return consolidateIntegration({
    client,
    database,
    companyId,
    providerId,
    integrationMetadata: integration.metadata,
    provider: getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    ) as XeroProvider,
    createdBy: getSyncOperationActor(integration)
  });
}

/** One company's consolidation run, given its loaded integration and provider. */
export async function consolidateIntegration(args: {
  client: SupabaseClient<Database>;
  database: SyncContext["database"];
  companyId: string;
  providerId: ProviderID;
  integrationMetadata: unknown;
  provider: XeroProvider;
  createdBy: string;
}): Promise<ConsolidationSummary & { skippedReason?: string }> {
  const { client, companyId, providerId, database, provider, createdBy } = args;
  const summary = emptySummary();

  // Re-check the gate inside the step: settings may have changed between
  // enumeration and execution. The cron runs for pure-daily configs
  // (transitional v2 shims) AND for any config with daily-summary source
  // types (v3 per-source-type granularity).
  const settings: PostingSyncSettings = resolvePostingSyncSettings(
    args.integrationMetadata
  );
  if (
    settings.consolidation !== "daily" &&
    !hasDailySummarySourceTypes(settings)
  ) {
    return {
      ...summary,
      skippedReason: "posting sync has no daily-summary work"
    };
  }

  const today = getUtcDateString();
  const now = new Date();

  // ── 1. Pre-scan claimable journalEntry operations ────────────────────────
  const prescan = await getSyncOperations(client, {
    companyId,
    integration: providerId,
    status: ["Pending", "In Flight"],
    entityType: "journalEntry",
    limit: PRESCAN_LIMIT
  });
  if (prescan.error) {
    throw new Error(`Failed to pre-scan sync operations: ${prescan.error}`);
  }

  const claimable = prescan.data.filter((operation) =>
    isClaimableConsolidationOperation(operation, now)
  );
  if (claimable.length === 0) {
    return summary;
  }

  const prescanJournalIds = [
    ...new Set(
      claimable
        .filter((operation) => !isDailyConsolidationMarker(operation.entityId))
        .map(
          (operation) =>
            parseJournalEntrySyncEntityId(operation.entityId).journalId
        )
    )
  ];
  const postingDateByJournalId = await getJournalPostingDates(
    database,
    companyId,
    prescanJournalIds
  );

  const planned = partitionConsolidationOperations({
    operations: claimable,
    postingDateByJournalId,
    today,
    integration: providerId,
    consolidatedBatchKeys: new Set()
  });

  const candidateGroups = [...planned.byGroup.values()].sort((a, b) =>
    a.batchKey.localeCompare(b.batchKey)
  );
  const hasWork =
    candidateGroups.length > 0 ||
    planned.reversals.length > 0 ||
    planned.individual.length > 0 ||
    planned.missing.length > 0 ||
    planned.markers.length > 0;

  if (!hasWork) {
    // Everything claimable is dated today or later — do not claim, so the
    // rows stay Pending instead of churning through In Flight
    summary.held = planned.held.length;
    return summary;
  }

  // ── 2. Reserve/check the batch marker per candidate group BEFORE claiming ─
  const enqueueMarker = async (
    group: Pick<
      ConsolidationGroup<SyncOperation>,
      "batchKey" | "postingDate" | "sourceType"
    >
  ) => {
    return enqueueSyncOperation(client, {
      companyId,
      integration: providerId,
      entityType: "journalEntry",
      entityId: group.batchKey,
      direction: "push-to-accounting",
      trigger: "posting",
      idempotencyKey: group.batchKey,
      createdBy,
      metadata: {
        consolidation: true,
        postingDate: group.postingDate,
        ...(group.sourceType ? { sourceType: group.sourceType } : {})
      }
    });
  };

  // Batches whose summary already went out (marker Completed): members push
  // individually instead, except the ones that summary booked
  const consolidatedBatchKeys = new Set<string>();
  const markersByBatchKey = new Map<string, SyncOperation>();
  const bookedJournals = new Map<
    string,
    { batchKey: string; externalId: string | null }
  >();
  const recordBooked = (batchKey: string, marker: SyncOperation) => {
    for (const journalId of readBookedJournalIds(marker)) {
      bookedJournals.set(journalId, {
        batchKey,
        externalId: marker.externalId ?? null
      });
    }
  };

  /**
   * The journals a settled day's summary booked. A Completed marker names
   * them; a day a person skipped after a push whose response was lost may
   * still have its summary in the provider, found by the push it recorded.
   */
  const recordSettledDay = async (batchKey: string, marker: SyncOperation) => {
    if (marker.status === "Completed") {
      recordBooked(batchKey, marker);
      return;
    }
    const recorded = readConsolidationPush(marker.metadata);
    if (!recorded) return;
    const summaryJournal = await provider.recoverManualJournal([
      recorded.narration
    ]);
    if (!summaryJournal) return;
    for (const journalId of recorded.journalIds) {
      bookedJournals.set(journalId, {
        batchKey,
        externalId: summaryJournal.ManualJournalID
      });
    }
  };

  for (const group of candidateGroups) {
    const marker = await enqueueMarker(group);
    if (marker.error || !marker.data) {
      throw new Error(
        `Failed to reserve consolidation marker for ${group.batchKey}: ${
          marker.error ?? "no row returned"
        }`
      );
    }
    if (SETTLED_MARKER_STATUSES.includes(marker.data.status)) {
      consolidatedBatchKeys.add(group.batchKey);
      await recordSettledDay(group.batchKey, marker.data);
      continue;
    }
    if (REOPENABLE_MARKER_STATUSES.includes(marker.data.status)) {
      // A day whose push failed keeps its marker. Reopen it so the claim
      // below takes it: a run writes only a marker it claimed.
      const reopened = await transitionOperation(client, {
        id: marker.data.id,
        companyId,
        to: "Pending",
        userId: createdBy
      });
      if (reopened.error) {
        logger.warning(
          "Could not reopen a failed consolidation marker; its day waits for a later run",
          {
            companyId,
            providerId,
            batchKey: group.batchKey,
            error: reopened.error
          }
        );
      }
    }
    markersByBatchKey.set(group.batchKey, marker.data);
  }

  // ── 3. Claim (include-only journalEntry) ─────────────────────────────────
  const claimedOperations: SyncOperation[] = [];
  for (let iteration = 0; iteration < MAX_CLAIM_ITERATIONS; iteration++) {
    const claimed = await claimPendingOperations(client, {
      companyId,
      integration: providerId,
      entityTypes: ["journalEntry"]
    });
    if (claimed.error) {
      throw new Error(`Failed to claim sync operations: ${claimed.error}`);
    }
    if (claimed.data.length === 0) break;
    claimedOperations.push(...claimed.data);
  }

  summary.claimed = claimedOperations.length;
  if (claimedOperations.length === 0) {
    return summary;
  }

  // Posting dates for anything the claim surfaced that the pre-scan missed
  // (operations enqueued between the two calls)
  const unresolvedJournalIds = [
    ...new Set(
      claimedOperations
        .filter((operation) => !isDailyConsolidationMarker(operation.entityId))
        .map(
          (operation) =>
            parseJournalEntrySyncEntityId(operation.entityId).journalId
        )
        .filter((journalId) => !postingDateByJournalId.has(journalId))
    )
  ];
  if (unresolvedJournalIds.length > 0) {
    const lateDates = await getJournalPostingDates(
      database,
      companyId,
      unresolvedJournalIds
    );
    for (const [journalId, date] of lateDates) {
      postingDateByJournalId.set(journalId, date);
    }
  }

  const partition = partitionConsolidationOperations({
    operations: claimedOperations,
    postingDateByJournalId,
    today,
    integration: providerId,
    consolidatedBatchKeys
  });
  const claimedMarkerById = new Map(
    partition.markers.map((marker) => [marker.id, marker])
  );

  summary.held = partition.held.length;
  if (partition.held.length > 0) {
    logger.info(
      "Holding journal operations dated today or later; they become claimable again once stale",
      { companyId, providerId, held: partition.held.length, today }
    );
  }

  // ── 4. Shared machinery: syncer + close-out helpers ──────────────────────
  const syncer = SyncFactory.getSyncer({
    database,
    companyId,
    provider,
    config: provider.getSyncConfig("journalEntry"),
    entityType: "journalEntry"
  }) as JournalEntrySyncer;

  const mappingService = createMappingService(database, companyId);

  /**
   * Normal-syncer path for reversals and late backdated members. Uses the
   * overridden single-entity pushToAccounting so pre-flight failures keep
   * their structured errorCode/warning/metadata (the base BATCH workflow
   * flattens them to strings).
   */
  /** Whether each booked summary is still in the provider, read once per run. */
  const summaryLive = new Map<string, Promise<boolean>>();
  const isSummaryLive = (externalId: string) => {
    let live = summaryLive.get(externalId);
    if (!live) {
      live = provider.isManualJournalLive(externalId);
      summaryLive.set(externalId, live);
    }
    return live;
  };

  const pushIndividually = async (operations: SyncOperation[]) => {
    for (const operation of operations) {
      // In a summary still in the provider: pushing it again would book it
      // twice. A member a recovering run did not claim arrives here, and so
      // does one a person re-sent. A summary deleted or voided in the
      // provider books nothing, so a re-sent member then goes out on its own.
      const { journalId, reversal } = parseJournalEntrySyncEntityId(
        operation.entityId
      );
      let booked = reversal ? undefined : bookedJournals.get(journalId);
      if (booked?.externalId) {
        let live: boolean;
        try {
          live = await isSummaryLive(booked.externalId);
        } catch (error) {
          if (error instanceof RatelimitError) throw error;
          // Unknown: neither completing against it nor pushing again is safe.
          summary.individualFailed++;
          await failOperation(client, {
            id: operation.id,
            companyId: operation.companyId,
            attemptCount: operation.attemptCount,
            errorMessage: `Could not confirm the day's summary journal ${booked.externalId} in Xero: ${
              error instanceof Error ? error.message : String(error)
            }`
          });
          continue;
        }
        if (!live) booked = undefined;
      }
      if (booked) {
        summary.membersCompleted++;
        await completeOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount,
          ...(booked.externalId ? { externalId: booked.externalId } : {}),
          metadata: {
            ...(operation.metadata ?? {}),
            consolidatedInto: booked.batchKey
          }
        });
        continue;
      }

      const syncResult = await syncer.pushToAccounting(operation.entityId);

      if (syncResult.status === "error") {
        summary.individualFailed++;
        await failOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount,
          ...getSyncOperationFailureRecord(operation, syncResult)
        });
        continue;
      }

      if (syncResult.status === "skipped") {
        summary.individualSkipped++;
      } else {
        summary.individualCompleted++;
      }
      await completeOperation(client, {
        id: operation.id,
        companyId: operation.companyId,
        attemptCount: operation.attemptCount,
        ...(syncResult.remoteId ? { externalId: syncResult.remoteId } : {})
      });
    }
  };

  // ── 5. Journals that no longer exist ─────────────────────────────────────
  for (const operation of partition.missing) {
    summary.membersFailed++;
    await failOperation(client, {
      id: operation.id,
      companyId: operation.companyId,
      attemptCount: operation.attemptCount,
      errorMessage: `Journal ${operation.entityId} not found in Carbon`
    });
  }

  // ── 6. Individual pushes: reversals + late backdated members ─────────────
  await pushIndividually(partition.reversals);
  await pushIndividually(partition.individual);

  // ── 7. One aggregated push per candidate (source type, date) group ───────
  const processedMarkerIds = new Set<string>();

  /**
   * Whole-batch failure: every member records the error (Warning when
   * user-fixable, from a pre-flight) plus the full member list, and so does
   * the marker.
   */
  const failBatch = async (
    marker: SyncOperation,
    date: string,
    batchKey: string,
    operations: SyncOperation[],
    memberJournalIds: string[],
    error: unknown
  ) => {
    const failure =
      error instanceof JournalEntrySyncError ? error.failure : null;
    const errorMessage =
      failure?.message ??
      (error instanceof Error ? error.message : String(error));

    summary.batchesFailed++;
    for (const operation of operations) {
      summary.membersFailed++;
      await failOperation(client, {
        id: operation.id,
        companyId: operation.companyId,
        attemptCount: operation.attemptCount,
        errorMessage,
        ...(failure
          ? { errorCode: failure.errorCode, warning: failure.warning }
          : {}),
        metadata: {
          ...(operation.metadata ?? {}),
          ...(failure?.metadata ?? {}),
          consolidationBatch: batchKey,
          memberJournalIds
        }
      });
    }

    await failOperation(client, {
      id: marker.id,
      companyId: marker.companyId,
      attemptCount: marker.attemptCount,
      errorMessage: `Daily consolidation for ${date} failed: ${errorMessage}`,
      ...(failure
        ? { errorCode: failure.errorCode, warning: failure.warning }
        : {}),
      metadata: {
        ...(marker.metadata ?? {}),
        postingDate: date,
        memberJournalIds
      }
    });
  };

  for (const group of [...partition.byGroup.values()].sort((a, b) =>
    a.batchKey.localeCompare(b.batchKey)
  )) {
    const { batchKey, postingDate: date, operations } = group;

    let reserved = markersByBatchKey.get(batchKey);
    if (!reserved) {
      // Group surfaced by the claim race (enqueued between pre-scan and
      // claim) — reserve its marker now
      const lateMarker = await enqueueMarker(group);
      if (lateMarker.error || !lateMarker.data) {
        logger.error(
          "Could not reserve a marker for a late batch; leaving its operations In Flight for the next run",
          { companyId, providerId, batchKey, operations: operations.length }
        );
        continue;
      }
      if (SETTLED_MARKER_STATUSES.includes(lateMarker.data.status)) {
        await recordSettledDay(batchKey, lateMarker.data);
        await pushIndividually(operations);
        continue;
      }
      reserved = lateMarker.data;
    }

    // A run writes only a marker its own claim took: one it did not claim
    // is another run's (or the claim cap held it back), and that run pushes
    // the day. The members claimed here go stale and a later run takes them.
    const claimedMarker = claimedMarkerById.get(reserved.id);
    if (!claimedMarker) {
      logger.info(
        "Another run holds this day's consolidation marker; leaving the day to it",
        { companyId, providerId, batchKey, operations: operations.length }
      );
      continue;
    }
    let marker: SyncOperation = claimedMarker;
    processedMarkerIds.add(marker.id);

    // A run that died after its create may have left the summary in Xero
    // without closing anything here: find it by the push it recorded. Every
    // journal that push named is booked by it, whatever its state now, so
    // this comes before any member is skipped, ejected or pushed.
    const previousPush = readConsolidationPush(marker.metadata);
    if (previousPush) {
      let previousJournal: Awaited<
        ReturnType<XeroProvider["recoverManualJournal"]>
      >;
      try {
        previousJournal = await provider.recoverManualJournal([
          previousPush.narration
        ]);
      } catch (error) {
        if (error instanceof RatelimitError) throw error;
        await failBatch(
          marker,
          date,
          batchKey,
          operations,
          previousPush.journalIds,
          error
        );
        continue;
      }
      if (previousJournal) {
        const booked = new Set(previousPush.journalIds);
        const late: SyncOperation[] = [];
        for (const operation of operations) {
          const { journalId } = parseJournalEntrySyncEntityId(
            operation.entityId
          );
          if (!booked.has(journalId)) {
            late.push(operation);
            continue;
          }
          summary.membersCompleted++;
          await completeOperation(client, {
            id: operation.id,
            companyId: operation.companyId,
            attemptCount: operation.attemptCount,
            externalId: previousJournal.ManualJournalID,
            metadata: {
              ...(operation.metadata ?? {}),
              consolidatedInto: batchKey
            }
          });
        }
        const completed = await completeOperation(client, {
          id: marker.id,
          companyId: marker.companyId,
          attemptCount: marker.attemptCount,
          externalId: previousJournal.ManualJournalID,
          metadata: {
            ...(marker.metadata ?? {}),
            consolidation: true,
            postingDate: date,
            journalIds: previousPush.journalIds,
            journalCount: previousPush.journalIds.length
          }
        });
        if (completed.error) {
          // The marker keeps its recorded push, so the next run that claims
          // it finds this summary again and completes it.
          logger.error(
            "Could not complete a consolidation marker after recovering its summary",
            { companyId, providerId, batchKey, error: completed.error }
          );
        } else if (completed.data) {
          recordBooked(batchKey, completed.data);
        }
        // Not in the summary already booked: they go out on their own, as
        // members arriving after a Completed marker do.
        await pushIndividually(late);
        continue;
      }
    }

    // Fetch + gate each member exactly like the syncer's shouldSync would
    const members: Array<{
      operation: SyncOperation;
      journal: NonNullable<
        Awaited<ReturnType<JournalEntrySyncer["fetchLocal"]>>
      >;
    }> = [];

    for (const operation of operations) {
      const journal = await syncer.fetchLocal(operation.entityId);
      if (!journal) {
        summary.membersFailed++;
        await failOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount,
          errorMessage: `Journal ${operation.entityId} not found in Carbon`
        });
        continue;
      }

      const skipReason =
        journal.status !== "Posted"
          ? `Journal must be Posted before syncing (current status: ${journal.status})`
          : getPostingSyncSourceTypeSkipReason(journal.sourceType, settings, {
              inventoryAdjustmentEntitySyncEnabled:
                provider.getSyncConfig("inventoryAdjustment")?.enabled ?? false
            });

      if (skipReason) {
        // Terminal for this attempt, same as the drain's handling of
        // shouldSync skips
        logger.info("Skipping a journal in consolidation", {
          companyId,
          providerId,
          journalId: journal.id,
          date,
          reason: skipReason
        });
        summary.membersSkipped++;
        await completeOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount
        });
        continue;
      }

      // Idempotency: a journal that already has a provider mapping was
      // pushed before (e.g. while the company was in individual mode) —
      // consolidating it again would double-post
      const mapping = await mappingService.getByEntity(
        "journalEntry",
        journal.id,
        provider.id
      );
      if (mapping?.externalId) {
        summary.membersSkipped++;
        await completeOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount,
          externalId: mapping.externalId
        });
        continue;
      }

      members.push({ operation, journal });
    }

    // The SAME pre-flight inputs the individual pushes use (cached on the
    // syncer instance across groups)
    const accountCodesById = await syncer.getAccountCodesById();
    const controlAccountIds = await syncer.getControlAccountIds();
    const lockDate = await syncer.getLockDate(settings);

    // Per-member pre-flight ejection (v3): a member that fails (unmapped
    // accounts, control-account line, unbalanced) parks on its OWN
    // operation with the structured failure, and the batch proceeds with
    // the survivors — one bad journal no longer blocks the whole day.
    const survivors: typeof members = [];
    for (const member of members) {
      const memberPreflight = runJournalEntryPreflight({
        journal: member.journal,
        accountCodesById,
        controlAccountIds,
        lockDate,
        settings
      });
      if (memberPreflight.failure) {
        summary.membersFailed++;
        await failOperation(client, {
          id: member.operation.id,
          companyId: member.operation.companyId,
          attemptCount: member.operation.attemptCount,
          errorMessage: memberPreflight.failure.message,
          errorCode: memberPreflight.failure.errorCode,
          warning: memberPreflight.failure.warning,
          metadata: {
            ...(member.operation.metadata ?? {}),
            ...(memberPreflight.failure.metadata ?? {}),
            ejectedFromBatch: batchKey
          }
        });
        continue;
      }
      survivors.push(member);
    }
    members.length = 0;
    members.push(...survivors);

    if (members.length === 0) {
      // Nothing pushable — close the marker so the batch is settled; any
      // future backdated member pushes individually
      await completeOperation(client, {
        id: marker.id,
        companyId: marker.companyId,
        attemptCount: marker.attemptCount,
        metadata: {
          ...(marker.metadata ?? {}),
          consolidation: true,
          postingDate: date,
          ...(group.sourceType ? { sourceType: group.sourceType } : {}),
          journalCount: 0
        }
      });
      summary.batchesEmpty++;
      continue;
    }

    const memberJournalIds = members.map(({ journal }) => journal.id);

    try {
      const aggregate = aggregateJournalEntriesForDate({
        batchId: batchKey,
        companyId,
        postingDate: date,
        sourceType: group.sourceType,
        journals: members.map(({ journal }) => journal)
      });

      let externalId: string | undefined;

      if (aggregate.journal.lines.length > 0) {
        // Only a summary with lines is checked: a net-zero day pushes
        // nothing, so a lock date must not fail its members.
        const preflight = runJournalEntryPreflight({
          journal: aggregate.journal,
          accountCodesById,
          controlAccountIds,
          lockDate,
          settings
        });
        if (preflight.failure) {
          throw new JournalEntrySyncError(preflight.failure);
        }

        const payload = mapJournalEntryToManualJournal({
          journal: aggregate.journal,
          accountCodesById,
          pushDate: preflight.pushDate,
          redatedFromDate: preflight.redatedFromDate
        });
        const narration = preflight.redatedFromDate
          ? `${aggregate.narration}${XERO_REDATED_NARRATION}${preflight.redatedFromDate}`
          : aggregate.narration;

        // Recorded before the create, so a run that dies after it can find
        // the summary it made (above); the failure path keeps it too.
        const recorded = await updateOperationMetadata(client, {
          id: marker.id,
          companyId: marker.companyId,
          attemptCount: marker.attemptCount,
          metadata: {
            ...(marker.metadata ?? {}),
            push: { narration, journalIds: memberJournalIds }
          }
        });
        if (recorded.error) {
          // Nothing was created: fail the day so its members can be retried,
          // rather than leaving them In Flight with no record.
          logger.error("Could not record the consolidation push", {
            companyId,
            providerId,
            batchKey,
            error: recorded.error
          });
          throw new Error(
            `Could not record the push before creating it: ${recorded.error}`
          );
        }
        if (!recorded.data) {
          logger.warning(
            "The consolidation marker was taken over by a newer run; leaving its batch to it",
            { companyId, providerId, batchKey }
          );
          continue;
        }
        marker = recorded.data;

        const { ManualJournalID: _unmapped, ...journal } = payload;
        const created = await provider.createManualJournal(
          { ...journal, Narration: narration },
          // The member set is part of the key: a later run pushing a
          // different set must not receive this push's replayed response.
          remoteCreateKey({
            companyId,
            operation: "dailyConsolidation",
            localId: `${batchKey}:${[...memberJournalIds].sort().join(",")}`
          })
        );
        externalId = created.ManualJournalID;
        summary.batchesPushed++;
      } else {
        // Net-zero day: every account cancelled out — nothing to book
        summary.batchesEmpty++;
      }

      for (const { operation } of members) {
        summary.membersCompleted++;
        await completeOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
          attemptCount: operation.attemptCount,
          ...(externalId ? { externalId } : {}),
          metadata: {
            ...(operation.metadata ?? {}),
            consolidatedInto: batchKey
          }
        });
      }

      // Marker completes LAST: it is the commit point re-runs dedupe on
      await completeOperation(client, {
        id: marker.id,
        companyId: marker.companyId,
        attemptCount: marker.attemptCount,
        ...(externalId ? { externalId } : {}),
        metadata: {
          ...(marker.metadata ?? {}),
          consolidation: true,
          postingDate: date,
          journalIds: memberJournalIds,
          journalCount: memberJournalIds.length
        }
      });
    } catch (error) {
      if (error instanceof RatelimitError) {
        // Propagate so Inngest retries; claimed rows stay In Flight and
        // become re-claimable once stale
        throw error;
      }
      await failBatch(
        marker,
        date,
        batchKey,
        members.map(({ operation }) => operation),
        memberJournalIds,
        error
      );
    }
  }

  // ── 8. Stray markers (claimed, but their date had no members this run —
  // e.g. a user retried an old marker row). Close them: the date is
  // settled and future arrivals push individually. ──────────────────────────
  for (const operation of partition.markers) {
    if (processedMarkerIds.has(operation.id)) continue;
    // The pre-scan saw members for this day that the claim did not take (the
    // claim cap held them back): closing the day now would push them one by
    // one. A later run takes the marker and its members together.
    if (planned.byGroup.has(operation.entityId)) {
      logger.info(
        "Leaving a consolidation marker whose members this run did not claim",
        { companyId, providerId, batchKey: operation.entityId }
      );
      continue;
    }
    const recordedPush = readConsolidationPush(operation.metadata);
    if (!recordedPush) {
      await completeOperation(client, {
        id: operation.id,
        companyId: operation.companyId,
        attemptCount: operation.attemptCount,
        metadata: {
          ...(operation.metadata ?? {}),
          note: "Marker closed without members by the consolidation cron"
        }
      });
      continue;
    }

    // A push was recorded: its summary may be in the provider for members
    // this run did not claim.
    let summaryJournal: Awaited<
      ReturnType<XeroProvider["recoverManualJournal"]>
    >;
    try {
      summaryJournal = await provider.recoverManualJournal([
        recordedPush.narration
      ]);
    } catch (error) {
      if (error instanceof RatelimitError) throw error;
      logger.error(
        "Could not look up a consolidation marker's recorded push; leaving the marker for a later run",
        { companyId, providerId, markerId: operation.id, error }
      );
      continue;
    }
    if (summaryJournal) {
      // Closed as that summary, so its members are completed against it when
      // a later run claims them.
      await completeOperation(client, {
        id: operation.id,
        companyId: operation.companyId,
        attemptCount: operation.attemptCount,
        externalId: summaryJournal.ManualJournalID,
        metadata: {
          ...(operation.metadata ?? {}),
          journalIds: recordedPush.journalIds,
          journalCount: recordedPush.journalIds.length
        }
      });
      continue;
    }
    // Not in the provider yet. Closed as empty, a summary the recording run
    // still sends would book journals no marker names, and their members
    // would then push again on their own. Failed keeps the record: a later
    // run reopens the marker and looks again before it pushes.
    await failOperation(client, {
      id: operation.id,
      companyId: operation.companyId,
      attemptCount: operation.attemptCount,
      errorMessage:
        "The day's summary journal was recorded but is not in Xero yet; a later run looks for it again",
      metadata: operation.metadata ?? {}
    });
  }

  return summary;
}

export const accountingConsolidationFunction = inngest.createFunction(
  { id: "accounting-consolidation", retries: 3 },
  { cron: "0 2 * * *" }, // 02:00 UTC daily
  async ({ step }) => {
    const client = getCarbonServiceRole();

    // Companies with an ACTIVE accounting integration whose posting-sync
    // settings resolve to enabled + daily consolidation
    const targets = await step.run(
      "find-daily-consolidation-targets",
      async () => {
        // Xero-only: the consolidation path calls Xero-specific provider
        // methods (createManualJournal). QBO/Rillet posting sync supports
        // "individual" mode only; widening this filter requires a
        // per-provider consolidation push.
        const integrations = await client
          .from("companyIntegration")
          .select("id, companyId, metadata, updatedBy")
          .eq("id", ProviderID.XERO)
          .eq("active", true);

        if (integrations.error) {
          throw new Error(
            `Failed to list accounting integrations: ${integrations.error.message}`
          );
        }

        return (integrations.data ?? [])
          .filter((row) => {
            if (!isAccountingSyncEnabled(row.metadata)) return false;
            const settings = resolvePostingSyncSettings(row.metadata);
            return (
              settings.consolidation === "daily" ||
              hasDailySummarySourceTypes(settings)
            );
          })
          .map((row) => ({
            companyId: row.companyId,
            providerId: row.id,
            updatedBy: row.updatedBy
          }));
      }
    );

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<
      {
        companyId: string;
        providerId: string;
      } & IsolatedStepOutcome<ConsolidationSummary>
    > = [];

    for (const target of targets) {
      const result = await runIsolatedCompanyStep({
        step,
        client,
        id: `consolidate-${target.companyId}-${target.providerId}`,
        target,
        fn: async () => {
          const database = getJobDatabaseClient();
          return await consolidateCompany({
            companyId: target.companyId,
            providerId: target.providerId as ProviderID,
            database
          });
        }
      });

      results.push({
        companyId: target.companyId,
        providerId: target.providerId,
        ...result
      });
    }

    return { targets: targets.length, results };
  }
);
