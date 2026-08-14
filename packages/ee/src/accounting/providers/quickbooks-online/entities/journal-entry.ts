import type { KyselyTx } from "@carbon/database/client";
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
import { parseQboDate, type Qbo, type QboCreatePayload } from "../models";
import {
  isQboAccountPeriodClosedError,
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  QBO_FAULT_CODES,
  type QboProvider
} from "../provider";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboWriteOmit
} from "./shared";

/**
 * QboJournalEntrySyncer — pushes Posted Carbon journals (`journal` +
 * `journalLine`) to QuickBooks Online as JournalEntry objects. PUSH-ONLY:
 * pull methods return descriptive not-supported errors. Mirrors the Xero
 * JournalEntrySyncer's structure; only `mapToRemote` (unsigned lines with
 * PostingType) and the lock-date source (manual settings only) differ.
 *
 * Sign convention: Carbon `journalLine.amount` is signed (positive = debit,
 * negative = credit); QBO journal lines are UNSIGNED — `Amount` =
 * abs(amount) and the side lives in `JournalEntryLineDetail.PostingType`
 * ("Debit" for positive Carbon amounts, "Credit" otherwise). TODO: verify
 * the mapping against a real/sandbox QBO journal entry before enabling for
 * production companies (Task C10) — if QBO rejects or books sides
 * inverted, document and invert.
 *
 * Reversal contract (same as Xero): when a sync operation carries
 * `metadata.reversal: true`, the drain pushes entity id
 * `"<journal.id>:reversal"` (see getJournalEntrySyncEntityId). The syncer
 * then loads the ORIGINAL journal, requires status `Reversed` plus an
 * existing original mapping, negates every signed amount (flipping each
 * line's PostingType), uses PrivateNote `"Carbon reversal of
 * <journalEntryId>"`, and stores the reversal's mapping under the suffixed
 * entity id — the original mapping is never touched.
 *
 * Failure channel: pre-flight failures (UNMAPPED_ACCOUNTS,
 * CONTROL_ACCOUNT_LINE, PERIOD_LOCKED park, UNBALANCED_JOURNAL) throw
 * JournalEntrySyncError inside the mapping step; pushToAccounting converts
 * them to `SyncResult.error` carrying the structured
 * JournalEntrySyncFailure object. The drain detects them with
 * isJournalEntrySyncFailure and records them via failOperation({
 * errorCode, errorMessage, warning }). shouldSync gates (wrong status,
 * disabled posting sync, excluded sourceType, already mapped) keep the
 * skip-reason-string channel (`SyncResult.status === "skipped"`).
 *
 * Closed books: the pre-flight lock date comes ONLY from the manually
 * captured `settings.lockDate`
 * (companyIntegration.metadata.settings.postingSync) — the QBO API cannot
 * read the company's close-the-books date, so there is no org-lock-date
 * fetch like Xero's. When the stored date is stale, QBO itself rejects the
 * create with fault 6210, which upsertRemote converts into the SAME
 * structured PERIOD_LOCKED Warning (toQboPeriodClosedError) as the
 * pre-flight would have produced.
 *
 * Consolidation-aware: the drain resolves the same posting-sync settings
 * (including `consolidation`) from the integration metadata to hold
 * journal operations for the daily consolidation cron instead of pushing
 * them individually.
 */

/**
 * The effective lock date (YYYY-MM-DD) for QuickBooks Online: the manual
 * `settings.lockDate` ONLY — QBO's API cannot read the close-the-books
 * date (no organisation endpoint like Xero's PeriodLockDate), so the
 * settings field is the sole pre-flight source and the 6210 fault mapping
 * is the backstop for staleness. Null when no date is stored.
 */
export function getQboLockDate(settings: PostingSyncSettings): string | null {
  return settings.lockDate ? settings.lockDate.slice(0, 10) : null;
}

/**
 * Convert QBO's Account Period Closed fault (Intuit code 6210) into the
 * structured PERIOD_LOCKED Warning — the backstop for a stale manual lock
 * date (pre-flight passed but QBO's real close date is later). Returns
 * null for any other error.
 */
