/**
 * Weekly reconciliation cron (posting sync, v3 spec §5 / v4 Pillar E) —
 * presence drift detection plus the per-period × per-account tie-out.
 *
 * Every Monday 03:00 UTC, per active accounting connection (any provider)
 * with posting sync enabled:
 *
 * (a) PRESENCE — page the last 90 days of Completed journalEntry
 *     operations (via getSyncOperations, newest first) and verify each
 *     distinct externalId still exists remotely via the provider-agnostic
 *     fetchRemoteJournalTotals (Xero manual journals, QBO journal entries,
 *     Rillet journal entries). Missing, voided or deleted provider
 *     journals produce `{ type: "missing", externalId, journalId, amount? }`
 *     drift entries, stored at
 *     `companyIntegration.metadata.settings.postingSync.lastReconciliation`
 *     as `{ runAt, drift }` (the SyncActivity banner's feed). Fetches are
 *     paced (batches of 50, ~1s pause) against provider rate limits and
 *     capped at 250 ids per run (newest first, logged when truncated).
 *
 * (b) TIE-OUT — for accounting periods overlapping
 *     [postingSync.syncFromDate ?? 90 days back, today], compute one
 *     "accountingSyncTieOut" row per (period × account):
 *
 *     - carbonPostedAmount: net debit-signed journalLine sums of every
 *       Posted/Reversed journal whose postingDate falls in the period
 *       (signs via toDebitSignedAmount on the account's class);
 *     - synced/docBacked/excluded/pending/blocked: the same line sums
 *       split by each journal's sync disposition (its ledger operations,
 *       normal + :reversal; least-delivered bucket wins; DOC_BACKED only
 *       counts delivered while the backing document really synced);
 *     - providerAmount: the remote journals' debit-signed per-account
 *       sums, reusing the presence check's fetches (never fetched twice)
 *       and mapped back to Carbon accounts via the account-mapping rows;
 *       NULL for cells no successful fetch covered;
 *     - internalDelta = carbonPosted − (synced+docBacked+excluded+
 *       pending+blocked); externalDelta = synced − provider.
 *
 *     Rows upsert on the (companyId, integration, accountingPeriodId,
 *     accountId) cell via the service role — the table has no write RLS.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  fetchRemoteJournalTotals,
  getAccountingIntegration,
  getJournalEntrySyncEntityId,
  getProviderIntegration,
  getSyncOperations,
  ProviderID,
  parseJournalEntrySyncEntityId,
  RatelimitError,
  type RemoteJournalTotals,
  resolvePostingSyncSettings,
  type SyncContext,
  type SyncOperation,
  toDebitSignedAmount,
  toPostingDateString
} from "@carbon/ee/accounting";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  buildRemoteAccountRefIndex,
  computeTieOutDeltas,
  DOC_BACKED_ERROR_CODE,
  findAccountingPeriodForDate,
  foldTieOutBuckets,
  getBackingDocumentEntityType,
  getLatestOperationsByEntityId,
  getNettedPositiveCents,
  getOperationTieOutBucket,
  getPositiveCents,
  getSyncOperationActor,
  getTieOutScopeStart,
  getUtcDateString,
  isBackingDocumentDelivered,
  isDailyConsolidationMarker,
  mergePostingSyncReconciliation,
  type ReconciliationDriftEntry,
  type ReconciliationReport,
  type TieOutBucket,
  type TieOutCellCents,
  type TieOutPeriod,
  toIsoDateString
} from "./accounting-sync-operations";

export const RECONCILIATION_WINDOW_DAYS = 90;

/** Distinct provider journals verified per run (newest first). */
const MAX_PRESENCE_CHECKS = 250;
/** Pause between presence-check batches (Xero allows 60 calls/min). */
const PRESENCE_BATCH_SIZE = 50;
const PRESENCE_BATCH_PAUSE_MS = 1_100;

const OPERATIONS_PAGE_SIZE = 100;
const MAX_OPERATION_PAGES = 50;
/**
 * Paging is ordered by createdAt but the window filters on completedAt; an
 * operation can complete long after it was created (retries), so paging
 * only stops once rows are 30 days older than the window.
 */
