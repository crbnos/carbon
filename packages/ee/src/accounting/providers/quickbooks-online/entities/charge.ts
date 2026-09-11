import { createHash } from "node:crypto";
import type { KyselyTx } from "@carbon/database/client";
import {
  type CardChargeSource,
  loadCardChargeSources
} from "../../../core/card-charge-source";
import { ChargeSyncerBase } from "../../../core/charge-syncer";
import {
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  ensureDimensionValueExternalIds,
  getDimensionValueMappings,
  resolveDimensionValueLabels,
  upsertDimensionValueMapping
} from "../../../core/dimension-mapping";
import {
  type CardTransactionCostingResult,
  type CostingLine,
  loadCardTransactionCostingLines,
  toTransactionCurrencyLines
} from "../../../core/document-costing";
import { createMappingService } from "../../../core/external-mapping";
import {
  CHARGE_CREDIT_PROVIDERS,
  JournalEntrySyncError,
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import { parseQboDate, type Qbo, type QboCreatePayload } from "../models";
import {
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  type QboProvider
} from "../provider";
import type { QboJournalDimensionArgs } from "./journal-entry";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboWriteOmit,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboChargeSyncer — Carbon card transactions (Ramp card spend) → QuickBooks
 * Online `Purchase` objects with `PaymentType: "CreditCard"` (push-only;
 * entityType "charge"; the QBO counterpart of RilletChargeSyncer).
 *
 * A credit-card Purchase is what a card charge IS in QBO: a vendor
 * (`EntityRef`), a charge date, account-coded expense lines, and the
 * credit-card liability account (`AccountRef`) it settles against. QBO
 * derives the posting itself — debit each line's account, credit the card
 * account — which is exactly what Carbon's "Card Transaction" journal booked,
 * so the lines are that journal's coded lines (shared
 * `loadCardTransactionCostingLines`, card-liability line excluded) and the
 * two ledgers cannot drift. While this syncer is enabled the journal itself is
 * DOC_BACKED-excluded per row (core/posting.ts), never pushed twice.
 *
 * A Posted `Charge` OR `Credit` with a merchant supplier is pushed: QBO can
 * represent a merchant refund natively (`Credit: true`, positive line
 * amounts — `CHARGE_CREDIT_PROVIDERS`). The other three card-transaction
 * types are money movements with no vendor and stay journal entries. Every
 * skip here is mirrored by the policy, so a skipped row's journal keeps
 * pushing — the spend always reaches QBO as exactly one of the two.
 *
 * Unmapped accounts fail as the structured UNMAPPED_ACCOUNTS Warning, same as
 * bills — never a silent fallback account.
 *
 * VERIFY (QBO sandbox): no sandbox was available when this shipped. The
 * Purchase payload follows Intuit's reference (CreditCard PaymentType,
 * AccountRef = the card account, EntityRef type "Vendor", per-line ClassRef,
 * transaction-level DepartmentRef, `Credit: true` for refunds) but is
 * unverified against a live QBO company — like the QBO payment push.
 */

/**
 * The Carbon `cardTransaction` header as the syncer reads it — the same shape
 * the Rillet charge syncer reads, named per provider because the provider
 * barrels are re-exported side by side (`export *` would collide).
 */
export type QboCardCharge = CardChargeSource;

/** Costing lines are the shared shape; aliased so the mapper's tests read against a stable name. */
export type QboChargeCostingLine = CostingLine;

/** The parts of the costing result the pure mapper consumes. */
export type QboChargeCosting = Pick<
  CardTransactionCostingResult,
  | "lines"
  | "documentTotal"
  | "decimalPlaces"
  | "baseCurrencyCode"
  | "postingDate"
  | "transactionDate"
  | "currencyCode"
  | "exchangeRate"
  | "cardAccountId"
>;

/**
 * Map a Carbon card transaction to the QBO Purchase create payload. Pure —
 * exported for tests. `costing.lines` are the posted journal's coded lines
 * (card-liability line already excluded), base-currency and debit-signed;
 * `costing.exchangeRate` converts them to the card's transaction currency
 * (rounded at the document currency boundary). A `Credit` (merchant refund)
 * arrives credit-signed and is sent as QBO's native refund: `Credit: true`
 * with the positive magnitude of every line. Throws structured Warnings when
 * the journal is missing or an account (line or card) is unmapped.
 *
 * - `TxnDate` is the journal's posting date — the GL date Carbon booked, which
 *   the Ramp sync already shifts into an open period (a closed-period charge
 *   date would draw QBO's 6210 fault); the charge date stays on the Carbon row.
 * - Dimension slots: a "class" slot lands on the line
 *   (`AccountBasedExpenseLineDetail.ClassRef`); a "department" slot is
 *   transaction-level on a Purchase (per-line only on JournalEntry), so the
 *   FIRST line carrying a resolvable department value sets `DepartmentRef`.
 *   Unresolvable values are dropped, as on the journal mapper.
 * - DocNumber carries the Carbon readable id under QBO's 21-char cap, else
 *   PrivateNote; the memo rides PrivateNote either way.
 */
