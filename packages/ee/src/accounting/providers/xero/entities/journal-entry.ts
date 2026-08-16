import type { KyselyTx } from "@carbon/database/client";
import { getAccountMappings } from "../../../core/account-mapping";
import {
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  ensureDimensionValueExternalIds,
  getDimensionValueMappings,
  loadJournalLineDimensions,
  resolveDimensionValueLabels,
  upsertDimensionValueMapping
} from "../../../core/dimension-mapping";
import type { PostingSyncDimensionSlot } from "../../../core/models";
import {
  getPostingSyncSourceTypeSkipReason,
  JournalEntrySyncError,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  roundCurrency,
  runJournalEntryPreflight,
  toDebitSignedAmount,
  toPostingDateString
} from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type BatchSyncResult,
  type ShouldSyncContext,
  type SyncResult
} from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import { parseXeroTrackingTarget, type XeroProvider } from "../provider";

/**
 * JournalEntrySyncer — pushes Posted Carbon journals (`journal` +
 * `journalLine`) to Xero as Manual Journals. PUSH-ONLY: pull methods return
 * descriptive not-supported errors.
 *
 * Sign convention: Carbon `journalLine.amount` is signed (positive = debit,
 * negative = credit) and Xero manual-journal lines use the same convention
 * (positive LineAmount = debit) — matching the existing
 * InventoryAdjustmentSyncer. TODO: verify the sign convention against a
 * real/sandbox Xero manual journal before enabling for production
 * companies.
 *
 * Reversal contract (Task 10 sets it up): when a sync operation carries
 * `metadata.reversal: true`, the drain pushes entity id
 * `"<journal.id>:reversal"` (see getJournalEntrySyncEntityId). The syncer
 * then loads the ORIGINAL journal, requires status `Reversed` plus an
 * existing original mapping, negates every LineAmount, uses narration
 * `"Carbon reversal of <journalEntryId>"`, and stores the reversal's
 * mapping under the suffixed entity id — the original mapping is never
 * touched. (Carbon's reverseJournalEntry also inserts a separate negated
 * `Manual` journal; that row is inserted as Posted — never UPDATEd — so the
 * posting trigger does not enqueue it, and with `includeManual` off it is
 * excluded from backfills too.)
 *
 * Failure channel: pre-flight failures (UNMAPPED_ACCOUNTS,
 * CONTROL_ACCOUNT_LINE, PERIOD_LOCKED park, UNBALANCED_JOURNAL) throw
 * JournalEntrySyncError inside the mapping step; pushToAccounting converts
 * them to `SyncResult.error` carrying the structured
 * JournalEntrySyncFailure object (SyncResult.error is typed `unknown` for
 * this). The drain detects them with isJournalEntrySyncFailure and records
 * them via failOperation({ errorCode, errorMessage, warning }). shouldSync
 * gates (wrong status, disabled posting sync, excluded sourceType, already
 * mapped) keep the existing skip-reason-string channel
 * (`SyncResult.status === "skipped"`).
 *
 * Consolidation-aware: the syncer resolves the full posting-sync settings
 * (including `consolidation`) from
 * `companyIntegration.metadata.settings.postingSync` — the drain reads
 * getPostingSyncSettings() to hold journal operations for the daily
 * consolidation cron instead of pushing them individually.
 */

/**
 * Map one Carbon journal to a Xero manual-journal payload. Pure — exported
 * for tests and for the daily-consolidation cron (Task 12).
 *
 * - Lines: LineAmount = signed Carbon amount (negated for reversals),
 *   AccountCode from the account mapping, Description = line description
 *   falling back to the journal description, TaxType "NONE" (tax mapping is
 *   out of scope v1).
 * - Narration: "Carbon <journalEntryId> <journal.id>" (or
 *   "Carbon reversal of <journalEntryId>"), with
 *   " | original date <postingDate>" appended when the period-lock redate
 *   policy moved the push date.
 */
/**
 * Slot config + resolved option ids for the Xero journal mapper: `slots`
 * carry `tracking:<TrackingCategoryID>` targets; `optionIdsByValue`
 * resolves `<dimensionId>:<valueId>` → TrackingOptionID. Slotted line
 * dimensions with no resolvable option are OMITTED — the warn policy
 * parks in pre-flight before mapping, so an unresolved value here is the
 * recorded drop path.
 */
export type XeroJournalDimensionArgs = {
  slots: ReadonlyArray<
    Pick<PostingSyncDimensionSlot, "dimensionId" | "target">
  >;
  optionIdsByValue: ReadonlyMap<string, string>;
};

