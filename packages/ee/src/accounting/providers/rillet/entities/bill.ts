import { buildDimensionValueMappingEntityId } from "../../../core/dimension-mapping";
import {
  type CostingLine,
  costingLineItemLabel,
  loadBillCostingLines,
  toTransactionCurrencyLines
} from "../../../core/document-costing";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  toPostingDateString
} from "../../../core/posting";
import type { Accounting, ShouldSyncContext } from "../../../core/types";
import type {
  Rillet,
  RilletBillCreate,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import type { RilletJournalDimensionArgs } from "./journal-entry";
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
 * there is no item/product reference on bills), so the bill reproduces the
 * bill's posted "Purchase Invoice" journal: its lines minus the AP control
 * line ARE the bill items (shared `loadBillCostingLines`). The item behind
 * each PO-backed line is a description LABEL only, never an account.
 *
 * Lines without an account, or with an unmapped account, fail as the
 * structured UNMAPPED_ACCOUNTS Warning — the user assigns/maps the account
 * and retries. There is deliberately NO silent fallback account: misclassed
 * AP expense in the ledger of record is worse than a parked operation.
 *
 * FX bills replay in the invoice's transaction currency (base ÷
 * `exchangeRate`, residue balanced) with `exchange_rate` pinned on the
 * payload. Base-currency bills are byte-identical to the pre-refactor output
 * (only descriptions gain an item label).
 *
 * `due_date` is REQUIRED by Rillet; when Carbon has none it falls back to
 * the bill date (Rillet's own default for invoices).
 */

// Only posted bills are pushed (Draft has no journal to replay) — mirrors the
// Rillet invoice syncer's posted-status gate.
const SYNCABLE_STATUSES: Accounting.Bill["status"][] = [
  "Pending",
  "Open",
  "Return",
  "Debit Note Issued",
  "Partially Paid",
  "Paid",
  "Overdue"
];

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
 * The costing lines that become bill items are the shared `CostingLine`
 * shape (base-currency, debit-signed, AP control line already excluded, with
 * item labels + dimensions attached). Kept as a local alias so the pure
 * mapper's tests read against a stable name.
 */
export type BillPostingJournalLine = CostingLine;

/** Prepend the item code/name label to a costing line's description so the
 * account-costed bill line still shows what was purchased. */
function describeCostingLine(line: CostingLine): string | undefined {
  const label = costingLineItemLabel(line);
  if (!label) return line.description ?? undefined;
  return line.description ? `${label} — ${line.description}` : label;
}

/**
 * Map a Carbon bill to the Rillet bill create payload. Pure — exported for
 * tests. `postingJournalLines` are the bill's costing lines (AP control line
 * already excluded by `loadBillCostingLines`); the mapper re-runs the AP
 * filter defensively so direct callers may pass raw journal lines too.
 *
 * The costing lines carry base-currency debit-signed amounts;
 * `bill.exchangeRate` converts them to the invoice's transaction currency
 * (pass-through at rate 1). Throws structured Warnings when the journal is
 * missing (invoice not posted / accounting off) or an account is unmapped.
 */
export function mapBillToRilletBill(args: {
  bill: Accounting.Bill;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  /** Costing lines of the bill's posted Purchase Invoice journal, debit-signed. */
  postingJournalLines: BillPostingJournalLine[];
  /** accountDefault.payablesAccount — the AP control line(s) to exclude. */
  payablesAccountId: string | null;
  /**
   * Slot config + resolved Field-value ids (same contract as the journal
   * mapper's RilletJournalDimensionArgs). Slotted line dimensions with no
   * resolvable value are OMITTED — the warn policy parks in the syncer
   * before mapping, so an unresolved value here is the recorded drop path.
   */
  dimensions?: RilletJournalDimensionArgs;
}): RilletBillCreate {
  const { bill } = args;
  const currency = bill.currencyCode;

  if (args.postingJournalLines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: no posted Purchase Invoice journal found — the bill's G/L costing comes from its posting journal. Post the invoice (with accounting enabled), then retry.`,
      warning: true,
      metadata: { billId: bill.id }
    });
  }

  // Defensive re-filter: loadBillCostingLines already dropped the AP control
  // line, but keep the filter so raw journal lines (tests) also work.
  const costingLines = args.postingJournalLines.filter(
    (line) =>
      line.accountId === null || line.accountId !== args.payablesAccountId
  );

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of costingLines) {
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

  // FX: convert base-currency amounts to the invoice's transaction currency
  // (pass-through at rate 1) and pin exchange_rate on the payload below.
  const transactionLines = toTransactionCurrencyLines(
    costingLines,
    bill.exchangeRate
  );

  const items: Rillet.BillItem[] = transactionLines.map((line) => {
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

    const description = describeCostingLine(line);

    return {
      account_code: args.accountCodesById.get(line.accountId!)!,
      amount: toRilletMoney(line.amount, currency),
      ...(description ? { description } : {}),
      ...(fieldRefs.length > 0 ? { fields: fieldRefs } : {})
    };
  });

  const billDate = toPostingDateString(
    bill.dateIssued ?? new Date().toISOString()
  );

  return {
    vendor_id: args.vendorRemoteId,
    expense_number: bill.invoiceId,
    bill_date: billDate,
    // due_date is REQUIRED by Rillet — fall back to the bill date
    due_date: toPostingDateString(bill.dateDue ?? billDate),
    items,
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    // Pin the provider exchange rate for FX bills (omit at parity rate 1).
    ...(bill.exchangeRate !== 1 ? { exchange_rate: bill.exchangeRate } : {}),
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
  // 3. SHOULD SYNC (posted-bill gate)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.Bill, Rillet.Bill>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Bills are push-only; pulling bills from Rillet is not supported";
    }

    if (context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Bill must be posted before syncing (current status: ${context.localEntity.status})`;
      }
    }

    return true;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet)
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

    const payablesAccountId = await this.getPayablesAccountId();
    const { lines: costingLines } = await loadBillCostingLines(this.database, {
      companyId: this.companyId,
      billId: local.id,
      payablesAccountId
    });

    // Send ALL dimensions on the bill: auto-provision every Rillet Field +
    // value the COSTING lines reference (the AP control line never pushes, so
    // its dimensions never reach Rillet). Rillet has no field cap, so nothing
    // is dropped for lack of a slot.
    const { fieldIdByDimensionId, fieldValueIdsByValue } =
      await this.resolveLineDimensions(costingLines);

    return mapBillToRilletBill({
      bill: local,
      vendorRemoteId,
      accountCodesById: await this.getAccountCodesById(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId,
      postingJournalLines: costingLines,
      payablesAccountId,
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue }
    });
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
  // 5. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
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
          localId
        })
      )
    );
    return created.id;
  }
}