const PAGING_SLACK_DAYS = 30;

const JOURNAL_ID_CHUNK_SIZE = 300;

/** Tie-out scan bounds: pages of posted journals, capped per run. */
const TIE_OUT_JOURNAL_PAGE_SIZE = 500;
const MAX_TIE_OUT_JOURNAL_PAGES = 40;
const TIE_OUT_ENTITY_ID_CHUNK_SIZE = 200;
const TIE_OUT_UPSERT_CHUNK_SIZE = 200;

type ReconciliationSummary = {
  operations: number;
  externalIds: number;
  checkedExternalIds: number;
  missing: number;
  tieOutCells: number;
  truncated: boolean;
  skippedReason?: string;
};

type CarbonJournalData = {
  postingDate: string | null;
  lines: Array<{ accountId: string | null; amount: number }>;
};

// Same Json-vs-Record cast rationale as core/operations.ts
// syncOperationTable: the generated types either don't carry the table yet
// (accountingSyncTieOut, migration pending) or trade the cast for metadata
// typing friction. Row payloads are typed locally.
function syncOperationTable(
  client: ReturnType<typeof getCarbonServiceRole>
): any {
  return client.from("accountingSyncOperation" as any);
}

function tieOutTable(client: ReturnType<typeof getCarbonServiceRole>): any {
  return client.from("accountingSyncTieOut" as any);
}