export function mapJournalEntryToManualJournal(args: {
  journal: Accounting.JournalEntry;
  accountCodesById: ReadonlyMap<string, string>;
  pushDate: string;
  redatedFromDate?: string;
  existingRemoteId?: string | null;
  dimensions?: XeroJournalDimensionArgs;
}): Omit<Xero.ManualJournal, "UpdatedDateUTC"> {
  const { journal } = args;
  const sign = journal.reversal ? -1 : 1;

  const journalLines: Xero.ManualJournalLine[] = journal.lines.map((line) => {
    const accountCode = line.accountId
      ? args.accountCodesById.get(line.accountId)
      : undefined;

    if (!accountCode) {
      // runJournalEntryPreflight fails before mapping; this guards direct
      // callers (consolidation, tests) against unmapped input
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `No Xero account code mapped for account ${
          line.accountId ?? "(none)"
        } on journal ${journal.journalEntryId}`,
        warning: true,
        metadata: {
          unmappedAccountIds: line.accountId ? [line.accountId] : []
        }
      });
    }

    const tracking: Xero.ManualJournalTracking[] = [];
    if (args.dimensions) {
      for (const slot of args.dimensions.slots) {
        const trackingCategoryId = parseXeroTrackingTarget(slot.target);
        if (!trackingCategoryId) continue;
        const dimension = line.dimensions?.find(
          (candidate) => candidate.dimensionId === slot.dimensionId
        );
        if (!dimension) continue;
        const trackingOptionId = args.dimensions.optionIdsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!trackingOptionId) continue; // drop policy — recorded by the caller
        tracking.push({
          TrackingCategoryID: trackingCategoryId,
          TrackingOptionID: trackingOptionId
        });
      }
    }

    return {
      LineAmount: roundCurrency(sign * line.amount),
      AccountCode: accountCode,
      Description: line.description ?? journal.description ?? undefined,
      TaxType: "NONE",
      ...(tracking.length > 0 ? { Tracking: tracking } : {})
    };
  });

  let narration = journal.reversal
    ? `Carbon reversal of ${journal.journalEntryId}`
    : `Carbon ${journal.journalEntryId} ${journal.id}`;
  if (args.redatedFromDate) {
    narration += ` | original date ${args.redatedFromDate}`;
  }

  return {
    ManualJournalID: args.existingRemoteId!,
    Narration: narration,
    Date: args.pushDate,
    Status: "POSTED",
    JournalLines: journalLines
  };
}

export class JournalEntrySyncer extends BaseEntitySyncer<
  Accounting.JournalEntry,
  Xero.ManualJournal,
  "UpdatedDateUTC"
