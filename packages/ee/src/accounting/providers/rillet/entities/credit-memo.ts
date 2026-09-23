import { resolveCreditReasonItem } from "../../../core/credit-reason-item";
import { JournalEntrySyncError } from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletCreditMemoCreate,
  RilletProductWrite,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadCompanyBaseCurrency,
  loadCurrencyDecimalPlaces,
  loadRilletAccountCodesById,
  loadRilletMemoReasonAccount,
  loadRilletMemoSources,
  type RilletMemoSource,
  RilletTransactionSyncer,
  resolveMemoSyncGate,
  toRilletExchangeRate,
  toRilletMoney,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletCreditMemoSyncer — a Carbon customer + Credit `memo` → a Rillet
 * credit memo (push-only, create-only; entityType "creditMemo").
 *
 * Rillet's `POST /credit-memos` has **no account-coded AR line variant
 * anywhere in the API**: every `items[]` entry REQUIRES
 * `price.product_id`, `price.quantity` and `price.amount_per_unit`. So the
 * memo's reason account is carried by a reason-bound PRODUCT
 * (`POST /products`, where `account_code` is a required field — a Rillet
 * product IS a GL binding), resolved once per reason account through the
 * shared `resolveCreditReasonItem` and remembered in
 * `externalIntegrationMapping` under `creditReasonItem`. `items[].revenue.
 * account_code` is set to the same account as well — a documented per-line
 * GL override, belt and braces.
 *
 * The product is a PROVIDER-SIDE ARTIFACT ONLY. No Carbon `item` row is
 * created; GL-mapping placeholders must never leak into item lists, BOMs,
 * inventory or MRP.
 *
 * Deliberately NOT a journal entry. A 2026-09-23 sandbox probe showed Rillet
 * accepts a journal to the AR control account but SILENTLY DISCARDS
 * `related_entity`, which would leave the control balance moved with no
 * subledger document behind it — an accounting break, not a limitation. Do
 * not add a journal fallback.
 *
 * Increasers (customer + Debit) are NOT supported in v1: `shouldSync`
 * returns a skip WITH a reason so the operation closes `Skipped` with the
 * limitation in `errorMessage`, never a silent drop and never a malformed
 * push.
 */

/** The memo header this syncer reads; aliased so the mapper's tests read against a stable name. */
export type CreditMemoSource = RilletMemoSource;

/** Rillet caps product names at 250 characters (`Rillet.ProductSchema`). */
const RILLET_PRODUCT_NAME_MAX_LENGTH = 250;

/**
 * The provider-side product a memo's reason account is bound to. Named after
 * the account and marked Carbon-managed, because the one place it IS visible
 * is the customer's own Rillet product list.
 */
export function buildCreditReasonProduct(args: {
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  accountCode: string;
  /** Company base currency — the nominal ONE_TIME price's currency. */
  currency: string;
  decimalPlaces: number;
  companyId: string;
}): RilletProductWrite {
  const label = args.accountNumber
    ? `${args.accountNumber} ${args.accountName}`
    : args.accountName;
  const name = `${label} (Carbon)`.slice(0, RILLET_PRODUCT_NAME_MAX_LENGTH);

  return {
    name,
    description: `Carbon credit memo reason account ${label}`,
    price: {
      type: "ONE_TIME",
      // Nominal: every credit memo item carries its own amount_per_unit.
      amount: toRilletMoney(0, args.currency, args.decimalPlaces)
    },
    include_in_arr_mrr: false,
    revenue_pattern: "DAILY",
    account_code: args.accountCode,
    status: "ACTIVE",
    external_references: [
      carbonExternalReference(args.accountId),
      carbonCompanyExternalReference(args.companyId)
    ]
  };
}

/**
 * Map a posted customer credit memo to the Rillet credit-memo create
 * payload. Pure — exported for tests.
 *
 * `quantity` is always 1 and `amount_per_unit` is the whole memo amount: a
 * memo is a single lump credit, not a priced line. `memo.amount` is in
 * `memo.currencyCode` (document currency), so `exchange_rate` pins the
 * directed provider rate exactly like an invoice.
 */
