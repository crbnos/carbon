import type { KyselyTx } from "@carbon/database/client";
import { loadAccountCodesById } from "../../../core/account-mapping";
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
  type CardTransactionType,
  CHARGE_CREDIT_PROVIDERS,
  JournalEntrySyncError,
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "../../../core/posting";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type ShouldSyncContext,
  type SyncResult
} from "../../../core/types";
import { throwXeroApiError, withTriggersDisabled } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import { parseXeroTrackingTarget, type XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";
import type { XeroJournalDimensionArgs } from "./journal-entry";

/**
 * XeroChargeSyncer — Carbon card transactions (Ramp card spend) → Xero bank
 * transactions (push-only, create-only; entityType "charge").
 *
 * Xero has no charge object: a card charge IS a spend-money bank transaction
 * on the card account — Xero models a credit card as a BANK-type account of
 * BankAccountType CREDITCARD — and a merchant refund is receive-money on the
 * same account. Xero derives the posting itself (debit each line's account,
 * credit the card account for SPEND; the reverse for RECEIVE), which is
 * exactly what Carbon's "Card Transaction" journal booked, so the lines are
 * that journal's coded lines (shared `loadCardTransactionCostingLines`,
 * card-liability line excluded) and the two ledgers cannot drift. While this
 * syncer is enabled the journal itself is DOC_BACKED-excluded per row
 * (core/posting.ts), never pushed twice.
 *
 * Only a Posted `Charge` or `Credit` with a merchant supplier is pushed —
 * Xero is in `CHARGE_CREDIT_PROVIDERS`, so a refund is a RECEIVE rather than
 * a journal entry; the other three card-transaction types are money movements
 * with no vendor and stay journal entries. Every skip here is mirrored by the
 * policy, so a skipped row's journal keeps pushing — the spend always reaches
 * Xero as exactly one of the two.
 *
 * A Voided card transaction that was pushed is deleted remotely (Xero's
 * delete is a POST carrying Status DELETED) and its mapping tombstoned —
 * the same contract as the Rillet transaction syncers.
 *
 * Unmapped accounts fail as the structured UNMAPPED_ACCOUNTS Warning, same as
 * bills — never a silent fallback account.
 */

/** The Carbon `cardTransaction` header as the syncer reads it. */
export type XeroCardCharge = {
  id: string;
  companyId: string;
  /** Readable id (`CARD-…`). */
  cardTransactionId: string;
  type: CardTransactionType;
  status: "Draft" | "Posted" | "Voided";
  supplierId: string | null;
  /** The supplier's Xero ContactID, when already mapped. */
  supplierExternalId: string | null;
  merchantName: string | null;
  memo: string | null;
  updatedAt: string | null;
};

/** Costing lines are the shared shape; aliased so the mapper's tests read against a stable name. */
export type XeroChargePostingJournalLine = CostingLine;

/** The parts of the costing result the pure mapper consumes. */
export type XeroChargeCosting = Pick<
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

/** Fields Xero assigns; never part of a write payload. */
export type XeroBankTransactionWriteOmit =
  | "UpdatedDateUTC"
  | "BankTransactionID";

export type XeroBankTransactionWrite = Omit<
  Xero.BankTransaction,
  XeroBankTransactionWriteOmit
>;

/**
 * Tracking for one line from the company's dimension slots — the same
 * slot → `tracking:<TrackingCategoryID>` resolution the manual-journal
 * mapper uses. At most one entry per slot, and slots are capped at Xero's
 * org-wide two active categories (`XERO_MAX_JOURNAL_DIMENSION_SLOTS`). A
 * slotted dimension whose option is unmapped is dropped from the line — the
 * journal syncer's drop policy; the caller has already auto-created opt-in
 * options.
 */
function buildXeroLineTracking(
  line: CostingLine,
  dimensions: XeroJournalDimensionArgs | undefined
): Xero.ManualJournalTracking[] {
  const tracking: Xero.ManualJournalTracking[] = [];
  if (!dimensions) return tracking;
  for (const slot of dimensions.slots) {
    const trackingCategoryId = parseXeroTrackingTarget(slot.target);
    if (!trackingCategoryId) continue;
    const dimension = line.dimensions?.find(
      (candidate) => candidate.dimensionId === slot.dimensionId
    );
    if (!dimension) continue;
    const trackingOptionId = dimensions.optionIdsByValue.get(
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
  return tracking;
}

/**
 * Map a Carbon card transaction to the Xero bank-transaction write payload.
 * Pure — exported for tests. `costing.lines` are the posted journal's coded
 * lines (card-liability line already excluded), base-currency and
 * debit-signed; `costing.exchangeRate` converts them to the card's
 * transaction currency (rounded at the document currency boundary). A Charge
 * is a `SPEND`, a Credit (merchant refund) a `RECEIVE`; Xero carries the
 * direction on `Type`, so line amounts are sent as positive magnitudes. Throws
 * structured Warnings when the journal is missing or an account (line or
 * card) is unmapped, and refuses principal Xero's two-decimal monetary
 * boundary cannot represent.
 */
export function mapCardTransactionToXeroBankTransaction(args: {
  charge: XeroCardCharge;
  costing: XeroChargeCosting;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  dimensions?: XeroJournalDimensionArgs;
}): XeroBankTransactionWrite {
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
    } else if (!args.accountCodesById.has(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }
  const cardAccountCode = args.accountCodesById.get(costing.cardAccountId);
  if (!cardAccountCode) unmapped.add(costing.cardAccountId);
  if (
    unmapped.size > 0 ||
    lineIdsWithoutAccount.length > 0 ||
    !cardAccountCode
  ) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: one or more accounts are not mapped to Xero. Map the accounts under the integration's Accounts tab, then retry.",
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
  assertXeroMoneyPrecision(...transactionLines.map((line) => line.amount));

  // A Credit's costing lines are credit-signed (negative). Negate rather than
  // abs: a contra line inside a document keeps its relative sign, so the
  // lines still sum to the document total Xero recomputes.
  const isCredit = charge.type === "Credit";

  const lineItems: Xero.BankTransactionLineItem[] = transactionLines.map(
    (line) => {
      const tracking = buildXeroLineTracking(line, args.dimensions);
      const description = line.description ?? charge.memo ?? undefined;
      return {
        ...(description ? { Description: description } : {}),
        Quantity: 1,
        UnitAmount: isCredit ? -line.amount : line.amount,
        // Presence asserted above; the non-null assertion is the mapped code.
        AccountCode: args.accountCodesById.get(line.accountId!)!,
        TaxType: "NONE",
        ...(tracking.length > 0 ? { Tracking: tracking } : {})
      };
    }
  );

  return {
    Type: isCredit ? "RECEIVE" : "SPEND",
    Contact: { ContactID: args.vendorRemoteId },
    BankAccount: { Code: cardAccountCode },
    Date: costing.transactionDate,
    Reference: charge.cardTransactionId,
    Status: "AUTHORISED",
    // Tax-neutral replay: the card posting folds tax into cost, so the lines
    // already embed it; let Xero total the NONE-taxed lines.
    LineAmountTypes: "NoTax",
    CurrencyCode: costing.currencyCode,
    // Pin every foreign snapshot, including negotiated 1:1 rates (the bill
    // convention).
    CurrencyRate:
      costing.currencyCode !== costing.baseCurrencyCode
        ? costing.exchangeRate
        : undefined,
    LineItems: lineItems
  };
}

export class XeroChargeSyncer extends BaseEntitySyncer<
  XeroCardCharge,
  Xero.BankTransaction,
  XeroBankTransactionWriteOmit
> {
  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so account codes, the Xero chart, settings and the
  // dimension-value lookup are each fetched at most once per drain
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private chartOfAccountsPromise?: Promise<Xero.Account[]>;
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;

  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // =================================================================
  // 1. CACHED INPUTS (account codes, chart, settings, dimension values)
  // =================================================================

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  /** Xero chart of accounts, read once per syncer instance (BANK-type check). */
  private getChartOfAccounts(): Promise<Xero.Account[]> {
    if (!this.chartOfAccountsPromise) {
      this.chartOfAccountsPromise = this.xeroProvider.listChartOfAccounts();
    }
    return this.chartOfAccountsPromise;
  }

  /**
   * Per-company posting-sync settings from
   * `companyIntegration.metadata.settings.postingSync` — the dimension slots
   * are what a charge line's tracking is resolved through.
   */
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
   * `<dimensionId>:<valueId>` → Xero TrackingOptionID from the
   * dimension-value mapping rows (entityType "dimensionValue"). Mutated in
   * place by the autoCreate flow so later pushes in the same drain reuse the
   * created options.
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
   * autoCreate (opt-in per slot for Xero): create missing tracking options
   * BY NAME — the value's resolved READABLE label — under the slot's
   * tracking category, then store the mapping and update the lookup in
   * place. Same flow as the manual-journal syncer.
   */
  private async ensureAutoCreatedDimensionValues(
    lines: ReadonlyArray<CostingLine>,
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines,
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
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.BankTransaction): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<XeroCardCharge | null> {
    const charges = await this.fetchChargesByIds([id]);
    return charges.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, XeroCardCharge>> {
    return this.fetchChargesByIds(ids);
  }

  private async fetchChargesByIds(
    ids: string[]
  ): Promise<Map<string, XeroCardCharge>> {
    const result = new Map<string, XeroCardCharge>();
    if (ids.length === 0) return result;

    const rows = await this.database
      .selectFrom("cardTransaction")
      .select([
        "id",
        "companyId",
        "cardTransactionId",
        "type",
        "status",
        "supplierId",
        "merchantName",
        "memo",
        "updatedAt"
      ])
      .where("cardTransaction.id", "in", ids)
      .where("cardTransaction.companyId", "=", this.companyId)
      .execute();

    const supplierIds = [
      ...new Set(
        rows
          .map((row) => row.supplierId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const supplierExternalIds = new Map<string, string | null>();
    const mappingService = createMappingService(this.database, this.companyId);
    for (const supplierId of supplierIds) {
      supplierExternalIds.set(
        supplierId,
        await mappingService.getExternalId(
          "vendor",
          supplierId,
          this.provider.id
        )
      );
    }

    for (const row of rows) {
      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        cardTransactionId: row.cardTransactionId,
        type: row.type as CardTransactionType,
        status: row.status as XeroCardCharge["status"],
        supplierId: row.supplierId ?? null,
        supplierExternalId: row.supplierId
          ? (supplierExternalIds.get(row.supplierId) ?? null)
          : null,
        merchantName: row.merchantName ?? null,
        memo: row.memo ?? null,
        updatedAt: row.updatedAt ? String(row.updatedAt) : null
      });
    }
    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.BankTransaction | null> {
    const response = await this.xeroProvider.request<{
      BankTransactions: Xero.BankTransaction[];
    }>("GET", `/BankTransactions/${id}`);

    if (response.error) return null;
    return response.data?.BankTransactions?.[0] ?? null;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.BankTransaction>> {
    const result = new Map<string, Xero.BankTransaction>();
    for (const id of ids) {
      const bankTransaction = await this.fetchRemote(id);
      if (bankTransaction) {
        result.set(bankTransaction.BankTransactionID, bankTransaction);
      }
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC — mirrors isChargeBackedCardTransaction exactly
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<XeroCardCharge, Xero.BankTransaction>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Card charges are push-only; pulling bank transactions from Xero is not supported";
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
      return "Card credits (merchant refunds) sync as journal entries for this provider";
    }
    if (!local.supplierId) {
      return "Card charge has no merchant supplier — it syncs as a journal entry";
    }
    return true;
  }

  // =================================================================
  // 6. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: XeroCardCharge
  ): Promise<XeroBankTransactionWrite> {
    // JIT dependency: vendor (contact) before the document
    let vendorRemoteId = local.supplierExternalId;
    if (!vendorRemoteId && local.supplierId) {
      vendorRemoteId = await this.ensureDependencySynced(
        "vendor",
        local.supplierId
      );
    }
    if (!vendorRemoteId) {
      throw new Error(
        `Cannot sync card charge ${local.id}: No supplier linked or supplier not synced to Xero`
      );
    }

    const costing = await loadCardTransactionCostingLines(this.database, {
      companyId: this.companyId,
      cardTransactionId: local.id
    });

    const accountCodesById = await this.getAccountCodesById();

    // Xero /BankTransactions rejects a BankAccount that is not a BANK-type
    // account (a credit card is one: BankAccountType CREDITCARD). Resolve the
    // mapped code against the chart and refuse early with a fixable Warning
    // instead of an opaque Xero 400 — the gate the payment syncer runs on its
    // bank account. An unmapped card account falls through to the mapper's
    // UNMAPPED_ACCOUNTS with the standard metadata; an empty chart means the
    // read failed (listChartOfAccounts is forgiving), so Xero's own
    // validation stays the gate rather than parking every charge.
    const cardAccountCode = accountCodesById.get(costing.cardAccountId);
    if (cardAccountCode) {
      const chart = await this.getChartOfAccounts();
      const cardAccount = chart.find(
        (account) => account.Code === cardAccountCode
      );
      if (chart.length > 0 && cardAccount?.Type !== "BANK") {
        throw new JournalEntrySyncError({
          errorCode: "UNMAPPED_ACCOUNTS",
          warning: true,
          message: `Cannot sync card charge: the card-liability account must map to a Xero bank-type account — a credit card account in Xero (mapped code ${cardAccountCode}). Map it under the integration's Accounts tab, then retry.`,
          metadata: {
            cardTransactionId: local.id,
            cardAccountId: costing.cardAccountId,
            cardAccountCode
          }
        });
      }
    }

    // Dimension slots: resolve the value-mapping lookup and auto-create
    // missing tracking options (opt-in per slot) before mapping, so freshly
    // created options are never dropped as unmapped
    const settings = await this.getPostingSyncSettings();
    let dimensionValueMappings: Map<string, string> | undefined;
    if (settings.dimensionSlots.length > 0) {
      dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        costing.lines,
        settings,
        dimensionValueMappings
      );
    }

    return mapCardTransactionToXeroBankTransaction({
      charge: local,
      costing,
      vendorRemoteId,
      accountCodesById,
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
    _remote: Xero.BankTransaction
  ): Promise<Partial<XeroCardCharge>> {
    throw new Error(
      "Card charges are push-only. Cannot map from Xero to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<XeroCardCharge>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Card charges are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (create-only; pushToAccounting hard-skips mapped ids)
  // =================================================================

  protected async upsertRemote(
    data: XeroBankTransactionWrite,
    _localId: string
  ): Promise<string> {
    const result = await this.xeroProvider.request<{
      BankTransactions: Xero.BankTransaction[];
    }>("PUT", "/BankTransactions?unitdp=4", {
      body: JSON.stringify({ BankTransactions: [data] })
    });

    if (result.error) {
      throwXeroApiError("create bank transaction", result);
    }

    const created = result.data?.BankTransactions?.[0];
    if (!created?.BankTransactionID) {
      throw new Error(
        "Xero API returned success but no BankTransactionID was returned for card charge"
      );
    }

    return created.BankTransactionID;
  }

  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: XeroBankTransactionWrite }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    // One transaction per PUT keeps per-charge idempotency simple; charge
    // volumes per drain are small (claim limit 20)
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }

  /**
   * Xero has no DELETE verb for bank transactions: POSTing the transaction
   * with Status DELETED is the delete (spend/receive money only). Xero
   * refuses once the transaction is reconciled, and that refusal surfaces as
   * the operation's failure rather than a silent tombstone. VERIFY: confirm
   * the minimal `{ BankTransactionID, Status: "DELETED" }` body against the
   * Xero sandbox before relying on this in production.
   */
  private async deleteRemote(remoteId: string): Promise<void> {
    const result = await this.xeroProvider.request<{
      BankTransactions: Xero.BankTransaction[];
    }>("POST", "/BankTransactions", {
      body: JSON.stringify({
        BankTransactions: [{ BankTransactionID: remoteId, Status: "DELETED" }]
      })
    });

    if (result.error) {
      throwXeroApiError("delete bank transaction", result);
    }
  }

  // =================================================================
  // 9. PUSH WORKFLOW (void propagation + structured pre-flight failures)
  // =================================================================

  /**
   * Reimplements the base push workflow, as the manual-journal syncer does,
   * for three things the base cannot express: a Voided charge with a mapping
   * is DELETED remotely and its mapping tombstoned (`metadata.voided`) so a
   * retry never deletes twice; a mapped Posted charge is a hard idempotent
   * skip (the base's lastSyncedAt bailout would re-push on any header edit);
   * and pre-flight failures reach the caller as structured
   * JournalEntrySyncFailure objects on `SyncResult.error`.
   */
  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        localId: entityId,
        error: "Sync disabled in config"
      };
    }

    try {
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      if (existingMapping?.externalId && localEntity.status === "Voided") {
        if (existingMapping.metadata?.voided !== true) {
          await this.deleteRemote(existingMapping.externalId);
          await withTriggersDisabled(this.database, async (tx) => {
            await createMappingService(tx, this.companyId).link(
              this.entityType,
              entityId,
              this.provider.id,
              existingMapping.externalId,
              { metadata: { ...existingMapping.metadata, voided: true } }
            );
          });
        }
        return {
          status: "success",
          action: "deleted",
          localId: entityId,
          remoteId: existingMapping.externalId
        };
      }

      if (existingMapping?.externalId) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: existingMapping.externalId,
          error: "Card charge already pushed to Xero — skipping (idempotent)"
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
        console.error("[XeroChargeSyncer] pre-flight failure", {
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

      console.error("[XeroChargeSyncer] push failed", { entityId, err });
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Batch push composes the overridden single push so the void path and the
   * structured failures survive the batch path too. Charges arrive in
   * claim-sized batches (≤20), so a sequential loop costs nothing.
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
        "Card charges are push-only: pulling bank transactions from Xero into Carbon is not supported"
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error",
      action: "none",
      remoteId,
      error:
        "Card charges are push-only: pulling bank transactions from Xero into Carbon is not supported"
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