> {
  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so settings, mappings, control accounts and the Xero org
  // lock date are each fetched at most once per drain
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private controlAccountIdsPromise?: Promise<Set<string>>;
  private lockDatePromise?: Promise<string | null>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  /**
   * `<dimensionId>:<valueId>` → Xero TrackingOptionID from the
   * dimension-value mapping rows (entityType "dimensionValue"). Mutated
   * in place by the autoCreate flow so later pushes in the same drain
   * reuse the created options.
   */
  public getDimensionValueMappings(): Promise<Map<string, string>> {
    if (!this.dimensionValueMappingsPromise) {
      this.dimensionValueMappingsPromise = (async () => {
        const mappings = await getDimensionValueMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (mappings.error) {
          throw new Error(
            `Failed to load dimension value mappings: ${mappings.error}`
          );
        }
        return buildDimensionValueMappingLookup(mappings.data ?? []);
      })();
    }
    return this.dimensionValueMappingsPromise;
  }

  /**
   * autoCreate (opt-in per slot for Xero): create missing tracking
   * options BY NAME — the value's resolved READABLE label — under the
   * slot's tracking category, then store the mapping and update the
   * lookup in place.
   */
  private async ensureAutoCreatedDimensionValues(
    journal: Accounting.JournalEntry,
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines: journal.lines,
      slots: settings.dimensionSlots,
      defaultAutoCreate: false, // Xero: opt-in avoids surprise list writes
      mappings,
      resolveLabels: (values) =>
        resolveDimensionValueLabels(this.database, { values }),
      createExternalValue: async (slot, label) => {
        const trackingCategoryId = parseXeroTrackingTarget(slot.target);
        if (!trackingCategoryId) {
          throw new Error(`Unknown Xero dimension target "${slot.target}"`);
        }
        const created = await this.xeroProvider.createTrackingOption(
          trackingCategoryId,
          label
        );
        return created.TrackingOptionID;
      },
      persistMapping: async (value, externalId, label) => {
        const persisted = await upsertDimensionValueMapping(this.database, {
          companyId: this.companyId,
          integration: this.provider.id,
          dimensionId: value.dimensionId,
          valueId: value.valueId,
          externalId,
          externalName: label
        });
        if (persisted.error) {
          throw new Error(
            `Failed to store dimension value mapping: ${persisted.error}`
          );
        }
      }
    });
  }

  // =================================================================
  // 1. SETTINGS + PRE-FLIGHT INPUTS (cached per instance)
  // =================================================================

  /**
   * Per-company posting-sync settings from
   * `companyIntegration.metadata.settings.postingSync`. Public so the
   * drain can gate on `consolidation` ("daily" journals wait for the
   * consolidation cron instead of draining individually).
   */
  public getPostingSyncSettings(): Promise<PostingSyncSettings> {
    if (!this.postingSyncSettingsPromise) {
      this.postingSyncSettingsPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return resolvePostingSyncSettings(integration?.metadata);
      })();
    }
    return this.postingSyncSettingsPromise;
  }

  /**
   * Carbon account.id → Xero account code, from the account-mapping rows
   * (entityType "account"). Mappings without a stored provider account
   * code are treated as unmapped — Xero manual-journal lines require the
   * account CODE. Public (like getPostingSyncSettings) so the
   * daily-consolidation cron runs the same pre-flights on its aggregate.
   */
  public getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = (async () => {
        const mappings = await getAccountMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });

        if (mappings.error) {
          throw new Error(`Failed to load account mappings: ${mappings.error}`);
        }

        const codesById = new Map<string, string>();
        for (const mapping of mappings.data ?? []) {
          if (mapping.externalCode) {
            codesById.set(mapping.accountId, mapping.externalCode);
          }
        }
        return codesById;
      })();
    }
    return this.accountCodesByIdPromise;
  }

  /**
   * AR/AP control accounts (accountDefault.receivablesAccount /
   * payablesAccount) — journal lines on these never push. Public for the
   * daily-consolidation cron (same pre-flight inputs as individual pushes).
   */
  public getControlAccountIds(): Promise<Set<string>> {
    if (!this.controlAccountIdsPromise) {
      this.controlAccountIdsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["receivablesAccount", "payablesAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return new Set(
          [defaults?.receivablesAccount, defaults?.payablesAccount].filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        );
      })();
    }
    return this.controlAccountIdsPromise;
  }

  /**
   * The effective lock date (YYYY-MM-DD): max of the Xero organisation's
   * PeriodLockDate and EndOfYearLockDate plus the manually captured
   * settings.lockDate when present; null when none is set. Fetched once
   * per syncer instance. If the organisation fetch fails the org lock is
   * treated as unknown — Xero itself still rejects locked-period postings,
   * so the push fails with the provider's message instead of parking
   * everything. Public for the daily-consolidation cron (same pre-flight
   * inputs as individual pushes).
   */
  public getLockDate(settings: PostingSyncSettings): Promise<string | null> {
    if (!this.lockDatePromise) {
      this.lockDatePromise = (async () => {
        const candidates: string[] = [];

        const organisation = await this.xeroProvider.getOrganisation();
        for (const raw of [
          organisation?.PeriodLockDate,
          organisation?.EndOfYearLockDate
        ]) {
          if (!raw) continue;
          const parsed = parseDotnetDate(raw);
          if (!Number.isNaN(parsed.getTime())) {
            candidates.push(parsed.toISOString().slice(0, 10));
          }
        }

        if (settings.lockDate) {
          candidates.push(settings.lockDate.slice(0, 10));
        }

        if (candidates.length === 0) return null;
        candidates.sort();
        return candidates[candidates.length - 1] ?? null;
      })();
    }
    return this.lockDatePromise;
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.ManualJournal): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(entityId: string): Promise<Accounting.JournalEntry | null> {
    const { journalId, reversal } = parseJournalEntrySyncEntityId(entityId);

    const journal = await this.database
      .selectFrom("journal")
      .select([
        "id",
        "companyId",
        "journalEntryId",
        "description",
        "postingDate",
        "status",
        "sourceType",
        "reversalOfId",
        "reversedById",
        "postedAt",
        "createdAt",
        "updatedAt"
      ])
      .where("id", "=", journalId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!journal) return null;

    const lines = await this.database
      .selectFrom("journalLine")
      .leftJoin("account", "account.id", "journalLine.accountId")
      .select([
        "journalLine.id",
        "journalLine.accountId",
        "journalLine.amount",
        "journalLine.description",
        "account.class as accountClass"
      ])
      .where("journalId", "=", journalId)
      .where("companyId", "=", this.companyId)
      .orderBy("journalLineReference", "asc")
      .execute();

    const dimensionsByLine = await loadJournalLineDimensions(this.database, {
      companyId: this.companyId,
      journalLineIds: lines.map((line) => line.id)
    });

    return {
      id: journal.id,
      companyId: journal.companyId,
      journalEntryId: journal.journalEntryId,
      description: journal.description ?? null,
      postingDate: toPostingDateString(journal.postingDate),
      status: journal.status,
      sourceType: journal.sourceType ?? null,
      reversalOfId: journal.reversalOfId ?? null,
      reversedById: journal.reversedById ?? null,
      reversal,
      lines: lines.map((line) => {
        const dimensions = dimensionsByLine.get(line.id);
        return {
          id: line.id,
          accountId: line.accountId ?? null,
          // Carbon stores natural-balance-signed amounts; the engine expects
          // debit-signed (see toDebitSignedAmount)
          amount: toDebitSignedAmount(
            line.accountClass,
            Number(line.amount) || 0
          ),
          description: line.description ?? null,
          ...(dimensions ? { dimensions } : {})
        };
      }),
      updatedAt: journal.updatedAt ?? journal.postedAt ?? journal.createdAt
    };
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.JournalEntry>> {
    const result = new Map<string, Accounting.JournalEntry>();
    for (const id of ids) {
      const journal = await this.fetchLocal(id);
      if (journal) result.set(id, journal);
    }
    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.ManualJournal | null> {
    return this.xeroProvider.getManualJournal(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.ManualJournal>> {
    const result = new Map<string, Xero.ManualJournal>();
    for (const id of ids) {
      const journal = await this.xeroProvider.getManualJournal(id);
      if (journal) result.set(journal.ManualJournalID, journal);
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC (skip-reason gate)
  // =================================================================

  protected async shouldSync(
    context: ShouldSyncContext<Accounting.JournalEntry, Xero.ManualJournal>
  ): Promise<boolean | string> {
    if (context.direction === "pull") {
      return "Journal entries are push-only; pulling manual journals from Xero is not supported";
    }

    const local = context.localEntity;
    if (!local) return "Journal could not be loaded";

    // Idempotency: a mapped journal push is never repeated
    if (!context.isFirstSync) {
      return "Journal already pushed to Xero (mapping exists)";
    }

    if (local.reversal) {
      if (local.status !== "Reversed") {
        return `Reversal push requires a Reversed journal (current status: ${local.status})`;
      }
      // Reversal-by-reference: only reverse what was actually pushed
      const originalRemoteId = await this.getRemoteId(local.id);
      if (!originalRemoteId) {
        return `Original journal ${local.journalEntryId} was never pushed to Xero; nothing to reverse`;
      }
    } else if (local.status !== "Posted") {
      return `Journal must be Posted before syncing (current status: ${local.status})`;
    }

    const settings = await this.getPostingSyncSettings();
    const sourceTypeSkipReason = getPostingSyncSourceTypeSkipReason(
      local.sourceType,
      settings,
      {
        inventoryAdjustmentEntitySyncEnabled:
          this.provider.getSyncConfig("inventoryAdjustment")?.enabled ?? false
      }
    );
    if (sourceTypeSkipReason) return sourceTypeSkipReason;

    return true;
  }

  // =================================================================
  // 6. TRANSFORMATION (Carbon -> Xero) with pre-flight
  // =================================================================

  protected async mapToRemote(
    local: Accounting.JournalEntry
  ): Promise<Omit<Xero.ManualJournal, "UpdatedDateUTC">> {
    const settings = await this.getPostingSyncSettings();
    const accountCodesById = await this.getAccountCodesById();
    const controlAccountIds = await this.getControlAccountIds();
    const lockDate = await this.getLockDate(settings);

    // Dimension slots: resolve the value-mapping lookup and auto-create
    // missing tracking options (opt-in per slot) BEFORE pre-flight so
    // freshly created options never park as unmapped
    let dimensionValueMappings: Map<string, string> | undefined;
    if (settings.dimensionSlots.length > 0) {
      dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        local,
        settings,
        dimensionValueMappings
      );
    }

    const preflight = runJournalEntryPreflight({
      journal: local,
      accountCodesById,
      controlAccountIds,
      lockDate,
      settings,
      dimensionValueMappings
    });

    if (preflight.failure) {
      throw new JournalEntrySyncError(preflight.failure);
    }

    if (preflight.droppedDimensionValues?.length) {
      // "drop" policy: pushed without these dimensions. The drain has no
      // success-metadata channel yet, so the record lives in the logs.
      console.warn("[JournalEntrySyncer] dropped unmapped dimension values", {
        journalId: local.id,
        droppedDimensionValues: preflight.droppedDimensionValues
      });
    }

    return mapJournalEntryToManualJournal({
      journal: local,
      accountCodesById,
      pushDate: preflight.pushDate,
      redatedFromDate: preflight.redatedFromDate,
      ...(dimensionValueMappings
        ? {
            dimensions: {
              slots: settings.dimensionSlots,
              optionIdsByValue: dimensionValueMappings
            }
          }
        : {})
    });
  }

  // =================================================================
  // 7. TRANSFORMATION (Xero -> Carbon) - Not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Xero.ManualJournal
  ): Promise<Partial<Accounting.JournalEntry>> {
    throw new Error(
      "Journal entries are push-only. Cannot map from Xero to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<Accounting.JournalEntry>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Journal entries are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.ManualJournal, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);
    const created = await this.xeroProvider.createManualJournal(
      existingRemoteId ? { ...data, ManualJournalID: existingRemoteId } : data
    );
    return created.ManualJournalID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.ManualJournal, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    // One journal per POST keeps per-journal idempotency simple; journal
    // volumes per drain are small (claim limit 20)
    for (const { localId, payload } of data) {
      const remoteId = await this.upsertRemote(payload, localId);
      result.set(localId, remoteId);
    }
    return result;
  }

  // =================================================================
  // 9. PUSH WORKFLOW (structured pre-flight failures)
  // =================================================================

  /**
   * Reimplements the base push workflow so pre-flight failures reach the
   * caller as structured JournalEntrySyncFailure objects on
   * `SyncResult.error` (the base catch flattens every throw to a string,
   * which would lose errorCode/warning/metadata). Also replaces the base
   * lastSyncedAt bailout with a hard skip-when-mapped: posted journals are
   * immutable, so an existing mapping means the push already happened.
   */
  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        error: "Sync disabled in config"
      };
    }

    try {
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      if (existingMapping?.externalId) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: existingMapping.externalId,
          error: "Journal already pushed to Xero — skipping (idempotent)"
        };
      }

      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      const shouldSyncResult = await this.shouldSync({
        direction: "push",
        localEntity,
        isFirstSync: true,
        entityId
      });

      if (shouldSyncResult !== true) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          error:
            typeof shouldSyncResult === "string"
              ? shouldSyncResult
              : "Entity not eligible for sync"
        };
      }

      const remotePayload = await this.mapToRemote(localEntity);
      const remoteId = await this.upsertRemote(remotePayload, entityId);

      await withTriggersDisabled(this.database, async (tx) => {
        await this.linkEntities(tx, entityId, remoteId);
      });

      return {
        status: "success",
        action: "created",
        localId: entityId,
        remoteId
      };
    } catch (err) {
      if (err instanceof JournalEntrySyncError) {
        console.error("[JournalEntrySyncer] pre-flight failure", {
          entityId,
          ...err.failure
        });
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: err.failure
        };
      }

      console.error("[JournalEntrySyncer] push failed", { entityId, err });
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Batch push composes the overridden single push so structured pre-flight
   * failures survive the batch path too — the base implementation runs its
   * own catch-and-flatten loop, which would reduce JournalEntrySyncError to
   * a string for drains that push journals in groups (individual-mode
   * posting sync). Journals arrive in claim-sized batches (≤20), so a
   * sequential loop costs nothing.
   */
  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = [];

    for (const entityId of entityIds) {
      results.push(await this.pushToAccounting(entityId));
    }

    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }

  // =================================================================
  // 10. PULL WORKFLOW - Not supported (push-only)
  // =================================================================

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      remoteId,
      error:
        "Journal entries are push-only: pulling manual journals from Xero into Carbon is not supported"
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error",
      action: "none",
      remoteId,
      error:
        "Journal entries are push-only: pulling manual journals from Xero into Carbon is not supported"
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