export function mapMemoToRilletCreditMemo(args: {
  memo: CreditMemoSource;
  /** Rillet product bound to the memo's reason account (`resolveCreditReasonItem`). */
  reasonProductId: string;
  /** Rillet account code of the memo's reason account — the per-line GL override. */
  reasonAccountCode: string;
  /** Fallback line description when the memo carries neither notes nor a reference. */
  reasonAccountName: string;
  decimalPlaces: number;
  baseCurrencyCode: string;
  customerRemoteId: string;
  subsidiaryId: string | null;
  companyId: string;
}): RilletCreditMemoCreate {
  const { memo } = args;
  const memoDate = memo.postingDate ?? memo.memoDate;

  const item: Rillet.CreditMemoItem = {
    description: memo.notes ?? memo.reference ?? args.reasonAccountName,
    price: {
      product_id: args.reasonProductId,
      quantity: 1,
      amount_per_unit: toRilletMoney(
        memo.amount,
        memo.currencyCode,
        args.decimalPlaces
      )
    },
    // Belt and braces: the product already binds this account, and the
    // per-line override says so again so a repointed product cannot silently
    // move the credit to another GL account.
    revenue: { account_code: args.reasonAccountCode }
  };

  return {
    customer_id: args.customerRemoteId,
    credit_memo_date: memoDate,
    credit_memo_number: memo.memoId,
    items: [item],
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    exchange_rate: toRilletExchangeRate({
      baseCurrencyCode: args.baseCurrencyCode,
      documentCurrencyCode: memo.currencyCode,
      foreignPerBaseRate: memo.exchangeRate,
      date: memoDate
    }),
    external_references: [
      carbonExternalReference(memo.id),
      carbonCompanyExternalReference(args.companyId)
    ]
  };
}

/**
 * Build the credit memo's COMPLETE application set from the memo's
 * `invoiceSettlement` rows. Pure — exported for tests.
 *
 * `POST /credit-memos/{id}/applications` is a **FULL RECONCILE**: Rillet
 * replaces the memo's entire application set with what one call carries, so
 * an entry omitted from this array is DELETED remotely. Two applied invoices
 * therefore produce ONE call with TWO entries, never two additive calls.
 */
export function buildRilletCreditMemoApplications(args: {
  memo: CreditMemoSource;
  invoiceRemoteIdsByLocalId: ReadonlyMap<string, string>;
  decimalPlaces: number;
}): Rillet.CreditMemoApplication[] {
  const { memo } = args;
  const applications: Rillet.CreditMemoApplication[] = [];

  for (const application of memo.applications) {
    const invoiceId = application.targetSalesInvoiceId;
    if (!invoiceId) continue;
    const remoteId = args.invoiceRemoteIdsByLocalId.get(invoiceId);
    if (!remoteId) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        message: `Cannot sync credit memo ${memo.memoId}: an invoice it is applied to is not synced to Rillet yet. Sync the invoice, then retry.`,
        metadata: { memoId: memo.id, salesInvoiceId: invoiceId }
      });
    }
    applications.push({
      invoice_id: remoteId,
      amount: toRilletMoney(
        application.amount,
        memo.currencyCode,
        args.decimalPlaces
      ),
      application_date: application.appliedDate
    });
  }

  return applications;
}

