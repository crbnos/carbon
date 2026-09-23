import type { KyselyTx } from "@carbon/database/client";
import {
  createMappingService,
  type ExternalIntegrationMapping
} from "../../../core/external-mapping";
import { JournalEntrySyncError } from "../../../core/posting";
import { BaseEntitySyncer, type ShouldSyncContext } from "../../../core/types";
import { parseQboDate, type Qbo, type QboCreatePayload } from "../models";
import {
  buildQboRequestId,
  type QboProvider,
  type QboVendorCreditApplicationPayload,
  toQboExchangeRate
} from "../provider";
import {
  loadQboMemoSources,
  QBO_MEMO_INCREASER_SKIP_REASON,
  type QboMemoSource,
  qboMemoStatusSkipReason,
  readQboAppliedSettlementIds
} from "./credit-memo";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboWriteOmit
} from "./shared";

/**
 * QboVendorCreditSyncer — a posted Carbon SUPPLIER `memo` → a QuickBooks
 * Online `VendorCredit` (push-only; entityType "vendorCredit"), plus one
 * zero-cash `BillPayment` per `invoiceSettlement` that applies it.
 *
 * The AP side is the clean one: a `VendorCredit` line is
 * `AccountBasedExpenseLineDetail` with an `AccountRef`, so the memo's reason
 * account maps straight through and NONE of the credit-reason-item machinery
 * the AR side needs applies here.
 *
 * `APAccountRef` is set explicitly when the company's payables account is
 * mapped — Intuit recommends it to avoid errors when the credit is later
 * related to a BillPayment. It is omitted rather than fatal when unmapped:
 * QBO then defaults to the company's own A/P account, which is the same
 * account, so refusing the push would block a correct document over a
 * recommendation.
 *
 * **v1 covers the REDUCER only** (supplier + Debit). A supplier + Credit memo
 * INCREASES the payable and is skipped WITH a reason, so the operation closes
 * `Skipped` (truthful ledger) rather than pushing something malformed.
 */

/**
 * Why this memo is NOT pushable as a QBO VendorCredit, or null when it is.
 * Pure — this is what `shouldSync` returns.
 */
export function qboVendorCreditSkipReason(memo: QboMemoSource): string | null {
  if (!memo.supplierId) {
    return `Memo ${memo.memoId} is not a supplier memo — a customer memo pushes as a credit memo`;
  }
  const statusReason = qboMemoStatusSkipReason(memo);
  if (statusReason) return statusReason;
  if (memo.direction !== "Debit") {
    return `${QBO_MEMO_INCREASER_SKIP_REASON}: memo ${memo.memoId} is a supplier + Credit memo, which INCREASES the payable and has no safe QuickBooks Online representation (TotalAmt is read-only)`;
  }
  return null;
}

/**
 * Build the QBO VendorCredit create payload. Pure — exported for tests. ONE
 * account-coded line carrying the memo's whole amount against its reason
 * account.
 */
export function buildQboVendorCreditPayload(args: {
  memo: QboMemoSource;
  vendorRef: Qbo.Ref;
  reasonAccountRef: Qbo.Ref;
  apAccountRef?: Qbo.Ref;
  baseCurrencyCode: string;
}): QboCreatePayload<Qbo.VendorCredit> {
  const { memo } = args;
  const docNumber = buildQboDocNumberFields(
    memo.memoId,
    memo.reference ? `Ref ${memo.reference}` : undefined
  );
  const description = memo.notes ?? memo.reference ?? undefined;

  return {
    DocNumber: docNumber.DocNumber,
    PrivateNote: docNumber.PrivateNote,
    TxnDate: memo.postingDate ?? memo.memoDate,
    VendorRef: args.vendorRef,
    ...(args.apAccountRef ? { APAccountRef: args.apAccountRef } : {}),
    // QBO quotes company base per document currency, reciprocal to Carbon.
    ...(memo.currencyCode !== args.baseCurrencyCode
      ? {
          CurrencyRef: { value: memo.currencyCode },
          ExchangeRate: toQboExchangeRate(memo.exchangeRate)
        }
      : {}),
    Line: [
      {
        Amount: memo.amount,
        ...(description ? { Description: description } : {}),
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: args.reasonAccountRef
        }
      }
    ]
  };
}