async function getCarbonJournalData(
  database: SyncContext["database"],
  companyId: string,
  journalIds: string[]
): Promise<Map<string, CarbonJournalData>> {
  const byJournalId = new Map<string, CarbonJournalData>();

  for (let i = 0; i < journalIds.length; i += JOURNAL_ID_CHUNK_SIZE) {
    const chunk = journalIds.slice(i, i + JOURNAL_ID_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const journals = await database
      .selectFrom("journal")
      .select(["id", "postingDate"])
      .where("companyId", "=", companyId)
      .where("id", "in", chunk)
      .execute();

    for (const journal of journals) {
      byJournalId.set(journal.id, {
        postingDate: toIsoDateString(journal.postingDate),
        lines: []
      });
    }

    const lines = await database
      .selectFrom("journalLine")
      .select(["journalId", "accountId", "amount"])
      .where("companyId", "=", companyId)
      .where("journalId", "in", chunk)
      .execute();

    for (const line of lines) {
      if (!line.journalId) continue;
      byJournalId.get(line.journalId)?.lines.push({
        accountId: line.accountId ?? null,
        amount: Number(line.amount) || 0
      });
    }
  }

  return byJournalId;
}

/**
 * Page the last window of Completed journalEntry push operations that carry
 * an externalId, newest first.
 */
async function getCompletedJournalOperations(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; integration: string; windowStart: Date }
): Promise<SyncOperation[]> {
  const collected: SyncOperation[] = [];
  const stopBefore = new Date(
    args.windowStart.getTime() - PAGING_SLACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const windowStartIso = args.windowStart.toISOString();

  for (let page = 0; page < MAX_OPERATION_PAGES; page++) {
    const result = await getSyncOperations(client, {
      companyId: args.companyId,
      integration: args.integration,
      status: "Completed",
      entityType: "journalEntry",
      limit: OPERATIONS_PAGE_SIZE,
      offset: page * OPERATIONS_PAGE_SIZE
    });

    if (result.error) {
      throw new Error(`Failed to page sync operations: ${result.error}`);
    }
    if (result.data.length === 0) break;

    for (const operation of result.data) {
      if (operation.direction !== "push-to-accounting") continue;
      if (!operation.externalId) continue;
      if (!operation.completedAt || operation.completedAt < windowStartIso) {
        continue;
      }
      collected.push(operation);
    }

    const pastWindow = result.data.every(
      (operation) => operation.createdAt < stopBefore
    );
    if (pastWindow || result.data.length < OPERATIONS_PAGE_SIZE) break;
  }

  return collected;
}

/**
 * All journalEntry push operations (any status) for the given sync entity
 * ids — the disposition source for the tie-out buckets.
 */
async function getJournalDispositionOperations(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; integration: string; entityIds: string[] }
): Promise<SyncOperation[]> {
  const collected: SyncOperation[] = [];

  for (
    let i = 0;
    i < args.entityIds.length;
    i += TIE_OUT_ENTITY_ID_CHUNK_SIZE
  ) {
    const chunk = args.entityIds.slice(i, i + TIE_OUT_ENTITY_ID_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const result = await syncOperationTable(client)
      .select("*")
      .eq("companyId", args.companyId)
      .eq("integration", args.integration)
      .eq("entityType", "journalEntry")
      .eq("direction", "push-to-accounting")
      .in("entityId", chunk);

    if (result.error) {
      throw new Error(
        `Failed to load journal sync operations: ${result.error.message}`
      );
    }
    collected.push(...((result.data ?? []) as SyncOperation[]));
  }

  return collected;
}

/**
 * Delivery state per backing document (`entityType:entityId` → delivered):
 * delivered when the document's own latest push operation is Completed OR
 * the document already carries an external mapping.
 */
async function getBackingDocumentDelivery(
  client: ReturnType<typeof getCarbonServiceRole>,
  database: SyncContext["database"],
  args: {
    companyId: string;
    integration: string;
    docs: Array<{ entityType: string; entityId: string }>;
  }
): Promise<Map<string, boolean>> {
  const idsByType = new Map<string, Set<string>>();
  for (const doc of args.docs) {
    const ids = idsByType.get(doc.entityType) ?? new Set<string>();
    ids.add(doc.entityId);
    idsByType.set(doc.entityType, ids);
  }

  const delivered = new Map<string, boolean>();

  for (const [entityType, idSet] of idsByType) {
    const ids = [...idSet];

    const operations: SyncOperation[] = [];
    for (let i = 0; i < ids.length; i += TIE_OUT_ENTITY_ID_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + TIE_OUT_ENTITY_ID_CHUNK_SIZE);
      const result = await syncOperationTable(client)
        .select("*")
        .eq("companyId", args.companyId)
        .eq("integration", args.integration)
        .eq("entityType", entityType)
        .eq("direction", "push-to-accounting")
        .in("entityId", chunk);

      if (result.error) {
        throw new Error(
          `Failed to load ${entityType} sync operations: ${result.error.message}`
        );
      }
      operations.push(...((result.data ?? []) as SyncOperation[]));
    }
    const latestById = getLatestOperationsByEntityId(operations);

    const mappedIds = new Set<string>();
    for (let i = 0; i < ids.length; i += TIE_OUT_ENTITY_ID_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + TIE_OUT_ENTITY_ID_CHUNK_SIZE);
      const rows = await database
        .selectFrom("externalIntegrationMapping")
        .select(["entityId"])
        .where("companyId", "=", args.companyId)
        .where("integration", "=", args.integration)
        .where("entityType", "=", entityType)
        .where("entityId", "in", chunk)
        .where("externalId", "is not", null)
        .execute();
      for (const row of rows) mappedIds.add(row.entityId);
    }

    for (const id of ids) {
      delivered.set(
        `${entityType}:${id}`,
        isBackingDocumentDelivered({
          latestOperationStatus: latestById.get(id)?.status ?? null,
          hasExternalMapping: mappedIds.has(id)
        })
      );
    }
  }

  return delivered;
}

type TieOutJournal = {
  id: string;
  postingDate: string | null;
  reversalOfId: string | null;
  lines: Array<{
    accountId: string | null;
    amount: number;
    documentId: string | null;
  }>;
};

/**
 * Compute and upsert the tie-out cells for one company + provider.
 * Returns the number of cells written. Makes NO provider calls — the
 * external side reuses the presence check's fetches.
 */
