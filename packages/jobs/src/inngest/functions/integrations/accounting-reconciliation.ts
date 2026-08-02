/**
 * Weekly reconciliation cron (posting sync, spec Phase B §8) — report-only
 * drift detection between Carbon's pushed journals and the provider.
 *
 * Every Monday 03:00 UTC, per active accounting connection with posting
 * sync enabled:
 *
 * (a) PRESENCE — page the last 90 days of Completed journalEntry
 *     operations (via getSyncOperations, newest first) and verify each
 *     distinct externalId still exists remotely via
 *     provider.getManualJournal. Missing, VOIDED or DELETED manual
 *     journals produce `{ type: "missing", externalId, journalId, amount? }`
 *     drift entries. Per-id GETs were chosen over adding a
 *     listManualJournals(modifiedSince) provider method: at v1 volumes
 *     (daily consolidation ≈ one journal per posting date) the id set is
 *     small, and per-id fetches are also exactly what the aggregate check
 *     needs. Fetches are paced (batches of 50, ~1s pause) against Xero's
 *     60/min limit and capped at 250 ids per run (newest first, logged
 *     when truncated).
 *
 * (b) AGGREGATE — per calendar month in the window, the sum of Carbon
 *     journal-line DEBITS for pushed journals is compared against the sum
 *     of the corresponding Xero manual-journal debit lines (from the same
 *     fetched set; both sides bucketed by the Carbon posting month so
 *     period-lock redating cannot fake drift). Consolidated batches
 *     re-derive what was booked by netting member lines per account —
 *     exactly how the daily aggregate was built — while individually
 *     pushed journals sum their raw debit lines. |diff| > 0.01 produces
 *     `{ type: "mismatch", month, carbonTotal, providerTotal }`.
 *     Journals already reported missing are excluded from both sides so
 *     one problem does not surface twice.
 *
 * The report is stored at
 * `companyIntegration.metadata.settings.postingSync.lastReconciliation`
 * as `{ runAt, drift }` (capped at 100 entries) through a read-modify-write
 * against the RAW stored metadata — credentials, syncConfig and every other
 * settings key survive untouched (mergePostingSyncReconciliation). The
 * Sync Activity tab surfaces the report; nothing is auto-repaired.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  getAccountingIntegration,
  getProviderIntegration,
  getSyncOperations,
  ProviderID,
  parseJournalEntrySyncEntityId,
  RatelimitError,
  resolvePostingSyncSettings,
  type SyncContext,
  type SyncOperation,
  type Xero,
  type XeroProvider
} from "@carbon/ee/accounting";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  compareMonthlyTotals,
  getNettedPositiveCents,
  getPositiveCents,
  isDailyConsolidationMarker,
  mergePostingSyncReconciliation,
  type ReconciliationDriftEntry,
  type ReconciliationReport,
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

type ReconciliationSummary = {
  operations: number;
  externalIds: number;
  checkedExternalIds: number;
  missing: number;
  mismatchedMonths: number;
  truncated: boolean;
  skippedReason?: string;
};

type CarbonJournalData = {
  postingDate: string | null;
  lines: Array<{ accountId: string | null; amount: number }>;
};

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
    mismatchedMonths: 0,
    truncated: false
  };

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  const settings = resolvePostingSyncSettings(integration.metadata);
  if (!settings.enabled) {
    return { ...summary, skippedReason: "posting sync not enabled" };
  }

  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  ) as XeroProvider;

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

  if (operationsByExternalId.size === 0) {
    await storeReconciliationReport(client, {
      companyId,
      providerId,
      report: { runAt, drift: [] }
    });
    return summary;
  }

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

  // externalId → fetched journal (null = confirmed missing/voided/deleted;
  // absent from the map = never checked, excluded from every comparison)
  const fetchedByExternalId = new Map<string, Xero.ManualJournal | null>();

  for (let i = 0; i < idsToCheck.length; i++) {
    const externalId = idsToCheck[i];
    if (!externalId) continue;

    if (i > 0 && i % PRESENCE_BATCH_SIZE === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, PRESENCE_BATCH_PAUSE_MS)
      );
    }

    try {
      const journal = await provider.getManualJournal(externalId);
      const voided =
        journal?.Status === "VOIDED" || journal?.Status === "DELETED";
      fetchedByExternalId.set(externalId, journal && !voided ? journal : null);
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

  // ── Build drift: presence + monthly aggregate ────────────────────────────
  const missingDrift: ReconciliationDriftEntry[] = [];
  const carbonCentsByMonth = new Map<string, number>();
  const providerCentsByMonth = new Map<string, number>();

  for (const [externalId, group] of operationsByExternalId) {
    if (!fetchedByExternalId.has(externalId)) continue; // never checked

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

    // Carbon-side debit total + posting month for this provider journal
    let carbonCents: number | null = null;
    let month: string | null = null;

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

      if (!month && data.postingDate) {
        month = data.postingDate.slice(0, 7);
      }
    }

    if (membersResolved > 0) {
      carbonCents = consolidated
        ? getNettedPositiveCents(memberLines)
        : rawPositiveCents;
    }
    if (!month && typeof markerOp?.metadata?.postingDate === "string") {
      month = markerOp.metadata.postingDate.slice(0, 7);
    }

    const remote = fetchedByExternalId.get(externalId) ?? null;

    if (!remote) {
      const journalId =
        memberOps[0]?.entityId ?? markerOp?.entityId ?? externalId;
      missingDrift.push({
        type: "missing",
        externalId,
        journalId,
        ...(carbonCents !== null ? { amount: carbonCents / 100 } : {})
      });
      continue; // missing journals stay out of the monthly comparison
    }

    if (month && carbonCents !== null) {
      carbonCentsByMonth.set(
        month,
        (carbonCentsByMonth.get(month) ?? 0) + carbonCents
      );
      const remoteDebitCents = getPositiveCents(
        (remote.JournalLines ?? []).map((line) => ({
          amount: line.LineAmount
        }))
      );
      providerCentsByMonth.set(
        month,
        (providerCentsByMonth.get(month) ?? 0) + remoteDebitCents
      );
    }
  }

  const mismatchDrift = compareMonthlyTotals({
    carbonCentsByMonth,
    providerCentsByMonth
  });

  summary.missing = missingDrift.length;
  summary.mismatchedMonths = mismatchDrift.length;

  await storeReconciliationReport(client, {
    companyId,
    providerId,
    report: { runAt, drift: [...mismatchDrift, ...missingDrift] }
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
      // Xero-only: the reconciliation reader calls Xero-specific provider
      // methods (getManualJournal). Widening this filter requires a
      // per-provider journal reader.
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
