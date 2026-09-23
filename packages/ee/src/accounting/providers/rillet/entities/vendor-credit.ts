import { JournalEntrySyncError } from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletTransactionWriteOmit,
  RilletVendorCreditCreate
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  loadCompanyBaseCurrency,
  loadCurrencyDecimalPlaces,
  loadRilletAccountCodesById,
  loadRilletMemoReasonAccount,
  loadRilletMemoSources,
  type RilletMemoSource,
  RilletTransactionSyncer,
  resolveMemoSyncGate,
  toRilletMoney
} from "./shared";

/**
 * RilletVendorCreditSyncer — a Carbon supplier + Debit `memo` → a Rillet
 * vendor credit (push-only, create-only; entityType "vendorCredit").
 *
 * A vendor credit is what a supplier debit memo IS: the AP balance comes
 * down and the offset is the memo's reason account. Rillet's
 * `POST /vendor-credits` takes ACCOUNT-CODED `line_items[]`, so the reason
 * account binds the GL directly — no product, no credit-reason item resolver
 * (that is the AR side's problem; `credit-memo.ts`).
 *
 * Deliberately NOT a journal entry. A 2026-09-23 sandbox probe showed Rillet
 * accepts a journal to the AP control account but SILENTLY DISCARDS
 * `related_entity`, so the control balance would move with nothing in the
 * subledger behind it. Documents only — do not add a journal fallback.
 *
 * Increasers (supplier + Credit) are NOT supported in v1: `shouldSync`
 * returns a skip WITH a reason so the operation closes `Skipped` with the
 * limitation in `errorMessage`, never a silent drop and never a malformed
 * push.
 */

/** The memo header this syncer reads; aliased so the mapper's tests read against a stable name. */
export type VendorCreditMemo = RilletMemoSource;

/**
 * Map a posted supplier debit memo to the Rillet vendor-credit create
 * payload. Pure — exported for tests.
 *
 * `memo.amount` is in `memo.currencyCode` (document currency, validated at
 * that currency's own precision by `post-memo`), so the single line carries
 * it verbatim and `exchange_rate` pins the directed provider rate exactly
 * like a bill.
 */
export function mapMemoToRilletVendorCredit(args: {
  memo: VendorCreditMemo;
  /** Rillet account code the memo's reason account maps to. */
  reasonAccountCode: string;
  /** Fallback line description when the memo carries neither notes nor a reference. */
  reasonAccountName: string;
  decimalPlaces: number;
  baseCurrencyCode: string;
  vendorRemoteId: string;
  subsidiaryId: string | null;
  companyId: string;
}): RilletVendorCreditCreate {
  const { memo } = args;
  const impactDate = memo.postingDate ?? memo.memoDate;

  const lineItem: Rillet.VendorCreditLineItem = {
    account_code: args.reasonAccountCode,
    amount: toRilletMoney(memo.amount, memo.currencyCode, args.decimalPlaces),
    description: memo.notes ?? memo.reference ?? args.reasonAccountName
  };

  // `subsidiary_id` is REQUIRED on a vendor credit (optional on a bill), so a
  // company without one cannot push at all. Fail loudly rather than omitting it
  // and taking a 400 the operator cannot interpret.
  if (!args.subsidiaryId) {
    throw new Error(
      "Rillet requires a subsidiary on a vendor credit. Set the Rillet subsidiary in the integration settings, then retry."
    );
  }

  return {
    vendor_id: args.vendorRemoteId,
    subsidiary_id: args.subsidiaryId,
    // Carbon's readable memo id doubles as the provenance link: the vendor
    // credit create body has no external_references field.
    credit_number: memo.memoId,
    date: memo.memoDate,
    gl_impact_date: impactDate,
    line_items: [lineItem],
    ...(memo.reference ? { memo: memo.reference } : {})
  };
}

/**
 * Build the vendor credit's COMPLETE application set from the memo's
 * `invoiceSettlement` rows. Pure — exported for tests.
 *
 * `billRemoteIdsByLocalId` maps a Carbon purchase-invoice id to its Rillet
 * bill id; every application must resolve, so the caller JIT-syncs the bills
 * first and parks the memo when one still cannot be resolved. Entries are
 * `{ bill_id, amount }` — this side has no `application_date`.
 */