async function computeTieOutForCompany(args: {
  client: ReturnType<typeof getCarbonServiceRole>;
  database: SyncContext["database"];
  companyId: string;
  providerId: ProviderID;
  syncFromDate: string | null;
  createdBy: string;
  operationsByExternalId: Map<string, SyncOperation[]>;
  carbonJournals: Map<string, CarbonJournalData>;
  fetchedByExternalId: Map<string, RemoteJournalTotals | null>;
}): Promise<number> {
  const { client, database, companyId, providerId } = args;

  const todayIso = getUtcDateString();
  const scopeStart = getTieOutScopeStart({
    todayIso,
    syncFromDate: args.syncFromDate
  });

  const periodRows = await database
    .selectFrom("accountingPeriod")
    .select(["id", "startDate", "endDate"])
    .where("companyId", "=", companyId)
    .where("startDate", "<=", todayIso)
    .where("endDate", ">=", scopeStart)
    .orderBy("startDate", "asc")
    .execute();

  const periods: TieOutPeriod[] = periodRows.map((row) => ({
    id: row.id,
    startDate: toPostingDateString(row.startDate),
    endDate: toPostingDateString(row.endDate)
  }));
  if (periods.length === 0) return 0;

  const minStart = periods[0]?.startDate ?? scopeStart;
  let maxEnd = periods[0]?.endDate ?? todayIso;
  for (const period of periods) {
    if (period.endDate > maxEnd) maxEnd = period.endDate;
  }

  // ── Posted journals in scope, with lines + account classes ───────────────
  const journals: TieOutJournal[] = [];
  const journalsById = new Map<string, TieOutJournal>();

  for (let page = 0; page < MAX_TIE_OUT_JOURNAL_PAGES; page++) {
    const rows = await database
      .selectFrom("journal")
      .select(["id", "postingDate", "reversalOfId"])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Posted", "Reversed"])
      .where("postingDate", ">=", minStart)
      .where("postingDate", "<=", maxEnd)
      .orderBy("id", "asc")
      .limit(TIE_OUT_JOURNAL_PAGE_SIZE)
      .offset(page * TIE_OUT_JOURNAL_PAGE_SIZE)
      .execute();

    for (const row of rows) {
      const journal: TieOutJournal = {
        id: row.id,
        postingDate:
          row.postingDate == null ? null : toPostingDateString(row.postingDate),
        reversalOfId: row.reversalOfId ?? null,
        lines: []
      };
      journals.push(journal);
      journalsById.set(journal.id, journal);
    }

    if (rows.length < TIE_OUT_JOURNAL_PAGE_SIZE) break;
    if (page === MAX_TIE_OUT_JOURNAL_PAGES - 1) {
      console.warn(
        `[RECONCILIATION] ${companyId}/${providerId}: tie-out journal scan truncated at ${journals.length} journals`
      );
    }
  }

  if (journals.length === 0) return 0;

  const journalIds = journals.map((journal) => journal.id);
  for (let i = 0; i < journalIds.length; i += JOURNAL_ID_CHUNK_SIZE) {
    const chunk = journalIds.slice(i, i + JOURNAL_ID_CHUNK_SIZE);
    const lines = await database
      .selectFrom("journalLine")
      .select(["journalId", "accountId", "amount", "documentId"])
      .where("companyId", "=", companyId)
      .where("journalId", "in", chunk)
      .execute();

    for (const line of lines) {
      if (!line.journalId) continue;
      journalsById.get(line.journalId)?.lines.push({
        accountId: line.accountId ?? null,
        amount: Number(line.amount) || 0,
        documentId: line.documentId ?? null
      });
    }
  }

  const accountIds = [
    ...new Set(
      journals
        .flatMap((journal) => journal.lines.map((line) => line.accountId))
        .filter((accountId): accountId is string => accountId !== null)
    )
  ];
  const accountClassById = new Map<string, string | null>();
  for (let i = 0; i < accountIds.length; i += JOURNAL_ID_CHUNK_SIZE) {
    const chunk = accountIds.slice(i, i + JOURNAL_ID_CHUNK_SIZE);
    // account is company-GROUP scoped (companyGroupId, no companyId); the
    // ids come from this company's own journal lines, so id alone is safe
    const rows = await database
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", chunk)
      .execute();
    for (const row of rows) {
      accountClassById.set(row.id, row.class ?? null);
    }
  }

  // ── Dispositions: latest operation per sync entity id ────────────────────
  // An original journal is covered by its own operation (plus a :reversal
  // one once reversed); a reversal journal ROW (reversalOfId set) is
  // represented by the ORIGINAL journal's :reversal operation — reversal
  // inserts never enqueue their own (getJournalPostingDecision).
  const candidateEntityIds = new Set<string>();
  for (const journal of journals) {
    if (journal.reversalOfId) {
      candidateEntityIds.add(
        getJournalEntrySyncEntityId(journal.reversalOfId, true)
      );
    } else {
      candidateEntityIds.add(getJournalEntrySyncEntityId(journal.id, false));
      candidateEntityIds.add(getJournalEntrySyncEntityId(journal.id, true));
    }
  }
  const dispositionOps = await getJournalDispositionOperations(client, {
    companyId,
    integration: providerId,
    entityIds: [...candidateEntityIds]
  });
  const latestByEntityId = getLatestOperationsByEntityId(dispositionOps);

  // DOC_BACKED delivery: backing document id = the journal's lines'
  // documentId (bill → purchaseInvoice id, invoice → salesInvoice id);
  // entity type from the operation's metadata.backingDocument.
  const backingDocByOpEntityId = new Map<
    string,
    { entityType: string; entityId: string }
  >();
  for (const [entityId, operation] of latestByEntityId) {
    if (
      operation.status !== "Excluded" ||
      operation.errorCode !== DOC_BACKED_ERROR_CODE
    ) {
      continue;
    }
    const backingType = getBackingDocumentEntityType(operation.metadata);
    if (!backingType) continue;

    const { journalId } = parseJournalEntrySyncEntityId(entityId);
    const documentId =
      journalsById
        .get(journalId)
        ?.lines.find((line) => line.documentId !== null)?.documentId ?? null;
    if (!documentId) continue;

    backingDocByOpEntityId.set(entityId, {
      entityType: backingType,
      entityId: documentId
    });
  }
  const deliveredByDoc = await getBackingDocumentDelivery(client, database, {
    companyId,
    integration: providerId,
    docs: [...backingDocByOpEntityId.values()]
  });

  // ── Carbon-side cells: posted totals + disposition buckets ───────────────
  const cellKey = (periodId: string, accountId: string) =>
    `${periodId}::${accountId}`;
  const addCents = (cells: Map<string, number>, key: string, cents: number) => {
    cells.set(key, (cells.get(key) ?? 0) + cents);
  };

  const carbonPostedCells = new Map<string, number>();
  const bucketCells: Record<TieOutBucket, Map<string, number>> = {
    synced: new Map(),
    docBacked: new Map(),
    excluded: new Map(),
    pending: new Map(),
    blocked: new Map()
  };

  for (const journal of journals) {
    const period = findAccountingPeriodForDate(periods, journal.postingDate);
    if (!period) continue;

    const candidates = journal.reversalOfId
      ? [getJournalEntrySyncEntityId(journal.reversalOfId, true)]
      : [
          getJournalEntrySyncEntityId(journal.id, false),
          getJournalEntrySyncEntityId(journal.id, true)
        ];

    const buckets: TieOutBucket[] = [];
    for (const entityId of candidates) {
      const operation = latestByEntityId.get(entityId);
      if (!operation) continue;
      const backingDoc = backingDocByOpEntityId.get(entityId);
      const docBackedDelivered = backingDoc
        ? (deliveredByDoc.get(
            `${backingDoc.entityType}:${backingDoc.entityId}`
          ) ?? false)
        : false;
      buckets.push(getOperationTieOutBucket(operation, { docBackedDelivered }));
    }
    const bucket = foldTieOutBuckets(buckets);

    for (const line of journal.lines) {
      if (!line.accountId) continue;
      const cents = Math.round(
        toDebitSignedAmount(accountClassById.get(line.accountId), line.amount) *
          100
      );
      const key = cellKey(period.id, line.accountId);
      addCents(carbonPostedCells, key, cents);
      addCents(bucketCells[bucket], key, cents);
    }
  }

  // ── Provider-side cells: reuse the presence check's fetches ──────────────
  const accountMappingRows = await database
    .selectFrom("externalIntegrationMapping")
    .select(["entityId", "externalId", "metadata"])
    .where("companyId", "=", companyId)
    .where("integration", "=", providerId)
    .where("entityType", "=", "account")
    .orderBy("entityId", "asc")
    .execute();
  const remoteRefIndex = buildRemoteAccountRefIndex(accountMappingRows);

  const reversalRowByOriginalId = new Map<string, TieOutJournal>();
  for (const journal of journals) {
    if (journal.reversalOfId) {
      reversalRowByOriginalId.set(journal.reversalOfId, journal);
    }
  }

  const providerCells = new Map<string, number>();
  for (const [externalId, group] of args.operationsByExternalId) {
    const totals = args.fetchedByExternalId.get(externalId);
    if (!totals || !totals.found) continue;

    // The posting date of what this provider journal represents: ordinary
    // ops → the journal row's posting date; reversal ops → the reversal
    // journal ROW's date (that's the row whose lines land in the buckets);
    // consolidation markers → metadata.postingDate.
    let postingDate: string | null = null;
    for (const operation of group) {
      if (isDailyConsolidationMarker(operation.entityId)) {
        if (typeof operation.metadata?.postingDate === "string") {
          postingDate = operation.metadata.postingDate;
          break;
        }
        continue;
      }
      const { journalId, reversal } = parseJournalEntrySyncEntityId(
        operation.entityId
      );
      if (reversal) {
        postingDate =
          reversalRowByOriginalId.get(journalId)?.postingDate ??
          journalsById.get(journalId)?.postingDate ??
          args.carbonJournals.get(journalId)?.postingDate ??
          null;
      } else {
        postingDate =
          journalsById.get(journalId)?.postingDate ??
          args.carbonJournals.get(journalId)?.postingDate ??
          null;
      }
      if (postingDate) break;
    }

    const period = findAccountingPeriodForDate(periods, postingDate);
    if (!period) continue;

    for (const [ref, amount] of totals.debitTotalsByAccountRef) {
      const accountId = remoteRefIndex.get(ref);
      if (!accountId) continue;
      addCents(
        providerCells,
        cellKey(period.id, accountId),
        Math.round(amount * 100)
      );
    }
  }

  // ── Upsert cells ─────────────────────────────────────────────────────────
  const allKeys = new Set<string>([
    ...carbonPostedCells.keys(),
    ...bucketCells.synced.keys(),
    ...bucketCells.docBacked.keys(),
    ...bucketCells.excluded.keys(),
    ...bucketCells.pending.keys(),
    ...bucketCells.blocked.keys(),
    ...providerCells.keys()
  ]);
  if (allKeys.size === 0) return 0;

  const nowIso = new Date().toISOString();
  const rows = [...allKeys].map((key) => {
    const [periodId = "", accountId = ""] = key.split("::");
    const cents: TieOutCellCents = {
      carbonPostedCents: carbonPostedCells.get(key) ?? 0,
      syncedCents: bucketCells.synced.get(key) ?? 0,
      docBackedCents: bucketCells.docBacked.get(key) ?? 0,
      excludedCents: bucketCells.excluded.get(key) ?? 0,
      pendingCents: bucketCells.pending.get(key) ?? 0,
      blockedCents: bucketCells.blocked.get(key) ?? 0,
      providerCents: providerCells.has(key)
        ? (providerCells.get(key) ?? 0)
        : null
    };
    const { internalDeltaCents, externalDeltaCents } =
      computeTieOutDeltas(cents);

    return {
      companyId,
      integration: providerId,
      accountingPeriodId: periodId,
      accountId,
      carbonPostedAmount: cents.carbonPostedCents / 100,
      syncedAmount: cents.syncedCents / 100,
      docBackedAmount: cents.docBackedCents / 100,
      excludedAmount: cents.excludedCents / 100,
      pendingAmount: cents.pendingCents / 100,
      blockedAmount: cents.blockedCents / 100,
      providerAmount:
        cents.providerCents === null ? null : cents.providerCents / 100,
      internalDelta: internalDeltaCents / 100,
      externalDelta:
        externalDeltaCents === null ? null : externalDeltaCents / 100,
      computedAt: nowIso,
      createdBy: args.createdBy,
      updatedBy: args.createdBy,
      updatedAt: nowIso
    };
  });

  for (let i = 0; i < rows.length; i += TIE_OUT_UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + TIE_OUT_UPSERT_CHUNK_SIZE);
    const upserted = await tieOutTable(client).upsert(chunk, {
      onConflict: "companyId,integration,accountingPeriodId,accountId"
    });
    if (upserted.error) {
      throw new Error(
        `Failed to upsert tie-out cells: ${upserted.error.message}`
      );
    }
  }

  return rows.length;
}