export function toQboPeriodClosedError(
  error: unknown,
  args: { journalLabel: string; txnDate?: string }
): JournalEntrySyncError | null {
  if (!isQboAccountPeriodClosedError(error)) return null;

  return new JournalEntrySyncError({
    errorCode: "PERIOD_LOCKED",
    message: `QuickBooks Online rejected journal ${args.journalLabel}${
      args.txnDate ? ` dated ${args.txnDate}` : ""
    }: the accounting period is closed (Intuit fault 6210). Update the "Books lock date" in the posting sync settings to match QuickBooks Online (or reopen the period there), then retry.`,
    warning: true,
    metadata: {
      ...(args.txnDate ? { txnDate: args.txnDate } : {}),
      qboFaultCode: QBO_FAULT_CODES.ACCOUNT_PERIOD_CLOSED
    }
  });
}

/**
 * Map one Carbon journal to a QBO JournalEntry payload. Pure — exported
 * for tests (and for a future QBO daily-consolidation path, mirroring the
 * Xero mapper's contract).
 *
 * - Lines: one QBO Line per journalLine — `Amount` = abs(signed Carbon
 *   amount) at 2dp, `JournalEntryLineDetail.PostingType` = "Debit" when
 *   the signed amount is positive else "Credit" (Carbon convention:
 *   positive = debit; reversals negate first, flipping every side),
 *   `AccountRef` from the account mapping (externalId = QBO Account.Id),
 *   Description = line description falling back to the journal
 *   description.
 * - DocNumber: the Carbon journalEntryId when it fits QBO's 21-char cap
 *   (C7's buildQboDocNumberFields rule); omitted otherwise (QBO
 *   auto-numbers) — PrivateNote always carries the Carbon ids, so no
 *   extra carrier is needed on overflow.
 * - PrivateNote: "Carbon <journalEntryId> <journal.id>" (or
 *   "Carbon reversal of <journalEntryId>"), with
 *   " | original date <postingDate>" appended when the period-lock redate
 *   policy moved the push date.
 */
/**
 * Slot config + resolved value refs for the QBO journal mapper: `slots`
 * are the company's dimension slots (targets "class" / "department");
 * `refsByValue` resolves `<dimensionId>:<valueId>` → QBO entity ref.
 * Slotted line dimensions with no resolvable ref are OMITTED — the warn
 * policy parks in pre-flight before mapping, so an unresolved value here
 * is the recorded drop path.
 */
export type QboJournalDimensionArgs = {
  slots: ReadonlyArray<
    Pick<PostingSyncDimensionSlot, "dimensionId" | "target">
  >;
  refsByValue: ReadonlyMap<string, Qbo.Ref>;
};

export function mapJournalEntryToQboJournalEntry(args: {
  journal: Accounting.JournalEntry;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  pushDate: string;
  redatedFromDate?: string;
  dimensions?: QboJournalDimensionArgs;
}): QboCreatePayload<Qbo.JournalEntry> {
  const { journal } = args;
  const sign = journal.reversal ? -1 : 1;

  const lines: Qbo.JournalEntryLine[] = journal.lines.map((line) => {
    const accountRef = line.accountId
      ? args.accountRefsById.get(line.accountId)
      : undefined;

    if (!accountRef) {
      // runJournalEntryPreflight fails before mapping; this guards direct
      // callers (consolidation, tests) against unmapped input
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `No QuickBooks Online account mapped for account ${
          line.accountId ?? "(none)"
        } on journal ${journal.journalEntryId}`,
        warning: true,
        metadata: {
          unmappedAccountIds: line.accountId ? [line.accountId] : []
        }
      });
    }

    const signedAmount = sign * line.amount;

    const detail: Qbo.JournalEntryLineDetail = {
      PostingType: signedAmount > 0 ? "Debit" : "Credit",
      AccountRef: accountRef
    };

    if (args.dimensions) {
      for (const slot of args.dimensions.slots) {
        const dimension = line.dimensions?.find(
          (candidate) => candidate.dimensionId === slot.dimensionId
        );
        if (!dimension) continue;
        const ref = args.dimensions.refsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!ref) continue; // drop policy — recorded by the caller
        if (slot.target === QBO_DIMENSION_TARGET_CLASS) {
          detail.ClassRef = ref;
        } else if (slot.target === QBO_DIMENSION_TARGET_DEPARTMENT) {
          detail.DepartmentRef = ref;
        }
      }
    }

    return {
      Amount: roundCurrency(Math.abs(signedAmount)),
      DetailType: "JournalEntryLineDetail",
      Description: line.description ?? journal.description ?? undefined,
      JournalEntryLineDetail: detail
    };
  });

  let privateNote = journal.reversal
    ? `Carbon reversal of ${journal.journalEntryId}`
    : `Carbon ${journal.journalEntryId} ${journal.id}`;
  if (args.redatedFromDate) {
    privateNote += ` | original date ${args.redatedFromDate}`;
  }

  // 21-char DocNumber rule from C7; the helper's PrivateNote carrier is
  // superseded by the journal narration above, which always carries the
  // Carbon ids
  const { DocNumber } = buildQboDocNumberFields(journal.journalEntryId);

  return {
    DocNumber,
    PrivateNote: privateNote,
    TxnDate: args.pushDate,
    Line: lines
  };
}

