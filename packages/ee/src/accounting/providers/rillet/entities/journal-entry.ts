import {
  getPostingSyncSourceTypeSkipReason,
  JournalEntrySyncError,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  roundCurrency,
  runJournalEntryPreflight
} from "../../../core/posting";
import type { Accounting, ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletJournalEntryCreate,
  RilletWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  loadCompanyBaseCurrency,
  loadRilletAccountCodesById,
  RilletTransactionSyncer
} from "./shared";

/**
 * RilletJournalEntrySyncer — pushes Posted Carbon journals (`journal` +
 * `journalLine`) to Rillet as journal entries. PUSH-ONLY: pull methods
 * come from RilletTransactionSyncer's push-only rejections. Mirrors the
 * QBO JournalEntrySyncer's structure; what differs is the item shape
 * (unsigned 2-dp STRING amounts with an explicit DEBIT/CREDIT side), the
 * required currency (Carbon journals carry none — the company base
 * currency is resolved once per instance), and the optional subsidiary
 * scope (Rillet is multi-entity).
 *
 * Sign convention: Carbon `journalLine.amount` is signed (positive =
 * debit, negative = credit); Rillet items are UNSIGNED — `amount` =
 * abs(signed) as a 2-dp string and the side lives in `side` ("DEBIT" for
 * positive Carbon amounts, "CREDIT" otherwise). Reversals negate first,
 * flipping every side.
 *
 * Reversal contract (same as Xero/QBO): when a sync operation carries
 * `metadata.reversal: true`, the drain pushes entity id
 * `"<journal.id>:reversal"` (see getJournalEntrySyncEntityId). The syncer
 * loads the ORIGINAL journal, requires status `Reversed` plus an existing
 * original mapping, negates every signed amount, uses the name
 * `"Carbon reversal of <journalEntryId>"`, and stores the reversal's
 * mapping under the suffixed entity id — the original mapping is never
 * touched.
 *
 * Failure channel: pre-flight failures (UNMAPPED_ACCOUNTS,
 * CONTROL_ACCOUNT_LINE, PERIOD_LOCKED park, UNBALANCED_JOURNAL) throw
 * JournalEntrySyncError inside the mapping step; the
 * RilletTransactionSyncer push override converts them to
 * `SyncResult.error` carrying the structured JournalEntrySyncFailure
 * object for the drain (isJournalEntrySyncFailure → failOperation).
 *
 * Closed books: the pre-flight lock date comes ONLY from the manually
 * captured `settings.lockDate` (the Rillet API has no
 * org-lock-date/closed-period read) — the same manual-only source as QBO.
 * A stale date surfaces as Rillet's own rejection at push time.
 */

/**
 * The effective lock date (YYYY-MM-DD) for Rillet: the manual
 * `settings.lockDate` ONLY — Rillet's API cannot report a close date, so
 * the settings field is the sole pre-flight source (same approach as
 * getQboLockDate). Null when no date is stored.
 */
export function getRilletLockDate(
  settings: PostingSyncSettings
): string | null {
  return settings.lockDate ? settings.lockDate.slice(0, 10) : null;
}

/**
 * Map one Carbon journal to a Rillet journal-entry payload. Pure —
 * exported for tests (and for a future Rillet daily-consolidation path,
 * mirroring the Xero/QBO mapper contract).
 *
 * - Items: one Rillet item per journalLine — `amount` = abs(signed Carbon
 *   amount) rounded to 2dp and rendered as a decimal STRING, `side` =
 *   "DEBIT" when the signed amount is positive else "CREDIT" (reversals
 *   negate first, flipping every side), `account_code` from the account
 *   mapping (externalCode = Rillet account code), description = line
 *   description falling back to the journal description.
 * - name: "Carbon <journalEntryId> <journal.id>" (or
 *   "Carbon reversal of <journalEntryId>"), with
 *   " | original date <postingDate>" appended when the period-lock redate
 *   policy moved the push date.
 * - `currency` is the company base currency (Carbon journals are
 *   base-currency); `subsidiary_id` only when configured.
 */
export function mapJournalEntryToRilletJournalEntry(args: {
  journal: Accounting.JournalEntry;
  accountCodesById: ReadonlyMap<string, string>;
  currency: string;
  subsidiaryId: string | null;
  pushDate: string;
  redatedFromDate?: string;
}): RilletJournalEntryCreate {
  const { journal } = args;
  const sign = journal.reversal ? -1 : 1;

  const items: Rillet.JournalEntryItem[] = journal.lines.map((line) => {
    const accountCode = line.accountId
      ? args.accountCodesById.get(line.accountId)
      : undefined;

    if (!accountCode) {
      // runJournalEntryPreflight fails before mapping; this guards direct
      // callers (consolidation, tests) against unmapped input
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `No Rillet account code mapped for account ${
          line.accountId ?? "(none)"
        } on journal ${journal.journalEntryId}`,
        warning: true,
        metadata: {
          unmappedAccountIds: line.accountId ? [line.accountId] : []
        }
      });
    }

    const signedAmount = sign * line.amount;

    return {
      account_code: accountCode,
      amount: {
        amount: roundCurrency(Math.abs(signedAmount)).toFixed(2),
        currency: args.currency
      },
      side: signedAmount > 0 ? ("DEBIT" as const) : ("CREDIT" as const),
      description: line.description ?? journal.description ?? undefined
    };
  });

  let name = journal.reversal
    ? `Carbon reversal of ${journal.journalEntryId}`
    : `Carbon ${journal.journalEntryId} ${journal.id}`;
  if (args.redatedFromDate) {
    name += ` | original date ${args.redatedFromDate}`;
  }

  return {
    name,
    date: args.pushDate,
    currency: args.currency,
    items,
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {})
  };
}