async function reconcileCompany(args: {
  companyId: string;
  providerId: ProviderID;
  database: SyncContext["database"];
}): Promise<ReconciliationSummary> {
  const { companyId, providerId, database } = args;
  const client = getCarbonServiceRole();

  const summary: ReconciliationSummary = {
    operations: 0,
    externalIds: 0,
    checkedExternalIds: 0,
    missing: 0,
    tieOutCells: 0,
    truncated: false
  };

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  const settings = resolvePostingSyncSettings(integration.metadata);

  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  );

  const runAt = new Date().toISOString();
  const windowStart = new Date(
    Date.now() - RECONCILIATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  // ── Window of pushed operations, grouped by provider journal ─────────────
  const operations = await getCompletedJournalOperations(client, {
    companyId,
    integration: providerId,
    windowStart
  });
  summary.operations = operations.length;

  const operationsByExternalId = new Map<string, SyncOperation[]>();
  for (const operation of operations) {
    if (!operation.externalId) continue;
    const group = operationsByExternalId.get(operation.externalId);
    if (group) {
      group.push(operation);
    } else {
      operationsByExternalId.set(operation.externalId, [operation]);
    }
  }
  summary.externalIds = operationsByExternalId.size;

  // ── Carbon-side journal data for every member operation ──────────────────
  const memberJournalIds = [
    ...new Set(
      operations
        .filter((operation) => !isDailyConsolidationMarker(operation.entityId))
        .map(
          (operation) =>
            parseJournalEntrySyncEntityId(operation.entityId).journalId
        )
    )
  ];
  const carbonJournals = await getCarbonJournalData(
    database,
    companyId,
    memberJournalIds
  );

  // ── Presence check: fetch each distinct provider journal once ────────────
  const externalIds = [...operationsByExternalId.keys()];
  if (externalIds.length > MAX_PRESENCE_CHECKS) {
    summary.truncated = true;
    console.warn(
      `[RECONCILIATION] ${companyId}/${providerId}: ${externalIds.length} provider journals in the window; checking the newest ${MAX_PRESENCE_CHECKS}`
    );
  }
  const idsToCheck = externalIds.slice(0, MAX_PRESENCE_CHECKS);

  // externalId → fetched totals (null = confirmed missing/voided/deleted;
  // absent from the map = never checked, excluded from every comparison)
  const fetchedByExternalId = new Map<string, RemoteJournalTotals | null>();

  for (let i = 0; i < idsToCheck.length; i++) {
    const externalId = idsToCheck[i];
    if (!externalId) continue;

    if (i > 0 && i % PRESENCE_BATCH_SIZE === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, PRESENCE_BATCH_PAUSE_MS)
      );
    }

    try {
      const totals = await fetchRemoteJournalTotals(provider, externalId);
      fetchedByExternalId.set(externalId, totals.found ? totals : null);
    } catch (error) {
      if (error instanceof RatelimitError) {
        // Stop fetching — report on what was verified rather than failing
        // the run; unchecked ids are excluded from every comparison so
        // nothing is falsely reported missing
        summary.truncated = true;
        console.warn(
          `[RECONCILIATION] ${companyId}/${providerId}: rate limited after ${fetchedByExternalId.size} presence checks; reporting on the verified subset`
        );
        break;
      }
      throw error;
    }
  }
  summary.checkedExternalIds = fetchedByExternalId.size;

  // ── Presence drift: journals Carbon pushed that the provider lost ────────
  const missingDrift: ReconciliationDriftEntry[] = [];

  for (const [externalId, group] of operationsByExternalId) {
    if (!fetchedByExternalId.has(externalId)) continue; // never checked
    if (fetchedByExternalId.get(externalId) !== null) continue; // exists

    const memberOps = group.filter(
      (operation) => !isDailyConsolidationMarker(operation.entityId)
    );
    const markerOp = group.find((operation) =>
      isDailyConsolidationMarker(operation.entityId)
    );
    const consolidated =
      !!markerOp ||
      memberOps.some(
        (operation) => operation.metadata?.consolidatedInto != null
      );

    // Carbon-side debit total for the missing provider journal
    const memberLines: Array<{ accountId: string | null; amount: number }> = [];
    let rawPositiveCents = 0;
    let membersResolved = 0;

    for (const operation of memberOps) {
      const { journalId, reversal } = parseJournalEntrySyncEntityId(
        operation.entityId
      );
      const data = carbonJournals.get(journalId);
      if (!data) continue;

      membersResolved++;
      const lines = reversal
        ? data.lines.map((line) => ({ ...line, amount: -line.amount }))
        : data.lines;
      memberLines.push(...lines);
      rawPositiveCents += getPositiveCents(lines);
    }

    const carbonCents =
      membersResolved > 0
        ? consolidated
          ? getNettedPositiveCents(memberLines)
          : rawPositiveCents
        : null;

    const journalId =
      memberOps[0]?.entityId ?? markerOp?.entityId ?? externalId;
    missingDrift.push({
      type: "missing",
      externalId,
      journalId,
      ...(carbonCents !== null ? { amount: carbonCents / 100 } : {})
    });
  }
  summary.missing = missingDrift.length;

  // ── Tie-out: per-period × per-account cells (no extra provider calls) ────
  summary.tieOutCells = await computeTieOutForCompany({
    client,
    database,
    companyId,
    providerId,
    syncFromDate: settings.syncFromDate ?? null,
    createdBy: getSyncOperationActor(integration),
    operationsByExternalId,
    carbonJournals,
    fetchedByExternalId
  });

  await storeReconciliationReport(client, {
    companyId,
    providerId,
    report: { runAt, drift: missingDrift }
  });

  return summary;
}

