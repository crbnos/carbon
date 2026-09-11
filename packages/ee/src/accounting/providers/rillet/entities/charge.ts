import { buildDimensionValueMappingEntityId } from "../../../core/dimension-mapping";
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
  JournalEntrySyncError
} from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletChargeCreate,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import type { RilletJournalDimensionArgs } from "./journal-entry";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadRilletAccountCodesById,
  RilletTransactionSyncer,
  toRilletExchangeRate,
  toRilletMoney,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletChargeSyncer — Carbon card transactions (Ramp card spend) → Rillet
 * charges (push-only, create-only; entityType "charge").
 *
 * A Rillet charge is what a card charge IS: a vendor, a charge date, coded
 * items, and the credit-card liability account it settles against. Rillet
 * derives the posting itself — debit each item's account, credit the card
 * account — which is exactly what Carbon's "Card Transaction" journal booked,
 * so the items are that journal's coded lines (shared
 * `loadCardTransactionCostingLines`, card-liability line excluded) and the
 * two ledgers cannot drift. While this syncer is enabled the journal itself is
 * DOC_BACKED-excluded per row (core/posting.ts), never pushed twice.
 *
 * Only a Posted `Charge` or `Credit` with a merchant supplier is pushed — a
 * `Credit` (merchant refund) is a charge whose items are NEGATIVE, which the
 * Rillet sandbox accepted 2026-09-10 (`CHARGE_CREDIT_PROVIDERS`, the mirror
 * guard below stays for a provider outside that set); the other three card-transaction types are
 * money movements with no vendor and stay journal entries. Every skip here is
 * mirrored by the policy, so a skipped row's journal keeps pushing — the
 * spend always reaches Rillet as exactly one of the two.
 *
 * Unmapped accounts fail as the structured UNMAPPED_ACCOUNTS Warning, same as
 * bills — never a silent fallback account.
 */

/** The Carbon `cardTransaction` header as the syncer reads it. */
export type CardCharge = {
  id: string;
  companyId: string;
  /** Readable id (`CARD-…`). */
  cardTransactionId: string;
  type: CardTransactionType;
  status: "Draft" | "Posted" | "Voided";
  supplierId: string | null;
  /** The supplier's Rillet vendor id, when already mapped. */
  supplierExternalId: string | null;
  merchantName: string | null;
  memo: string | null;
  updatedAt: string | null;
};

/** Costing lines are the shared shape; aliased so the mapper's tests read against a stable name. */
export type ChargePostingJournalLine = CostingLine;

/** The parts of the costing result the pure mapper consumes. */
export type ChargeCosting = Pick<
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
 * Map a Carbon card transaction to the Rillet charge create payload. Pure —
 * exported for tests. `costing.lines` are the posted journal's coded lines
 * (card-liability line already excluded), base-currency and debit-signed;
 * `costing.exchangeRate` converts them to the card's transaction currency
 * (rounded at the document currency boundary). Throws structured Warnings
 * when the journal is missing or an account (line or card) is unmapped.
 */
export function mapCardTransactionToRilletCharge(args: {
  charge: CardCharge;
  costing: ChargeCosting;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  dimensions?: RilletJournalDimensionArgs;
}): RilletChargeCreate {
  const { charge, costing } = args;
  const currency = costing.currencyCode;

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
        "Cannot sync card charge: one or more accounts are not mapped to Rillet. Map the accounts under the integration's Accounts tab, then retry.",
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

  const items: Rillet.ChargeItem[] = transactionLines.map((line) => {
    const fieldRefs: Rillet.ItemFieldRef[] = [];
    if (args.dimensions) {
      for (const dimension of line.dimensions ?? []) {
        const fieldId = args.dimensions.fieldIdByDimensionId.get(
          dimension.dimensionId
        );
        if (!fieldId) continue;
        const fieldValueId = args.dimensions.fieldValueIdsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!fieldValueId) continue; // Field/value not provisioned — drop this ref
        fieldRefs.push({ field_id: fieldId, field_value_id: fieldValueId });
      }
    }
    const description = line.description ?? charge.memo ?? undefined;
    return {
      // Presence asserted above; the non-null assertion is the mapped code.
      account_code: args.accountCodesById.get(line.accountId!)!,
      amount: toRilletMoney(line.amount, currency, costing.decimalPlaces),
      ...(description ? { description } : {}),
      ...(fieldRefs.length > 0 ? { fields: fieldRefs } : {})
    };
  });

  return {
    vendor_id: args.vendorRemoteId,
    items,
    charge_date: costing.transactionDate,
    impact_date: costing.postingDate,
    credit_card_account_code: cardAccountCode,
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    // Pin the directed provider exchange rate for foreign-currency charges.
    exchange_rate: toRilletExchangeRate({
      baseCurrencyCode: costing.baseCurrencyCode,
      documentCurrencyCode: currency,
      foreignPerBaseRate: costing.exchangeRate,
      date: costing.postingDate
    }),
    external_references: [
      carbonExternalReference(charge.id),
      carbonCompanyExternalReference(args.companyId)
    ]
  };
}