export class RilletCreditMemoSyncer extends RilletTransactionSyncer<
  CreditMemoSource,
  Rillet.CreditMemo,
  RilletTransactionWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private baseCurrencyPromise?: Promise<string>;
  private baseCurrencyDecimalsPromise?: Promise<number>;
  /** Resolved in mapToRemote, applied in upsertRemote: localId → complete set. */
  private readonly pendingApplications = new Map<
    string,
    Rillet.CreditMemoApplication[]
  >();

  protected get pushOnlyEntityLabel(): string {
    return "Credit memos";
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

  private async getBaseCurrencyDecimals(): Promise<number> {
    if (!this.baseCurrencyDecimalsPromise) {
      this.baseCurrencyDecimalsPromise = (async () =>
        loadCurrencyDecimalPlaces(this.database, {
          companyId: this.companyId,
          currencyCode: await this.getBaseCurrency()
        }))();
    }
    return this.baseCurrencyDecimalsPromise;
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected isVoided(local: CreditMemoSource): boolean {
    return local.status === "Voided";
  }

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.rilletProvider.deleteCreditMemo(remoteId);
  }

  async fetchLocal(id: string): Promise<CreditMemoSource | null> {
    const memos = await this.fetchMemosByIds([id]);
    return memos.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, CreditMemoSource>> {
    return this.fetchMemosByIds(ids);
  }

  private async fetchMemosByIds(
    ids: string[]
  ): Promise<Map<string, CreditMemoSource>> {
    return loadRilletMemoSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.CreditMemo | null> {
    return this.rilletProvider.getCreditMemo(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.CreditMemo>> {
    const result = new Map<string, Rillet.CreditMemo>();
    for (const id of ids) {
      const creditMemo = await this.rilletProvider.getCreditMemo(id);
      if (creditMemo) result.set(creditMemo.id, creditMemo);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — this syncer owns CUSTOMER memos only
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<CreditMemoSource, Rillet.CreditMemo>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Credit memos are push-only; pulling credit memos from Rillet is not supported";
    }
    if (!context.localEntity) return true;
    return resolveMemoSyncGate(context.localEntity, "customer");
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: CreditMemoSource
  ): Promise<RilletCreditMemoCreate> {
    // JIT dependency: customer before the document
    let customerRemoteId = local.partyExternalId;
    if (!customerRemoteId && local.customerId) {
      customerRemoteId = await this.ensureDependencySynced(
        "customer",
        local.customerId
      );
    }
    if (!customerRemoteId) {
      throw new Error(
        `Cannot sync credit memo ${local.id}: No customer linked or customer not synced to Rillet`
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
        message: `Cannot sync credit memo ${local.memoId}: its reason account has no Rillet account mapping. Map the account on the integration settings page, then retry.`,
        metadata: {
          memoId: local.id,
          unmappedAccountIds: [reasonAccount.accountId]
        }
      });
    }

    const reasonProductId = await this.resolveReasonProduct({
      accountId: reasonAccount.accountId,
      accountName: reasonAccount.name,
      accountNumber: reasonAccount.number,
      accountCode: reasonAccountCode
    });

    const decimalPlaces = await loadCurrencyDecimalPlaces(this.database, {
      companyId: this.companyId,
      currencyCode: local.currencyCode
    });

    // Resolve the applications BEFORE anything is created remotely, so an
    // unsynced target invoice parks the memo instead of orphaning a credit.
    this.pendingApplications.set(
      local.id,
      buildRilletCreditMemoApplications({
        memo: local,
        invoiceRemoteIdsByLocalId: await this.resolveInvoiceRemoteIds(local),
        decimalPlaces
      })
    );

    return mapMemoToRilletCreditMemo({
      memo: local,
      reasonProductId,
      reasonAccountCode,
      reasonAccountName: reasonAccount.name,
      decimalPlaces,
      baseCurrencyCode: await this.getBaseCurrency(),
      customerRemoteId,
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId
    });
  }

  /**
   * The Rillet product bound to this reason account — mapping-first, created
   * at most once per (company, account). `GET /products` cannot filter on
   * `external_references`, so the mapping row is the ONLY lookup; searching
   * Rillet would either miss and duplicate or drain every page.
   */
  private async resolveReasonProduct(args: {
    accountId: string;
    accountName: string;
    accountNumber: string | null;
    accountCode: string;
  }): Promise<string> {
    return resolveCreditReasonItem({
      mapping: this.mappingService,
      integration: this.provider.id,
      accountId: args.accountId,
      createItem: async (accountId) => {
        const payload = buildCreditReasonProduct({
          accountId,
          accountName: args.accountName,
          accountNumber: args.accountNumber,
          accountCode: args.accountCode,
          currency: await this.getBaseCurrency(),
          decimalPlaces: await this.getBaseCurrencyDecimals(),
          companyId: this.companyId
        });
        const created = await writeDroppingUnregisteredReferences(
          payload,
          (data) =>
            this.rilletProvider.createProduct(
              data,
              buildRilletIdempotencyKey({
                companyId: this.companyId,
                operation: "credit-reason-product",
                localId: accountId
              })
            )
        );
        return created.id;
      }
    });
  }

  /**
   * Carbon sales-invoice id → Rillet invoice id for every document this memo
   * is applied to, JIT-syncing any that is not linked yet (`creditMemo`
   * declares `dependsOn: ['customer','invoice']` for exactly this).
   */
  private async resolveInvoiceRemoteIds(
    memo: CreditMemoSource
  ): Promise<Map<string, string>> {
    const remoteIds = new Map<string, string>();
    const invoiceIds = [
      ...new Set(
        memo.applications
          .map((application) => application.targetSalesInvoiceId)
          .filter((id): id is string => id !== null)
      )
    ];
    for (const invoiceId of invoiceIds) {
      const mapped = await this.ensureDependencySynced("invoice", invoiceId);
      if (mapped) remoteIds.set(invoiceId, mapped);
    }
    return remoteIds;
  }

  // =================================================================
  // 5. UPSERT REMOTE (create-only) + applications (FULL RECONCILE)
  // =================================================================

  protected async upsertRemote(
    data: RilletCreditMemoCreate,
    localId: string
  ): Promise<string> {
    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createCreditMemo(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "credit-memo",
          localId
        })
      )
    );

    const applications = this.pendingApplications.get(localId) ?? [];
    if (applications.length > 0) {
      // ONE call carrying the COMPLETE set: the endpoint is a full reconcile,
      // so a second additive call would DELETE the entries of the first.
      await this.rilletProvider.applyCreditMemo(
        created.id,
        applications,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "credit-memo-applications",
          localId
        })
      );
    }
    this.pendingApplications.delete(localId);

    return created.id;
  }
}