export class QboVendorCreditSyncer extends BaseEntitySyncer<
  QboMemoSource,
  Qbo.VendorCredit,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private accountDefaultsPromise?: Promise<{
    payablesAccount: string;
    bankCashAccount: string;
  } | null>;
  private baseCurrencyCodePromise?: Promise<string>;
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();
  /** Settlement ids applied during THIS push, flushed by linkEntities. */
  private appliedSettlementIds = new Map<string, string[]>();

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.VendorCredit, "Id" | "SyncToken" | "MetaData"> | null
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

  /** `accountDefault` — the payables control and the bank/cash account. */
  private getAccountDefaults(): Promise<{
    payablesAccount: string;
    bankCashAccount: string;
  } | null> {
    if (!this.accountDefaultsPromise) {
      this.accountDefaultsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["payablesAccount", "bankCashAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();
        return defaults ?? null;
      })();
    }
    return this.accountDefaultsPromise;
  }

  private getBaseCurrencyCode(): Promise<string> {
    if (!this.baseCurrencyCodePromise) {
      this.baseCurrencyCodePromise = (async () => {
        const company = await this.database
          .selectFrom("company")
          .select("baseCurrencyCode")
          .where("id", "=", this.companyId)
          .executeTakeFirst();
        if (!company?.baseCurrencyCode) {
          throw new Error(
            `Company ${this.companyId} has no base currency — required to decide whether a vendor credit is a foreign-currency document`
          );
        }
        return company.baseCurrencyCode;
      })();
    }
    return this.baseCurrencyCodePromise;
  }

  // =================================================================
  // 1. ID MAPPING — record SyncToken + the applied settlement ids
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    const applied = this.appliedSettlementIds.get(localId) ?? [];
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt:
          remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
        metadata: {
          ...(seen?.syncToken !== undefined
            ? { syncToken: seen.syncToken }
            : {}),
          ...(applied.length > 0 ? { appliedSettlementIds: applied } : {})
        }
      }
    );
  }

  protected getRemoteUpdatedAt(remote: Qbo.VendorCredit): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 2. LOCAL / REMOTE FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<QboMemoSource | null> {
    return (await this.fetchLocalBatch([id])).get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, QboMemoSource>> {
    return loadQboMemoSources(this.database, {
      companyId: this.companyId,
      ids,
      party: "supplier"
    });
  }

  async fetchRemote(id: string): Promise<Qbo.VendorCredit | null> {
    const vendorCredit = await this.qboProvider.getVendorCredit(id);
    this.rememberRemoteEntity(vendorCredit);
    return vendorCredit;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.VendorCredit>> {
    const result = new Map<string, Qbo.VendorCredit>();
    for (const id of ids) {
      const vendorCredit = await this.fetchRemote(id);
      if (vendorCredit) result.set(vendorCredit.Id, vendorCredit);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — party, posted status, and the v1 increaser skip
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<QboMemoSource, Qbo.VendorCredit>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Vendor credits are push-only — QuickBooks Online vendor credits are not pulled into Carbon";
    }
    if (!context.localEntity) return true;
    return qboVendorCreditSkipReason(context.localEntity) ?? true;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: QboMemoSource
  ): Promise<QboCreatePayload<Qbo.VendorCredit>> {
    if (!local.supplierId) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: no supplier linked to this vendor credit`
      );
    }

    // JIT dependency: vendor before the document
    let vendorRemoteId = await this.mappingService.getExternalId(
      "vendor",
      local.supplierId,
      this.provider.id
    );
    if (!vendorRemoteId) {
      vendorRemoteId = await this.ensureDependencySynced(
        "vendor",
        local.supplierId
      );
    }
    if (!vendorRemoteId) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: supplier not synced to QuickBooks Online`
      );
    }

    if (!local.reasonAccount) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot sync memo ${local.memoId}: it has no reason account. Post the memo (with accounting enabled), then retry.`,
        warning: true,
        metadata: { memoId: local.id }
      });
    }

    const accountRefsById = await this.getAccountRefsById();
    const reasonAccountRef = accountRefsById.get(local.reasonAccount);
    if (!reasonAccountRef) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot sync memo ${local.memoId}: its reason account has no QuickBooks Online account mapping. Map the account on the integration settings page, then retry.`,
        warning: true,
        metadata: {
          memoId: local.id,
          unmappedAccountIds: [local.reasonAccount]
        }
      });
    }

    const defaults = await this.getAccountDefaults();
    const apAccountRef = defaults?.payablesAccount
      ? accountRefsById.get(defaults.payablesAccount)
      : undefined;

    return buildQboVendorCreditPayload({
      memo: local,
      vendorRef: { value: vendorRemoteId },
      reasonAccountRef,
      apAccountRef,
      baseCurrencyCode: await this.getBaseCurrencyCode()
    });
  }

  // =================================================================
  // 5. PUSH-ONLY
  // =================================================================

  protected async mapToLocal(): Promise<Partial<QboMemoSource>> {
    throw new Error(
      "Vendor credits are push-only. Cannot map a QuickBooks Online vendor credit to Carbon."
    );
  }

  protected async upsertLocal(): Promise<string> {
    throw new Error(
      "Vendor credits are push-only. Cannot upsert locally from QuickBooks Online."
    );
  }

  // =================================================================
  // 6. UPSERT REMOTE — create once, then apply the outstanding settlements
  // =================================================================

  protected async upsertRemote(
    data: QboCreatePayload<Qbo.VendorCredit>,
    localId: string
  ): Promise<string> {
    const mapping = await this.mappingService.getByEntity(
      this.entityType,
      localId,
      this.provider.id
    );

    let remoteId = mapping?.externalId ?? null;
    if (!remoteId) {
      const created = await this.qboProvider.createVendorCredit(
        data,
        buildQboRequestId(this.companyId, "vendorCredit", localId)
      );
      if (!created?.Id) {
        throw new Error(
          "QuickBooks Online returned no VendorCredit Id for this memo"
        );
      }
      this.rememberRemoteEntity(created);
      remoteId = created.Id;
    }

    await this.applySettlements(localId, remoteId, data.VendorRef, mapping);

    return remoteId;
  }

  /**
   * One zero-cash `BillPayment` per NOT-YET-APPLIED settlement. QBO requires a
   * `PayType` AND a bank account even when no cash moves, so the company's
   * configured bank/cash account (`accountDefault.bankCashAccount`) must be set
   * AND mapped — both misses fail with the reason, never a guessed account.
   */
  private async applySettlements(
    localId: string,
    remoteId: string,
    vendorRef: Qbo.Ref,
    mapping: ExternalIntegrationMapping | null
  ): Promise<void> {
    const local = await this.fetchLocal(localId);
    if (!local) return;

    const alreadyApplied = new Set(readQboAppliedSettlementIds(mapping));
    const applied = [...alreadyApplied];

    const pending = local.settlements.filter(
      (settlement) =>
        !alreadyApplied.has(settlement.id) && settlement.targetPurchaseInvoiceId
    );
    if (pending.length === 0) {
      this.appliedSettlementIds.set(localId, applied);
      return;
    }

    const bankRef = await this.resolveBankAccountRef(local);

    for (const settlement of pending) {
      const billRemoteId = await this.mappingService.getExternalId(
        "bill",
        settlement.targetPurchaseInvoiceId!,
        this.provider.id
      );
      if (!billRemoteId) {
        throw new JournalEntrySyncError({
          errorCode: "UNSYNCED_DOCUMENT",
          message: `Memo ${local.memoId} is applied to a purchase invoice that has not synced to QuickBooks Online yet — sync the bill, then retry`,
          warning: true,
          metadata: {
            memoId: local.id,
            targetPurchaseInvoiceId: settlement.targetPurchaseInvoiceId
          }
        });
      }

      const payload: QboVendorCreditApplicationPayload = {
        VendorRef: vendorRef,
        TotalAmt: 0,
        TxnDate: settlement.appliedDate,
        PayType: "Check",
        CheckPayment: { BankAccountRef: bankRef },
        Line: [
          {
            Amount: settlement.appliedAmount,
            LinkedTxn: [{ TxnId: billRemoteId, TxnType: "Bill" }]
          },
          {
            Amount: settlement.appliedAmount,
            LinkedTxn: [{ TxnId: remoteId, TxnType: "VendorCredit" }]
          }
        ]
      };

      await this.qboProvider.applyVendorCredit(
        payload,
        buildQboRequestId(this.companyId, "vendorCreditApply", settlement.id)
      );
      applied.push(settlement.id);
    }

    this.appliedSettlementIds.set(localId, applied);
  }

  private async resolveBankAccountRef(local: QboMemoSource): Promise<Qbo.Ref> {
    const defaults = await this.getAccountDefaults();
    if (!defaults?.bankCashAccount) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot apply vendor credit for memo ${local.memoId}: QuickBooks Online requires a bank account on a BillPayment even when no cash moves, and no bank/cash account default is configured. Set it under Accounting → Account Defaults, then retry.`,
        warning: true,
        metadata: { memoId: local.id }
      });
    }

    const bankRef = (await this.getAccountRefsById()).get(
      defaults.bankCashAccount
    );
    if (!bankRef) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot apply vendor credit for memo ${local.memoId}: the company's bank/cash account is not mapped to a QuickBooks Online account, and a BillPayment requires one even at zero cash. Map it on the integration settings page, then retry.`,
        warning: true,
        metadata: {
          memoId: local.id,
          unmappedAccountIds: [defaults.bankCashAccount]
        }
      });
    }

    return bankRef;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: QboCreatePayload<Qbo.VendorCredit>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