export function buildRilletVendorCreditApplications(args: {
  memo: VendorCreditMemo;
  billRemoteIdsByLocalId: ReadonlyMap<string, string>;
  decimalPlaces: number;
}): Rillet.VendorCreditApplication[] {
  const { memo } = args;
  const applications: Rillet.VendorCreditApplication[] = [];

  for (const application of memo.applications) {
    const billId = application.targetPurchaseInvoiceId;
    if (!billId) continue;
    const remoteId = args.billRemoteIdsByLocalId.get(billId);
    if (!remoteId) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync vendor credit ${memo.memoId}: the bill it is applied to is not synced to Rillet yet. Sync the bill, then retry.`,
        metadata: { memoId: memo.id, purchaseInvoiceId: billId }
      });
    }
    applications.push({
      bill_id: remoteId,
      amount: toRilletMoney(
        application.amount,
        memo.currencyCode,
        args.decimalPlaces
      )
    });
  }

  return applications;
}

export class RilletVendorCreditSyncer extends RilletTransactionSyncer<
  VendorCreditMemo,
  Rillet.VendorCredit,
  RilletTransactionWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private baseCurrencyPromise?: Promise<string>;
  /** Resolved in mapToRemote, applied in upsertRemote: localId → complete set. */
  private readonly pendingApplications = new Map<
    string,
    Rillet.VendorCreditApplication[]
  >();

  protected get pushOnlyEntityLabel(): string {
    return "Vendor credits";
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

  private getBaseCurrency(): Promise<string> {
    if (!this.baseCurrencyPromise) {
      this.baseCurrencyPromise = loadCompanyBaseCurrency(
        this.database,
        this.companyId
      );
    }
    return this.baseCurrencyPromise;
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected isVoided(local: VendorCreditMemo): boolean {
    return local.status === "Voided";
  }

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.rilletProvider.deleteVendorCredit(remoteId);
  }

  async fetchLocal(id: string): Promise<VendorCreditMemo | null> {
    const memos = await this.fetchMemosByIds([id]);
    return memos.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, VendorCreditMemo>> {
    return this.fetchMemosByIds(ids);
  }

  private async fetchMemosByIds(
    ids: string[]
  ): Promise<Map<string, VendorCreditMemo>> {
    return loadRilletMemoSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.VendorCredit | null> {
    return this.rilletProvider.getVendorCredit(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.VendorCredit>> {
    const result = new Map<string, Rillet.VendorCredit>();
    for (const id of ids) {
      const vendorCredit = await this.rilletProvider.getVendorCredit(id);
      if (vendorCredit) result.set(vendorCredit.id, vendorCredit);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — this syncer owns SUPPLIER memos only
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<VendorCreditMemo, Rillet.VendorCredit>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Vendor credits are push-only; pulling vendor credits from Rillet is not supported";
    }
    if (!context.localEntity) return true;
    return resolveMemoSyncGate(context.localEntity, "supplier");
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: VendorCreditMemo
  ): Promise<RilletVendorCreditCreate> {
    // JIT dependency: vendor before the document
    let vendorRemoteId = local.partyExternalId;
    if (!vendorRemoteId && local.supplierId) {
      vendorRemoteId = await this.ensureDependencySynced(
        "vendor",
        local.supplierId
      );
    }
    if (!vendorRemoteId) {
      throw new Error(
        `Cannot sync vendor credit ${local.id}: No supplier linked or supplier not synced to Rillet`
      );
    }

    const reasonAccount = await loadRilletMemoReasonAccount(this.database, {
      companyId: this.companyId,
      memo: local
    });
    const accountCodesById = await this.getAccountCodesById();
    const reasonAccountCode = accountCodesById.get(reasonAccount.accountId);
    if (!reasonAccountCode) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync vendor credit ${local.memoId}: its reason account has no Rillet account mapping. Map the account on the integration settings page, then retry.`,
        metadata: {
          memoId: local.id,
          unmappedAccountIds: [reasonAccount.accountId]
        }
      });
    }

    const decimalPlaces = await loadCurrencyDecimalPlaces(this.database, {
      companyId: this.companyId,
      currencyCode: local.currencyCode
    });

    // Resolve the applications BEFORE anything is created remotely, so an
    // unsynced target bill parks the memo instead of orphaning a credit.
    this.pendingApplications.set(
      local.id,
      buildRilletVendorCreditApplications({
        memo: local,
        billRemoteIdsByLocalId: await this.resolveBillRemoteIds(local),
        decimalPlaces
      })
    );

    return mapMemoToRilletVendorCredit({
      memo: local,
      reasonAccountCode,
      reasonAccountName: reasonAccount.name,
      decimalPlaces,
      baseCurrencyCode: await this.getBaseCurrency(),
      vendorRemoteId,
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId
    });
  }

  /**
   * Carbon purchase-invoice id → Rillet bill id for every document this memo
   * is applied to, JIT-syncing any that is not linked yet (`vendorCredit`
   * declares `dependsOn: ['vendor','bill']` for exactly this).
   */
  private async resolveBillRemoteIds(
    memo: VendorCreditMemo
  ): Promise<Map<string, string>> {
    const remoteIds = new Map<string, string>();
    const billIds = [
      ...new Set(
        memo.applications
          .map((application) => application.targetPurchaseInvoiceId)
          .filter((id): id is string => id !== null)
      )
    ];
    for (const billId of billIds) {
      const mapped = await this.ensureDependencySynced("bill", billId);
      if (mapped) remoteIds.set(billId, mapped);
    }
    return remoteIds;
  }

  // =================================================================
  // 5. UPSERT REMOTE (create-only) + applications
  // =================================================================

  protected async upsertRemote(
    data: RilletVendorCreditCreate,
    localId: string
  ): Promise<string> {
    // No writeDroppingUnregisteredReferences here: unlike bills and invoices, a
    // vendor credit create has NO external_references field to drop. Idempotency
    // rests on the entity-scoped key plus the mapping row, which is what the
    // base syncer's fast-bailout reads.
    const created = await this.rilletProvider.createVendorCredit(
      data,
      buildRilletIdempotencyKey({
        companyId: this.companyId,
        operation: "vendor-credit",
        localId
      })
    );

    const applications = this.pendingApplications.get(localId) ?? [];
    if (applications.length > 0) {
      // ONE call carrying the COMPLETE set — never one call per application.
      await this.rilletProvider.applyVendorCredit(
        created.id,
        applications,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "vendor-credit-applications",
          localId
        })
      );
    }
    this.pendingApplications.delete(localId);

    return created.id;
  }
}
