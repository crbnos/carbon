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
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
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
  JournalEntrySyncError,
  type JournalEntrySyncer,
  mapJournalEntryToManualJournal,
  type PostingSyncSettings,
  ProviderID,
  parseJournalEntrySyncEntityId,
  RatelimitError,
  resolvePostingSyncSettings,
  runJournalEntryPreflight,
  type SyncContext,
  SyncFactory,
  type SyncOperation,
  type XeroProvider
} from "@carbon/ee/accounting";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
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

/** Same bound as the drain: 25 iterations × claim batch of 20 = 500 ops. */
const MAX_CLAIM_ITERATIONS = 25;

/** Pre-scan page size (aligned with the claim bound above). */
const PRESCAN_LIMIT = 500;

const JOURNAL_ID_CHUNK_SIZE = 300;

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
  const summary = emptySummary();

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  // Re-check the gate inside the step: settings may have changed between
  // enumeration and execution. The cron runs for pure-daily configs
  // (transitional v2 shims) AND for any config with daily-summary source
  // types (v3 per-source-type granularity).
  const settings: PostingSyncSettings = resolvePostingSyncSettings(
    integration.metadata
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

  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  ) as XeroProvider;

  const createdBy = getSyncOperationActor(integration);
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
  // individually instead
  const consolidatedBatchKeys = new Set<string>();
  const markersByBatchKey = new Map<string, SyncOperation>();

  for (const group of candidateGroups) {
    const marker = await enqueueMarker(group);
    if (marker.error || !marker.data) {
      throw new Error(
        `Failed to reserve consolidation marker for ${group.batchKey}: ${
          marker.error ?? "no row returned"
        }`
      );
    }
    if (marker.data.status === "Completed") {
      consolidatedBatchKeys.add(group.batchKey);
    } else {
      markersByBatchKey.set(group.batchKey, marker.data);
    }
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

  summary.held = partition.held.length;
  if (partition.held.length > 0) {
    console.info(
      `[CONSOLIDATION] Holding ${partition.held.length} journal operation(s) dated ${today} or later for ${companyId}/${providerId}; they become claimable again once stale`
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
  const pushIndividually = async (operations: SyncOperation[]) => {
    for (const operation of operations) {
      const syncResult = await syncer.pushToAccounting(operation.entityId);

      if (syncResult.status === "error") {
        summary.individualFailed++;
        await failOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
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
      errorMessage: `Journal ${operation.entityId} not found in Carbon`
    });
  }

  // ── 6. Individual pushes: reversals + late backdated members ─────────────
  await pushIndividually(partition.reversals);
  await pushIndividually(partition.individual);

  // ── 7. One aggregated push per candidate (source type, date) group ───────
  const processedMarkerIds = new Set<string>();

  for (const group of [...partition.byGroup.values()].sort((a, b) =>
    a.batchKey.localeCompare(b.batchKey)
  )) {
    const { batchKey, postingDate: date, operations } = group;

    let marker = markersByBatchKey.get(batchKey);
    if (!marker) {
      // Group surfaced by the claim race (enqueued between pre-scan and
      // claim) — reserve its marker now
      const lateMarker = await enqueueMarker(group);
      if (lateMarker.error || !lateMarker.data) {
        console.error(
          `[CONSOLIDATION] Could not reserve marker for late batch ${batchKey}; leaving ${operations.length} operation(s) In Flight for the next run`
        );
        continue;
      }
      if (lateMarker.data.status === "Completed") {
        await pushIndividually(operations);
        continue;
      }
      marker = lateMarker.data;
    }
    processedMarkerIds.add(marker.id);

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
        console.info(
          `[CONSOLIDATION] Skipping journal ${journal.id} for ${date}: ${skipReason}`
        );
        summary.membersSkipped++;
        await completeOperation(client, {
          id: operation.id,
          companyId: operation.companyId
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

      let externalId: string | undefined;

      if (aggregate.journal.lines.length > 0) {
        const payload = mapJournalEntryToManualJournal({
          journal: aggregate.journal,
          accountCodesById,
          pushDate: preflight.pushDate,
          redatedFromDate: preflight.redatedFromDate
        });
        const narration = preflight.redatedFromDate
          ? `${aggregate.narration} | original date ${preflight.redatedFromDate}`
          : aggregate.narration;

        const created = await provider.createManualJournal({
          ...payload,
          Narration: narration
        });
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

      const failure =
        error instanceof JournalEntrySyncError ? error.failure : null;
      const errorMessage =
        failure?.message ??
        (error instanceof Error ? error.message : String(error));

      summary.batchesFailed++;

      // Whole-batch failure: every member records the pre-flight errorCode
      // (Warning when user-fixable) plus the full member list
      for (const { operation } of members) {
        summary.membersFailed++;
        await failOperation(client, {
          id: operation.id,
          companyId: operation.companyId,
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
    }
  }

  // ── 8. Stray markers (claimed, but their date had no members this run —
  // e.g. a user retried an old marker row). Close them: the date is
  // settled and future arrivals push individually. ──────────────────────────
  for (const operation of partition.markers) {
    if (processedMarkerIds.has(operation.id)) continue;
    await completeOperation(client, {
      id: operation.id,
      companyId: operation.companyId,
      metadata: {
        ...(operation.metadata ?? {}),
        note: "Marker closed without members by the consolidation cron"
      }
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
          .select("id, companyId, metadata")
          .eq("id", ProviderID.XERO)
          .eq("active", true);

        if (integrations.error) {
          throw new Error(
            `Failed to list accounting integrations: ${integrations.error.message}`
          );
        }

        return (integrations.data ?? [])
          .filter((row) => {
            const settings = resolvePostingSyncSettings(row.metadata);
            return (
              settings.consolidation === "daily" ||
              hasDailySummarySourceTypes(settings)
            );
          })
          .map((row) => ({ companyId: row.companyId, providerId: row.id }));
      }
    );

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<
      { companyId: string; providerId: string } & ConsolidationSummary
    > = [];

    for (const target of targets) {
      const result = await step.run(
        `consolidate-${target.companyId}-${target.providerId}`,
        async () => {
          const pool = getPostgresConnectionPool(5);
          const database = getPostgresClient(pool, PostgresDriver);
          try {
            return await consolidateCompany({
              companyId: target.companyId,
              providerId: target.providerId as ProviderID,
              database
            });
          } finally {
            await pool.end();
          }
        }
      );

      results.push({
        companyId: target.companyId,
        providerId: target.providerId,
        ...result
      });
    }

    return { targets: targets.length, results };
  }
);