export class QboJournalEntrySyncer extends BaseEntitySyncer<
  Accounting.JournalEntry,
  Qbo.JournalEntry,
  QboWriteOmit
> {
  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so settings, account refs, control accounts and the
  // dimension-value lookup are each fetched at most once per drain
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private controlAccountIdsPromise?: Promise<Set<string>>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
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
   * Carbon account.id → QBO AccountRef, from the account-mapping rows
   * (entityType "account", mapping externalId = QBO Account.Id — the same
   * resolution path the item/bill syncers use via loadQboAccountRefsById).
   * Mappings without a stored externalId are treated as unmapped. Public
   * (like getPostingSyncSettings) so a future QBO daily-consolidation path
   * can run the same pre-flights on its aggregate.
   */
  public getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  /**
   * AR/AP control accounts (accountDefault.receivablesAccount /
   * payablesAccount) — journal lines on these never push. Public for
   * consolidation parity (same pre-flight inputs as individual pushes).
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
   * `<dimensionId>:<valueId>` → QBO Class/Department id from the
   * dimension-value mapping rows (entityType "dimensionValue"). Mutated
   * in place by the autoCreate flow so later pushes in the same drain
   * reuse the created ids.
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
   * autoCreate (opt-in per slot for QBO): create missing Classes /
   * Departments BY NAME — the value's resolved READABLE label — then
   * store the mapping and update the lookup in place.
   */
  private async ensureAutoCreatedDimensionValues(
    journal: Accounting.JournalEntry,
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines: journal.lines,
      slots: settings.dimensionSlots,
      defaultAutoCreate: false, // QBO: opt-in avoids surprise list writes
      mappings,
      resolveLabels: (values) =>
        resolveDimensionValueLabels(this.database, { values }),
      createExternalValue: async (slot, label) => {
        if (slot.target === QBO_DIMENSION_TARGET_CLASS) {
          const created = await this.qboProvider.createClass({ Name: label });
          return created.Id;
        }
        if (slot.target === QBO_DIMENSION_TARGET_DEPARTMENT) {
          const created = await this.qboProvider.createDepartment({
            Name: label
          });
          return created.Id;
        }
        throw new Error(
          `Unknown QuickBooks Online dimension target "${slot.target}"`
        );
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
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.JournalEntry): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
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

  async fetchRemote(id: string): Promise<Qbo.JournalEntry | null> {
    return this.qboProvider.getJournalEntry(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.JournalEntry>> {
    const result = new Map<string, Qbo.JournalEntry>();
    for (const id of ids) {
      const journalEntry = await this.qboProvider.getJournalEntry(id);
      if (journalEntry) result.set(journalEntry.Id, journalEntry);
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC (skip-reason gate)
  // =================================================================

  protected async shouldSync(
    context: ShouldSyncContext<Accounting.JournalEntry, Qbo.JournalEntry>
  ): Promise<boolean | string> {
    if (context.direction === "pull") {
      return "Journal entries are push-only; pulling journal entries from QuickBooks Online is not supported";
    }

    const local = context.localEntity;
    if (!local) return "Journal could not be loaded";

    // Idempotency: a mapped journal push is never repeated
    if (!context.isFirstSync) {
      return "Journal already pushed to QuickBooks Online (mapping exists)";
    }

    if (local.reversal) {
      if (local.status !== "Reversed") {
        return `Reversal push requires a Reversed journal (current status: ${local.status})`;
      }
      // Reversal-by-reference: only reverse what was actually pushed
      const originalRemoteId = await this.getRemoteId(local.id);
      if (!originalRemoteId) {
        return `Original journal ${local.journalEntryId} was never pushed to QuickBooks Online; nothing to reverse`;
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
  // 6. TRANSFORMATION (Carbon -> QBO) with pre-flight
  // =================================================================

  protected async mapToRemote(
    local: Accounting.JournalEntry
  ): Promise<QboCreatePayload<Qbo.JournalEntry>> {
    const settings = await this.getPostingSyncSettings();
    const accountRefsById = await this.getAccountRefsById();
    const controlAccountIds = await this.getControlAccountIds();
    const lockDate = getQboLockDate(settings);

    // The shared pre-flight takes account "codes"; for QBO that role is
    // played by the account Id (the ref value)
    const accountIdsByCarbonId = new Map(
      [...accountRefsById].map(
        ([accountId, ref]) => [accountId, ref.value] as const
      )
    );

    // Dimension slots: resolve the value-mapping lookup and auto-create
    // missing Classes/Departments (opt-in per slot) BEFORE pre-flight so
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
      accountCodesById: accountIdsByCarbonId,
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
      console.warn(
        "[QboJournalEntrySyncer] dropped unmapped dimension values",
        {
          journalId: local.id,
          droppedDimensionValues: preflight.droppedDimensionValues
        }
      );
    }

    return mapJournalEntryToQboJournalEntry({
      journal: local,
      accountRefsById,
      pushDate: preflight.pushDate,
      redatedFromDate: preflight.redatedFromDate,
      ...(dimensionValueMappings
        ? {
            dimensions: {
              slots: settings.dimensionSlots,
              refsByValue: new Map(
                [...dimensionValueMappings].map(
                  ([key, externalId]) => [key, { value: externalId }] as const
                )
              )
            }
          }
        : {})
    });
  }

  // =================================================================
  // 7. TRANSFORMATION (QBO -> Carbon) - Not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Qbo.JournalEntry
  ): Promise<Partial<Accounting.JournalEntry>> {
    throw new Error(
      "Journal entries are push-only. Cannot map from QuickBooks Online to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<Accounting.JournalEntry>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Journal entries are push-only. Cannot upsert locally from QuickBooks Online."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: QboCreatePayload<Qbo.JournalEntry>,
    localId: string
  ): Promise<string> {
    // Create-only: posted journals are immutable and pushToAccounting
    // hard-skips already-mapped ids, so the SyncToken update path never
    // applies here
    try {
      const created = await this.qboProvider.createJournalEntry(data);
      return created.Id;
    } catch (error) {
      // Closed-books backstop: the manual lock date can be stale (the QBO
      // API cannot read the real close date) — surface QBO's 6210 fault as
      // the same structured PERIOD_LOCKED Warning the pre-flight produces
      const periodClosed = toQboPeriodClosedError(error, {
        journalLabel: data.DocNumber ?? localId,
        txnDate: data.TxnDate
      });
      if (periodClosed) throw periodClosed;
      throw error;
    }
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: QboCreatePayload<Qbo.JournalEntry>;
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
          error:
            "Journal already pushed to QuickBooks Online — skipping (idempotent)"
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
        console.error("[QboJournalEntrySyncer] pre-flight failure", {
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

      console.error("[QboJournalEntrySyncer] push failed", { entityId, err });
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
        "Journal entries are push-only: pulling journal entries from QuickBooks Online into Carbon is not supported"
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error",
      action: "none",
      remoteId,
      error:
        "Journal entries are push-only: pulling journal entries from QuickBooks Online into Carbon is not supported"
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