export function mapCardTransactionToQboPurchase(args: {
  charge: QboCardCharge;
  costing: QboChargeCosting;
  vendorRemoteId: string;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  dimensions?: QboJournalDimensionArgs;
}): QboCreatePayload<Qbo.Purchase> {
  const { charge, costing } = args;

  if (costing.lines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: no posted Card Transaction journal lines found. Post the card transaction with accounting enabled, then retry.",
      metadata: { cardTransactionId: charge.id }
    });
  }

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of costing.lines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
    } else if (!args.accountRefsById.has(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }
  const cardAccountRef = args.accountRefsById.get(costing.cardAccountId);
  if (!cardAccountRef) unmapped.add(costing.cardAccountId);
  if (
    unmapped.size > 0 ||
    lineIdsWithoutAccount.length > 0 ||
    !cardAccountRef
  ) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: one or more accounts are not mapped to QuickBooks Online. Map the accounts under the integration's Accounts tab, then retry.",
      metadata: {
        cardTransactionId: charge.id,
        unmappedAccountIds: [...unmapped],
        lineIdsWithoutAccount
      }
    });
  }

  const transactionLines = toTransactionCurrencyLines(costing.lines, {
    exchangeRate: costing.exchangeRate,
    documentTotal: costing.documentTotal,
    decimalPlaces: costing.decimalPlaces
  });

  const isCredit = charge.type === "Credit";
  let departmentRef: Qbo.Ref | undefined;

  const lines = transactionLines.map((line): Omit<Qbo.ExpenseLine, "Id"> => {
    const detail: Qbo.AccountBasedExpenseLineDetail = {
      // Presence asserted above; the non-null assertion is the mapped ref.
      AccountRef: args.accountRefsById.get(line.accountId!)!
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
        if (!ref) continue; // Value not mapped — drop this ref
        if (slot.target === QBO_DIMENSION_TARGET_CLASS) {
          detail.ClassRef = ref;
        } else if (slot.target === QBO_DIMENSION_TARGET_DEPARTMENT) {
          departmentRef ??= ref;
        }
      }
    }
    const description = line.description ?? charge.memo ?? undefined;
    return {
      // Already rounded at the document boundary by toTransactionCurrencyLines;
      // a refund flips the credit-signed line to its positive magnitude
      // (`0 - x` rather than `-x` so a zero line never serializes as -0).
      Amount: isCredit ? 0 - line.amount : line.amount,
      ...(description ? { Description: description } : {}),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: detail
    };
  });

  const docNumber = buildQboDocNumberFields(
    charge.cardTransactionId,
    charge.memo
  );

  return {
    PaymentType: "CreditCard",
    AccountRef: cardAccountRef,
    EntityRef: { value: args.vendorRemoteId, type: "Vendor" },
    // "If Credit is Null or False, it is considered as Charge" — omitted for
    // a charge so the payload reads as the plain case.
    ...(isCredit ? { Credit: true } : {}),
    DocNumber: docNumber.DocNumber,
    PrivateNote: docNumber.PrivateNote,
    TxnDate: costing.postingDate,
    ...(departmentRef ? { DepartmentRef: departmentRef } : {}),
    // QBO quotes company base per document currency, reciprocal to Carbon.
    ...(costing.currencyCode !== costing.baseCurrencyCode
      ? {
          CurrencyRef: { value: costing.currencyCode },
          ExchangeRate: 1 / costing.exchangeRate
        }
      : {}),
    Line: lines
  };
}

export class QboChargeSyncer extends ChargeSyncerBase<
  QboCardCharge,
  Qbo.Purchase,
  QboWriteOmit