export class RilletChargeSyncer extends RilletTransactionSyncer<
  CardCharge,
  Rillet.Charge,
  RilletTransactionWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;

  protected get pushOnlyEntityLabel(): string {
    return "Card charges";
  }

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadRilletAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected isVoided(local: CardCharge): boolean {
    return local.status === "Voided";
  }

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.rilletProvider.deleteCharge(remoteId);
  }

  async fetchLocal(id: string): Promise<CardCharge | null> {
    const charges = await this.fetchChargesByIds([id]);
    return charges.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, CardCharge>> {
    return this.fetchChargesByIds(ids);
  }

  private async fetchChargesByIds(
    ids: string[]
  ): Promise<Map<string, CardCharge>> {
    const result = new Map<string, CardCharge>();
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
        status: row.status as CardCharge["status"],
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
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Charge | null> {
    return this.rilletProvider.getCharge(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Charge>> {
    const result = new Map<string, Rillet.Charge>();
    for (const id of ids) {
      const charge = await this.rilletProvider.getCharge(id);
      if (charge) result.set(charge.id, charge);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — mirrors isChargeBackedCardTransaction exactly
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<CardCharge, Rillet.Charge>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Card charges are push-only; pulling charges from Rillet is not supported";
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
  // 4. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(local: CardCharge): Promise<RilletChargeCreate> {
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
        `Cannot sync card charge ${local.id}: No supplier linked or supplier not synced to Rillet`
      );
    }

    const costing = await loadCardTransactionCostingLines(this.database, {
      companyId: this.companyId,
      cardTransactionId: local.id
    });

    // Send ALL dimensions (the cost center / "project" above all): auto-
    // provision every Rillet Field + value the coded lines reference.
    const { fieldIdByDimensionId, fieldValueIdsByValue } =
      await this.resolveLineDimensions(costing.lines);

    return mapCardTransactionToRilletCharge({
      charge: local,
      costing,
      vendorRemoteId,
      accountCodesById: await this.getAccountCodesById(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId,
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue }
    });
  }

  // =================================================================
  // 5. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
  //    already-mapped ids) + best-effort receipt attach
  // =================================================================

  protected async upsertRemote(
    data: RilletChargeCreate,
    localId: string
  ): Promise<string> {
    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createCharge(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "charge",
          localId
        })
      )
    );
    await this.attachReceipts(localId, created.id);
    return created.id;
  }

  /**
   * Attach the Ramp receipts the card sync stored (`document` rows with
   * `sourceDocumentId` = the card transaction, in the `private` bucket) to
   * the Rillet charge. Best-effort by contract: any failure is logged and
   * skipped — a missing receipt never fails the charge, whose mapping is
   * written by the caller right after this returns.
   */
  private async attachReceipts(
    localId: string,
    remoteId: string
  ): Promise<void> {
    try {
      const documents = await this.database
        .selectFrom("document")
        .select(["path", "name", "type"])
        .where("companyId", "=", this.companyId)
        .where("sourceDocumentId", "=", localId)
        .where("path", "like", `%/card-transaction/${localId}/%`)
        .execute();
      if (documents.length === 0) return;

      const { getCarbonServiceRole } = await import(
        "@carbon/auth/client.server"
      );
      const storage = getCarbonServiceRole().storage.from("private");
      for (const document of documents) {
        const downloaded = await storage.download(document.path);
        if (downloaded.error || !downloaded.data) {
          console.warn(
            `[rillet] charge ${localId}: could not download receipt ${document.path}`,
            downloaded.error
          );
          continue;
        }
        await this.rilletProvider.uploadChargeDocument(remoteId, {
          name: document.name,
          type: downloaded.data.type || "application/octet-stream",
          bytes: new Uint8Array(await downloaded.data.arrayBuffer())
        });
      }
    } catch (err) {
      console.warn(
        `[rillet] charge ${localId}: receipt attach skipped`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