export class RilletJournalEntrySyncer extends RilletTransactionSyncer<
  Accounting.JournalEntry,
  Rillet.JournalEntry,
  RilletWriteOmit
> {
  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so settings, account codes, control accounts and the base
  // currency are each fetched at most once per drain
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private controlAccountIdsPromise?: Promise<Set<string>>;
  private baseCurrencyPromise?: Promise<string>;

  protected get pushOnlyEntityLabel(): string {
    return "Journal entries";
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
   * Carbon account.id → Rillet account code, from the account-mapping
   * rows (entityType "account"; mapping externalCode = Rillet account
   * code). Public (like getPostingSyncSettings) so a future Rillet
   * daily-consolidation path can run the same pre-flights on its
   * aggregate.
   */
  public getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadRilletAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
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
   * Company base currency — Carbon journals carry no currency of their
   * own, and Rillet journal payloads require one.
   */
  public getBaseCurrency(): Promise<string> {
    if (!this.baseCurrencyPromise) {
      this.baseCurrencyPromise = loadCompanyBaseCurrency(
        this.database,
        this.companyId
      );
    }
    return this.baseCurrencyPromise;
  }

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
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
      .select(["id", "accountId", "amount", "description"])
      .where("journalId", "=", journalId)
      .where("companyId", "=", this.companyId)
      .orderBy("journalLineReference", "asc")
      .execute();

    return {
      id: journal.id,
      companyId: journal.companyId,
      journalEntryId: journal.journalEntryId,
      description: journal.description ?? null,
      postingDate: journal.postingDate,
      status: journal.status,
      sourceType: journal.sourceType ?? null,
      reversalOfId: journal.reversalOfId ?? null,
      reversedById: journal.reversedById ?? null,
      reversal,
      lines: lines.map((line) => ({
        id: line.id,
        accountId: line.accountId ?? null,
        amount: Number(line.amount) || 0,
        description: line.description ?? null
      })),
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
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.JournalEntry | null> {
    return this.rilletProvider.getJournalEntry(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.JournalEntry>> {
    const result = new Map<string, Rillet.JournalEntry>();
    for (const id of ids) {
      const journalEntry = await this.rilletProvider.getJournalEntry(id);
      if (journalEntry) result.set(journalEntry.id, journalEntry);
    }
    return result;
  }

  // =================================================================
  // 4. SHOULD SYNC (skip-reason gate)
  // =================================================================

  protected async shouldSync(
    context: ShouldSyncContext<Accounting.JournalEntry, Rillet.JournalEntry>
  ): Promise<boolean | string> {
    if (context.direction === "pull") {
      return "Journal entries are push-only; pulling journal entries from Rillet is not supported";
    }

    const local = context.localEntity;
    if (!local) return "Journal could not be loaded";

    // Idempotency: a mapped journal push is never repeated
    if (!context.isFirstSync) {
      return "Journal already pushed to Rillet (mapping exists)";
    }

    if (local.reversal) {
      if (local.status !== "Reversed") {
        return `Reversal push requires a Reversed journal (current status: ${local.status})`;
      }
      // Reversal-by-reference: only reverse what was actually pushed
      const originalRemoteId = await this.getRemoteId(local.id);
      if (!originalRemoteId) {
        return `Original journal ${local.journalEntryId} was never pushed to Rillet; nothing to reverse`;
      }
    } else if (local.status !== "Posted") {
      return `Journal must be Posted before syncing (current status: ${local.status})`;
    }

    const settings = await this.getPostingSyncSettings();
    if (!settings.enabled) {
      return "Posting sync is not enabled for this integration";
    }

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
  // 5. TRANSFORMATION (Carbon -> Rillet) with pre-flight
  // =================================================================

  protected async mapToRemote(
    local: Accounting.JournalEntry
  ): Promise<RilletJournalEntryCreate> {
    const settings = await this.getPostingSyncSettings();
    const accountCodesById = await this.getAccountCodesById();
    const controlAccountIds = await this.getControlAccountIds();
    const lockDate = getRilletLockDate(settings);

    const preflight = runJournalEntryPreflight({
      journal: local,
      accountCodesById,
      controlAccountIds,
      lockDate,
      settings
    });

    if (preflight.failure) {
      throw new JournalEntrySyncError(preflight.failure);
    }

    return mapJournalEntryToRilletJournalEntry({
      journal: local,
      accountCodesById,
      currency: await this.getBaseCurrency(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      pushDate: preflight.pushDate,
      redatedFromDate: preflight.redatedFromDate
    });
  }

  // =================================================================
  // 6. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
  //    already-mapped ids, so no update path exists)
  // =================================================================

  protected async upsertRemote(
    data: RilletJournalEntryCreate,
    localId: string
  ): Promise<string> {
    const created = await this.rilletProvider.createJournalEntry(
      data,
      buildRilletIdempotencyKey({
        companyId: this.companyId,
        operation: "journal-entry",
        localId,
        payload: data
      })
    );
    return created.id;
  }
}
