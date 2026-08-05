import { createMappingService } from "../../../core/external-mapping";
import { JournalEntrySyncError } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type {
  Rillet,
  RilletBillCreate,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadRilletAccountCodesById,
  RilletTransactionSyncer,
  toRilletMoney,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletBillSyncer — Carbon purchase invoices → Rillet bills (push-only,
 * create-only; entityType "bill"). `expense_number` is Carbon's readable
 * purchase-invoice id.
 *
 * Rillet bill items are ACCOUNT-COSTED only (`account_code` + amount —
 * there is no item/product reference on bills), so every Carbon line must
 * resolve to a mapped G/L account through the account-mapping
 * externalCode map (the journal syncer's resolution path). Lines without
 * an account, or with an unmapped account, fail as the structured
 * UNMAPPED_ACCOUNTS Warning — the user assigns/maps the account and
 * retries. There is deliberately NO silent fallback account: misclassed
 * AP expense in the ledger of record is worse than a parked operation.
 *
 * `due_date` is REQUIRED by Rillet; when Carbon has none it falls back to
 * the bill date (Rillet's own default for invoices).
 */

// Row shapes (mirror the QBO bill syncer's)
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
 * Map a Carbon bill to the Rillet bill create payload. Pure — exported
 * for tests. Throws the structured UNMAPPED_ACCOUNTS Warning when any
 * line has no account or an unmapped account (same
 * unmappedAccountIds/lineIdsWithoutAccount metadata contract as the
 * journal pre-flight).
 */
export function mapBillToRilletBill(args: {
  bill: Accounting.Bill;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
}): RilletBillCreate {
  const { bill } = args;
  const currency = bill.currencyCode;

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of bill.lines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
      continue;
    }
    if (!args.accountCodesById.get(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }

  if (unmapped.size > 0 || lineIdsWithoutAccount.length > 0) {
    const parts: string[] = [];
    if (unmapped.size > 0) {
      parts.push(`${unmapped.size} account(s) have no Rillet account mapping`);
    }
    if (lineIdsWithoutAccount.length > 0) {
      parts.push(
        `${lineIdsWithoutAccount.length} line(s) have no G/L account (Rillet bill items are account-costed)`
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

  const items: Rillet.BillItem[] = bill.lines.map((line) => ({
    account_code: args.accountCodesById.get(line.accountId!)!,
    amount: toRilletMoney(line.totalAmount, currency),
    ...(line.description ? { description: line.description } : {})
  }));

  const billDate = (bill.dateIssued ?? new Date().toISOString()).slice(0, 10);

  return {
    vendor_id: args.vendorRemoteId,
    expense_number: bill.invoiceId,
    bill_date: billDate,
    // due_date is REQUIRED by Rillet — fall back to the bill date
    due_date: (bill.dateDue ?? billDate).slice(0, 10),
    items,
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    external_references: [
      carbonExternalReference(bill.id),
      carbonCompanyExternalReference(args.companyId)
    ]
  };
}

export class RilletBillSyncer extends RilletTransactionSyncer<
  Accounting.Bill,
  Rillet.Bill,
  RilletTransactionWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;

  protected get pushOnlyEntityLabel(): string {
    return "Bills";
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
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Bill | null> {
    return this.rilletProvider.getBill(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Bill>> {
    const result = new Map<string, Rillet.Bill>();
    for (const id of ids) {
      const bill = await this.rilletProvider.getBill(id);
      if (bill) result.set(bill.id, bill);
    }
    return result;
  }

  // =================================================================
  // 3. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Bill
  ): Promise<RilletBillCreate> {
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
        `Cannot sync bill ${local.id}: No supplier linked or supplier not synced to Rillet`
      );
    }

    return mapBillToRilletBill({
      bill: local,
      vendorRemoteId,
      accountCodesById: await this.getAccountCodesById(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId
    });
  }

  // =================================================================
  // 4. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
  //    already-mapped ids)
  // =================================================================

  protected async upsertRemote(
    data: RilletBillCreate,
    localId: string
  ): Promise<string> {
    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createBill(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "bill",
          localId,
          payload
        })
      )
    );
    return created.id;
  }
}
