import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import {
  type CostingLine,
  costingLineItemLabel,
  loadBillCostingLines,
  toTransactionCurrencyLines
} from "../../../core/document-costing";
import { createMappingService } from "../../../core/external-mapping";
import { JournalEntrySyncError, roundCurrency } from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboWriteOmit,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboBillSyncer — Carbon purchase invoices ↔ QBO Bill objects (two-way,
 * owner accounting per DEFAULT_SYNC_CONFIG; entityType "bill" like the
 * Xero counterpart).
 *
 * Push: VendorRef via JIT vendor sync; item lines →
 * ItemBasedExpenseLineDetail (ItemRef = the item's QBO id, JIT-synced),
 * non-item lines → AccountBasedExpenseLineDetail with the mapped account
 * (account-mapping service; unmapped → plain error, Failed). DocNumber
 * carries the Carbon invoice id under QBO's 21-char cap, else PrivateNote.
 *
 * Pull mirrors the Xero counterpart: status derived from
 * Balance/TotalAmt/DueDate, dates and totals back onto the Carbon
 * document, and — like Xero — a bill unknown to Carbon is created from the
 * remote (sequence id, supplier interaction, default user).
 */

// Row shapes (mirror the Xero bill syncer's, plus line accountId for the
// account-mapping resolution QBO needs)
type BillRow = {
  id: string;
  companyId: string;
  invoiceId: string;
  supplierId: string | null;
  status: Accounting.Bill["status"];
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number;
  supplierReference: string | null;
  updatedAt: string | null;
};

type BillLineRow = {
  id: string;
  invoiceId: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  itemCode: string | null;
  purchaseOrderLineId: string | null;
};

/**
 * Derive the Carbon bill status from QBO's Balance/TotalAmt/DueDate (QBO
 * bills carry no status enum). Pure — exported for tests.
 */
export function deriveCarbonBillStatus(args: {
  totalAmt: number | undefined;
  balance: number | undefined;
  dueDate: string | undefined;
  now?: Date;
}): Accounting.Bill["status"] | undefined {
  if (args.balance === undefined) return undefined;
  if (args.balance <= 0) return "Paid";
  if (args.totalAmt !== undefined && args.balance < args.totalAmt) {
    return "Partially Paid";
  }
  if (args.dueDate && new Date(args.dueDate) < (args.now ?? new Date())) {
    return "Overdue";
  }
  return "Open";
}

// Only posted bills are pushed (Draft has no journal to replay) — mirrors the
// QBO invoice syncer's posted-status gate.
const SYNCABLE_STATUSES: Accounting.Bill["status"][] = [
  "Pending",
  "Open",
  "Return",
  "Debit Note Issued",
  "Partially Paid",
  "Paid",
  "Overdue"
];

/**
 * Build QBO bill lines as an account-costed replay of the bill's posted
 * "Purchase Invoice" journal: one `AccountBasedExpenseLineDetail` per costing
 * line to the journal's mapped account (GR-IR / PPV / clearing), NEVER the
 * item's account. The item is a Description label only. Pure — exported for
 * tests. Amounts are already in the invoice's transaction currency
 * (`toTransactionCurrencyLines`). Tax-neutral: no `TxnTaxDetail`, no per-line
 * tax (the replay amounts embed tax; the purchase posting folds it into cost).
 *
 * Unmapped / account-less lines throw the structured UNMAPPED_ACCOUNTS
 * Warning (user-fixable: map the account, then retry) — the same envelope the
 * Rillet bill and the QBO journal syncer use.
 */
export function buildQboBillLines(args: {
  bill: Accounting.Bill;
  costingLines: CostingLine[];
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
}): Array<Omit<Qbo.ExpenseLine, "Id">> {
  const { bill } = args;

  if (args.costingLines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: no posted Purchase Invoice journal found — the bill's G/L costing comes from its posting journal. Post the invoice (with accounting enabled), then retry.`,
      warning: true,
      metadata: { billId: bill.id }
    });
  }

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of args.costingLines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
      continue;
    }
    if (!args.accountRefsById.get(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }

  if (unmapped.size > 0 || lineIdsWithoutAccount.length > 0) {
    const parts: string[] = [];
    if (unmapped.size > 0) {
      parts.push(
        `${unmapped.size} account(s) have no QuickBooks Online account mapping`
      );
    }
    if (lineIdsWithoutAccount.length > 0) {
      parts.push(
        `${lineIdsWithoutAccount.length} posting journal line(s) have no account`
      );
    }
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: ${parts.join(
        "; "
      )}. Map the account(s) on the integration settings page, then retry.`,
      warning: true,
      metadata: {
        billId: bill.id,
        unmappedAccountIds: [...unmapped],
        ...(lineIdsWithoutAccount.length > 0 ? { lineIdsWithoutAccount } : {})
      }
    });
  }

  return args.costingLines.map((line) => {
    const description = costingLineItemLabel(line) ?? line.description;
    return {
      Amount: roundCurrency(line.amount),
      ...(description ? { Description: description } : {}),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: args.accountRefsById.get(line.accountId!)!
      }
    };
  });
}

export class QboBillSyncer extends BaseEntitySyncer<
  Accounting.Bill,
  Qbo.Bill,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.Bill, "Id" | "SyncToken" | "MetaData"> | null
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

  // =================================================================
  // 1. ID MAPPING — default implementation (entityType "bill"), with
  //    SyncToken/LastUpdatedTime recorded on the mapping (Xero pattern)
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link("bill", localId, this.provider.id, remoteId, {
      remoteUpdatedAt:
        remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
      ...(seen?.syncToken !== undefined
        ? { metadata: { syncToken: seen.syncToken } }
        : {})
    });
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.Bill): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Bill | null> {
    const bills = await this.fetchBillsByIds([id]);
    return bills.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    return this.fetchBillsByIds(ids);
  }

  private async fetchBillsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    if (ids.length === 0) return new Map();

    const billRows = await this.database
      .selectFrom("purchaseInvoice")
      // `balance` is derived and lives only on the `purchaseInvoices` view
      .leftJoin("purchaseInvoices", "purchaseInvoices.id", "purchaseInvoice.id")
      .select([
        "purchaseInvoice.id",
        "purchaseInvoice.companyId",
        "purchaseInvoice.invoiceId",
        "purchaseInvoice.supplierId",
        "purchaseInvoice.status",
        "purchaseInvoice.dateIssued",
        "purchaseInvoice.dateDue",
        "purchaseInvoice.datePaid",
        "purchaseInvoice.currencyCode",
        "purchaseInvoice.exchangeRate",
        "purchaseInvoice.subtotal",
        "purchaseInvoice.totalTax",
        "purchaseInvoice.totalDiscount",
        "purchaseInvoice.totalAmount",
        "purchaseInvoices.balance",
        "purchaseInvoice.supplierReference",
        "purchaseInvoice.updatedAt"
      ])
      .where("purchaseInvoice.id", "in", ids)
      .where("purchaseInvoice.companyId", "=", this.companyId)
      .execute();

    if (billRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("purchaseInvoiceLine")
      .leftJoin("item", "item.id", "purchaseInvoiceLine.itemId")
      .leftJoin("account", "account.id", "purchaseInvoiceLine.accountId")
      .select([
        "purchaseInvoiceLine.id",
        "purchaseInvoiceLine.invoiceId",
        "purchaseInvoiceLine.description",
        "purchaseInvoiceLine.quantity",
        "purchaseInvoiceLine.unitPrice",
        "purchaseInvoiceLine.itemId",
        "purchaseInvoiceLine.accountId",
        "purchaseInvoiceLine.taxPercent",
        "purchaseInvoiceLine.taxAmount",
        "purchaseInvoiceLine.totalAmount",
        "purchaseInvoiceLine.purchaseOrderLineId",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where(
        "purchaseInvoiceLine.invoiceId",
        "in",
        billRows.map((b) => b.id)
      )
      .execute();

    // Supplier external IDs (entityType "vendor" — what the vendor syncer
    // stores)
    const supplierIds = billRows
      .map((b) => b.supplierId)
      .filter((id): id is string => id !== null);

    const supplierExternalIds = new Map<string, string | null>();
    if (supplierIds.length > 0) {
      const mappingService = createMappingService(
        this.database,
        this.companyId
      );
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
    }

    const linesByInvoice = new Map<string, BillLineRow[]>();
    for (const line of lineRows as BillLineRow[]) {
      const existing = linesByInvoice.get(line.invoiceId) ?? [];
      existing.push(line);
      linesByInvoice.set(line.invoiceId, existing);
    }

    const result = new Map<string, Accounting.Bill>();
    for (const row of billRows as BillRow[]) {
      const lines = linesByInvoice.get(row.id) ?? [];
      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        invoiceId: row.invoiceId,
        supplierId: row.supplierId,
        supplierExternalId: row.supplierId
          ? (supplierExternalIds.get(row.supplierId) ?? null)
          : null,
        status: row.status,
        dateIssued: row.dateIssued,
        dateDue: row.dateDue,
        datePaid: row.datePaid,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal: Number(row.subtotal) || 0,
        totalTax: Number(row.totalTax) || 0,
        totalDiscount: Number(row.totalDiscount) || 0,
        totalAmount: Number(row.totalAmount) || 0,
        balance: Number(row.balance) || 0,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemCode,
          accountId: line.accountId,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent != null ? Number(line.taxPercent) : null,
          taxAmount: line.taxAmount != null ? Number(line.taxAmount) : null,
          totalAmount: Number(line.totalAmount) || 0,
          purchaseOrderLineId: line.purchaseOrderLineId
        })),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Bill | null> {
    const bill = await this.qboProvider.getBill(id);
    this.rememberRemoteEntity(bill);
    return bill;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Bill>> {
    const result = new Map<string, Qbo.Bill>();
    for (const id of ids) {
      const bill = await this.fetchRemote(id);
      if (bill) result.set(bill.Id, bill);
    }
    return result;
  }

  // =================================================================
  // 5. SHOULD SYNC (posted-bill gate on push)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.Bill, Qbo.Bill>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Bill must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }

  // =================================================================
  // 6. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Bill
  ): Promise<Omit<Qbo.Bill, QboWriteOmit>> {
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
        `Cannot sync bill ${local.id}: No supplier linked or supplier not synced to QuickBooks Online`
      );
    }

    // Account-costed replay of the bill's posted Purchase Invoice journal —
    // the item is a label only, so NO item dependency sync is needed here (the
    // PO keeps item lines via buildQboExpenseLines; the bill does not).
    const accountRefsById = await this.getAccountRefsById();
    const payablesAccountId = await this.getPayablesAccountId();
    const {
      lines: costingLines,
      currencyCode,
      exchangeRate
    } = await loadBillCostingLines(this.database, {
      companyId: this.companyId,
      billId: local.id,
      payablesAccountId
    });

    const transactionLines = toTransactionCurrencyLines(
      costingLines,
      exchangeRate
    );

    // Due date: use dateDue if provided, otherwise default to Net 30
    // (Xero-syncer parity)
    let dueDate = local.dateDue;
    if (!dueDate && local.dateIssued) {
      const issued = new Date(local.dateIssued);
      issued.setDate(issued.getDate() + 30);
      dueDate = issued.toISOString().split("T")[0];
    } else if (!dueDate) {
      const now = new Date();
      now.setDate(now.getDate() + 30);
      dueDate = now.toISOString().split("T")[0];
    }

    const docNumber = buildQboDocNumberFields(
      local.invoiceId,
      local.supplierReference ? `Ref ${local.supplierReference}` : undefined
    );

    return {
      DocNumber: docNumber.DocNumber,
      PrivateNote: docNumber.PrivateNote,
      TxnDate: local.dateIssued ?? undefined,
      DueDate: dueDate,
      VendorRef: { value: vendorRemoteId },
      // FX: pin the currency + provider rate (omit both at parity rate 1).
      ...(exchangeRate !== 1
        ? {
            CurrencyRef: { value: currencyCode },
            ExchangeRate: exchangeRate
          }
        : {}),
      Line: buildQboBillLines({
        bill: local,
        costingLines: transactionLines,
        accountRefsById
      })
    };
  }

  /** accountDefault.payablesAccount — the AP control line to exclude. */
  private async getPayablesAccountId(): Promise<string | null> {
    const defaults = await this.database
      .selectFrom("accountDefault")
      .select("payablesAccount")
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();
    return defaults?.payablesAccount ?? null;
  }

  // =================================================================
  // 6. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.Bill
  ): Promise<Partial<Accounting.Bill>> {
    const mappingService = createMappingService(this.database, this.companyId);

    const lines: Accounting.BillLine[] = [];
    for (const [index, line] of (remote.Line ?? []).entries()) {
      const isItemLine = line.DetailType === "ItemBasedExpenseLineDetail";
      const isAccountLine = line.DetailType === "AccountBasedExpenseLineDetail";
      if (!isItemLine && !isAccountLine) continue;

      // Resolve the Carbon item from the QBO ItemRef via the mapping table
      let itemId: string | null = null;
      const remoteItemId = line.ItemBasedExpenseLineDetail?.ItemRef?.value;
      if (remoteItemId) {
        itemId = await mappingService.getEntityId(
          this.provider.id,
          remoteItemId,
          "item"
        );
      }

      // Resolve the Carbon account from the QBO AccountRef via the account
      // mapping (externalId → account.id)
      let accountId: string | null = null;
      const remoteAccountId =
        line.AccountBasedExpenseLineDetail?.AccountRef.value;
      if (remoteAccountId) {
        accountId = await mappingService.getEntityId(
          this.provider.id,
          remoteAccountId,
          "account"
        );
      }

      lines.push({
        id: line.Id ?? `temp-${index}`,
        description: line.Description ?? null,
        quantity: line.ItemBasedExpenseLineDetail?.Qty ?? 1,
        unitPrice: line.ItemBasedExpenseLineDetail?.UnitPrice ?? line.Amount,
        itemId,
        itemCode: null,
        accountId,
        accountNumber: null,
        taxPercent: null,
        taxAmount: null,
        totalAmount: line.Amount,
        purchaseOrderLineId: null
      });
    }

    return {
      invoiceId: remote.DocNumber ?? remote.Id,
      supplierExternalId: remote.VendorRef.value,
      status: deriveCarbonBillStatus({
        totalAmt: remote.TotalAmt,
        balance: remote.Balance,
        dueDate: remote.DueDate
      }),
      dateIssued: remote.TxnDate ?? null,
      dateDue: remote.DueDate ?? null,
      datePaid: remote.Balance === 0 ? new Date().toISOString() : null,
      totalAmount: remote.TotalAmt ?? 0,
      balance: remote.Balance ?? 0,
      lines,
      updatedAt:
        parseQboDate(remote.MetaData?.LastUpdatedTime)?.toISOString() ??
        new Date().toISOString()
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (update existing, or create from remote — Xero parity)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Bill>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    // Resolve supplier from the QBO VendorRef via the vendor mapping
    let supplierId: string | null = null;
    if (data.supplierExternalId) {
      const txMappingService = createMappingService(tx, this.companyId);
      supplierId = await txMappingService.getEntityId(
        this.provider.id,
        data.supplierExternalId,
        "vendor"
      );
    }

    if (existingLocalId) {
      await tx
        .updateTable("purchaseInvoice")
        .set({
          supplierId,
          status: data.status,
          dateIssued: data.dateIssued,
          dateDue: data.dateDue,
          datePaid: data.datePaid,
          totalAmount: data.totalAmount,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .where("companyId", "=", this.companyId)
        .execute();

      await this.upsertLines(tx, existingLocalId, data.lines ?? []);

      return existingLocalId;
    }

    // Create a new purchase invoice from QBO (Xero-syncer parity)
    if (!supplierId) {
      throw new Error(
        `Cannot create purchase invoice from QuickBooks Online: Vendor ${data.supplierExternalId} not found in Carbon. Sync the vendor first.`
      );
    }

    const defaultUser = await this.getDefaultUser(tx);
    if (!defaultUser) {
      throw new Error(
        `Cannot create purchase invoice from QuickBooks Online: No default user found for company ${this.companyId}`
      );
    }

    const supplierInteraction = await tx
      .insertInto("supplierInteraction")
      .values({
        companyId: this.companyId,
        supplierId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const sequenceResult = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('purchaseInvoice', ${this.companyId}) as get_next_sequence
    `.execute(tx);

    const invoiceId =
      sequenceResult.rows[0]?.get_next_sequence ??
      data.invoiceId ??
      `QBO-${remoteId.slice(0, 8)}`;

    const newInvoice = await tx
      .insertInto("purchaseInvoice")
      .values({
        invoiceId,
        companyId: this.companyId,
        createdBy: defaultUser,
        supplierId,
        supplierInteractionId: supplierInteraction.id,
        status: data.status ?? "Draft",
        dateIssued: data.dateIssued ?? null,
        dateDue: data.dateDue ?? null,
        datePaid: data.datePaid ?? null,
        currencyCode: data.currencyCode ?? "USD",
        exchangeRate: data.exchangeRate ?? 1,
        subtotal: data.subtotal ?? 0,
        totalTax: data.totalTax ?? 0,
        totalDiscount: data.totalDiscount ?? 0,
        totalAmount: data.totalAmount ?? 0,
        supplierReference: data.supplierReference ?? null
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await this.upsertLines(tx, newInvoice.id, data.lines ?? []);

    return newInvoice.id;
  }

  /**
   * Default user for system-generated records: company group owner, then
   * first active employee (Xero-syncer parity).
   */
  private async getDefaultUser(tx: KyselyTx): Promise<string | null> {
    const group = await tx
      .selectFrom("company")
      .innerJoin("companyGroup", "companyGroup.id", "company.companyGroupId")
      .select("companyGroup.ownerId")
      .where("company.id", "=", this.companyId)
      .executeTakeFirst();

    if (group?.ownerId) {
      return group.ownerId;
    }

    const employee = await tx
      .selectFrom("employeeJob")
      .innerJoin("user", "user.id", "employeeJob.id")
      .select("employeeJob.id")
      .where("employeeJob.companyId", "=", this.companyId)
      .where("user.active", "=", true)
      .orderBy("user.createdAt", "asc")
      .limit(1)
      .executeTakeFirst();

    return employee?.id ?? null;
  }

  private async upsertLines(
    tx: KyselyTx,
    invoiceId: string,
    lines: Accounting.BillLine[]
  ): Promise<void> {
    await tx
      .deleteFrom("purchaseInvoiceLine")
      .where("invoiceId", "=", invoiceId)
      .execute();

    if (lines.length === 0) return;

    const invoice = await tx
      .selectFrom("purchaseInvoice")
      .select(["companyId", "createdBy", "exchangeRate"])
      .where("id", "=", invoiceId)
      .executeTakeFirstOrThrow();

    for (const line of lines) {
      await tx
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId,
          companyId: invoice.companyId,
          createdBy: invoice.createdBy,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          supplierUnitPrice: line.unitPrice,
          itemId: line.itemId,
          accountId: line.accountId ?? null,
          taxPercent: line.taxPercent,
          taxAmount: line.taxAmount,
          supplierTaxAmount: line.taxAmount ?? 0,
          totalAmount: line.totalAmount,
          supplierExtendedPrice: line.totalAmount,
          exchangeRate: invoice.exchangeRate,
          invoiceLineType: line.itemId ? "Part" : "G/L Account",
          supplierShippingCost: 0
        })
        .execute();
    }
  }

  // =================================================================
  // 8. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.Bill, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (!existingRemoteId) {
      const created = await this.qboProvider.createBill(data);
      this.rememberRemoteEntity(created);
      return created.Id;
    }

    const updated = await updateWithSyncTokenRetry({
      entityLabel: "bill",
      remoteId: existingRemoteId,
      fetchCurrent: () => this.qboProvider.getBill(existingRemoteId),
      update: (syncToken) =>
        this.qboProvider.updateBill({
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
      payload: Omit<Qbo.Bill, QboWriteOmit>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