/**
 * Read-modify-write against the RAW stored metadata (not the zod-parsed
 * copy from getAccountingIntegration, which strips unknown keys) so no
 * sibling key can be clobbered.
 */
async function storeReconciliationReport(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: {
    companyId: string;
    providerId: string;
    report: ReconciliationReport;
  }
): Promise<void> {
  const current = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", args.providerId)
    .eq("companyId", args.companyId)
    .single();

  if (current.error) {
    throw new Error(
      `Failed to read integration metadata: ${current.error.message}`
    );
  }

  const merged = mergePostingSyncReconciliation(
    current.data?.metadata,
    args.report
  );

  const updated = await client
    .from("companyIntegration")
    .update({ metadata: merged as any })
    .eq("id", args.providerId)
    .eq("companyId", args.companyId);

  if (updated.error) {
    throw new Error(
      `Failed to store reconciliation report: ${updated.error.message}`
    );
  }
}

export const accountingReconciliationFunction = inngest.createFunction(
  { id: "accounting-reconciliation", retries: 2 },
  { cron: "0 3 * * 1" }, // Mondays 03:00 UTC
  async ({ step }) => {
    const client = getCarbonServiceRole();

    const targets = await step.run("find-posting-sync-targets", async () => {
      // Every accounting provider: the reconciliation reader goes through
      // the provider-agnostic fetchRemoteJournalTotals dispatcher.
      const integrations = await client
        .from("companyIntegration")
        .select("id, companyId, metadata")
        .in("id", Object.values(ProviderID))
        .eq("active", true);

      if (integrations.error) {
        throw new Error(
          `Failed to list accounting integrations: ${integrations.error.message}`
        );
      }

      return (integrations.data ?? [])
        .filter((row) => resolvePostingSyncSettings(row.metadata).enabled)
        .map((row) => ({ companyId: row.companyId, providerId: row.id }));
    });

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<
      { companyId: string; providerId: string } & ReconciliationSummary
    > = [];

    for (const target of targets) {
      const result = await step.run(
        `reconcile-${target.companyId}-${target.providerId}`,
        async () => {
          const pool = getPostgresConnectionPool(5);
          const database = getPostgresClient(pool, PostgresDriver);
          try {
            return await reconcileCompany({
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