> {
  protected readonly updateMappedCharges = true;
  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so settings, account refs and the dimension-value lookup are
  // each fetched at most once per drain
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.Purchase, "Id" | "SyncToken" | "MetaData"> | null
  ): void {
    if (!remote?.Id) return;
    this.remoteMetaById.set(remote.Id, {
      syncToken: remote.SyncToken,
      lastUpdatedTime: remote.MetaData?.LastUpdatedTime
    });
  }

  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  /** Per-company posting-sync settings — the dimension slots live here. */
  private getPostingSyncSettings(): Promise<PostingSyncSettings> {
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
   * `<dimensionId>:<valueId>` → QBO Class/Department id from the
   * dimension-value mapping rows (entityType "dimensionValue"). Mutated in
   * place by the autoCreate flow so later pushes in the same drain reuse the
   * created ids.
   */
  private getDimensionValueMappings(): Promise<Map<string, string>> {
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
   * Departments BY NAME — the value's resolved READABLE label — then store
   * the mapping and update the lookup in place (the journal syncer's flow,
   * applied to the charge's coded lines).
   */
  private async ensureAutoCreatedDimensionValues(
    lines: CostingLine[],
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines,
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
  // 1. ID MAPPING — default implementation (entityType "charge"), with
  //    SyncToken/LastUpdatedTime recorded on the mapping (bill pattern)
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt:
          remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
        ...(seen?.syncToken !== undefined
          ? { metadata: { syncToken: seen.syncToken } }
          : {})
      }
    );
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.Purchase): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.qboProvider.deletePurchase(remoteId);
  }

  async fetchLocal(id: string): Promise<QboCardCharge | null> {
    const charges = await this.fetchChargesByIds([id]);
    return charges.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, QboCardCharge>> {
    return this.fetchChargesByIds(ids);
  }

  private async fetchChargesByIds(
    ids: string[]
  ): Promise<Map<string, QboCardCharge>> {
    return loadCardChargeSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Purchase | null> {
    const purchase = await this.qboProvider.getPurchase(id);
    this.rememberRemoteEntity(purchase);
    return purchase;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Purchase>> {
    const result = new Map<string, Qbo.Purchase>();
    for (const id of ids) {
      const purchase = await this.fetchRemote(id);
      if (purchase) result.set(purchase.Id, purchase);
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC — mirrors isChargeBackedCardTransaction exactly
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<QboCardCharge, Qbo.Purchase>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Card charges are push-only; pulling purchases from QuickBooks Online is not supported";
    }
    const local = context.localEntity;
    if (!local) return true;
    if (local.status !== "Posted") {
      return `Card transaction must be posted before syncing (current status: ${local.status})`;
    }
    if (local.type !== "Charge" && local.type !== "Credit") {
      return `Card transaction type ${local.type} is a money movement, not a charge — it syncs as a journal entry`;
    }
    if (
      local.type === "Credit" &&
      !CHARGE_CREDIT_PROVIDERS.has(this.provider.id)
    ) {
      return "QuickBooks Online card credits (merchant refunds) sync as journal entries until the Credit purchase is verified";
    }
    if (!local.supplierId) {
      return "Card charge has no merchant supplier — it syncs as a journal entry";
    }
    return true;
  }

  // =================================================================
  // 6. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: QboCardCharge
  ): Promise<QboCreatePayload<Qbo.Purchase>> {
    // JIT dependency: vendor before the document
    let vendorRemoteId = local.supplierExternalId;
    if (!vendorRemoteId && local.supplierId) {
      vendorRemoteId = await this.ensureDependencySynced(
        "vendor",
        local.supplierId
      );
    }
    if (!vendorRemoteId) {
      throw new Error(
        `Cannot sync card charge ${local.id}: No supplier linked or supplier not synced to QuickBooks Online`
      );
    }

    const costing = await loadCardTransactionCostingLines(this.database, {
      companyId: this.companyId,
      cardTransactionId: local.id
    });

    // Dimension slots (ClassRef / DepartmentRef): resolve the value-mapping
    // lookup and auto-create missing Classes/Departments (opt-in per slot)
    // for the coded lines' dimensions — the journal syncer's flow
    const settings = await this.getPostingSyncSettings();
    let dimensions: QboJournalDimensionArgs | undefined;
    if (settings.dimensionSlots.length > 0) {
      const dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        costing.lines,
        settings,
        dimensionValueMappings
      );
      dimensions = {
        slots: settings.dimensionSlots,
        refsByValue: new Map(
          [...dimensionValueMappings].map(
            ([key, externalId]) => [key, { value: externalId }] as const
          )
        )
      };
    }

    return mapCardTransactionToQboPurchase({
      charge: local,
      costing,
      vendorRemoteId,
      accountRefsById: await this.getAccountRefsById(),
      dimensions
    });
  }

  // =================================================================
  // 7. TRANSFORMATION (QBO -> Carbon) - Not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Qbo.Purchase
  ): Promise<Partial<QboCardCharge>> {
    throw new Error(
      "Card charges are push-only. Cannot map from QuickBooks Online to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<QboCardCharge>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Card charges are push-only. Cannot upsert locally from QuickBooks Online."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (create, or sparse update with SyncToken retry —
  //    the bill pattern, so a memo/receipt edit after posting re-syncs)
  // =================================================================

  protected async upsertRemote(
    data: QboCreatePayload<Qbo.Purchase>,
    localId: string,
    knownRemoteId?: string | null
  ): Promise<string> {
    const existingRemoteId =
      knownRemoteId === undefined
        ? await this.getRemoteId(localId)
        : knownRemoteId;

    if (!existingRemoteId) {
      // Intuit replays a write's original response for the same requestid.
      // https://blogs.a.intuit.com/2018/09/10/quickbooks-online-api-best-practices/
      const created = await this.qboProvider.createPurchase(
        data,
        createHash("sha256")
          .update(`${this.companyId}:charge:${localId}`)
          .digest("hex")
          .slice(0, 40)
      );
      if (!created?.Id)
        throw new Error(
          "QuickBooks did not return a Purchase Id for this card charge"
        );
      this.rememberRemoteEntity(created);
      return created.Id;
    }

    const updated = await updateWithSyncTokenRetry({
      entityLabel: "purchase",
      remoteId: existingRemoteId,
      fetchCurrent: () => this.qboProvider.getPurchase(existingRemoteId),
      update: (syncToken) =>
        this.qboProvider.updatePurchase({
          ...data,
          Id: existingRemoteId,
          SyncToken: syncToken
        })
    });
    this.rememberRemoteEntity(updated);
    return updated.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: QboCreatePayload<Qbo.Purchase>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
