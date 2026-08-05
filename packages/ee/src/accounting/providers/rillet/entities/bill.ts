import {
  buildDimensionValueMappingEntityId,
  loadJournalLineDimensions
} from "../../../core/dimension-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  collectUnmappedDimensionValues,
  JournalEntrySyncError,
  type JournalLineDimensionRef,
  toDebitSignedAmount,
  toPostingDateString
} from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type {
  Rillet,
  RilletBillCreate,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey, parseRilletFieldTarget } from "../provider";
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
 * for tests.
 *
 * Rillet bill items are ACCOUNT-COSTED, but Carbon purchase-invoice lines
 * often carry no explicit G/L account — item-backed lines resolve their
 * accounts at POSTING time (GR/IR clearing for received goods, variance
 * accounts, tax, ...). The posted "Purchase Invoice" journal is therefore
 * the source of truth for the bill's costing: its lines minus the AP
 * control line ARE the bill items (debit-signed amounts), and by
 * construction they always sum to the AP amount Rillet re-books through
 * its own bill mechanics. Throws structured Warnings when the journal is
 * missing (invoice not posted / accounting off) or an account is
 * unmapped.
 */
export type BillPostingJournalLine = {
  id: string;
  accountId: string | null;
  /** Debit-signed (already converted from Carbon's natural-balance sign). */
  amount: number;
  description: string | null;
  /** journalLineDimension rows — bill items inherit them as Field refs. */
  dimensions?: JournalLineDimensionRef[];
};

/**
 * The posting journal lines that become bill items: everything except the
 * AP control line(s) — Rillet re-books the payable through its own bill
 * mechanics. Shared by the mapper and the syncer's dimension pre-flight
 * (only costing lines push, so only their dimension values matter).
 */
export function filterBillCostingLines(
  lines: BillPostingJournalLine[],
  payablesAccountId: string | null
): BillPostingJournalLine[] {
  return lines.filter(
    (line) => line.accountId === null || line.accountId !== payablesAccountId
  );
}

export function mapBillToRilletBill(args: {
  bill: Accounting.Bill;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  /** Lines of the bill's posted Purchase Invoice journal(s), debit-signed. */
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

  const costingLines = filterBillCostingLines(
    args.postingJournalLines,
    args.payablesAccountId
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

  const items: Rillet.BillItem[] = costingLines.map((line) => {
    const fieldRefs: Rillet.ItemFieldRef[] = [];
    if (args.dimensions) {
      for (const slot of args.dimensions.slots) {
        const fieldId = parseRilletFieldTarget(slot.target);
        if (!fieldId) continue;
        const dimension = line.dimensions?.find(
          (candidate) => candidate.dimensionId === slot.dimensionId
        );
        if (!dimension) continue;
        const fieldValueId = args.dimensions.fieldValueIdsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!fieldValueId) continue; // drop policy — recorded by the caller
        fieldRefs.push({ field_id: fieldId, field_value_id: fieldValueId });
      }
    }

    return {
      account_code: args.accountCodesById.get(line.accountId!)!,
      amount: toRilletMoney(line.amount, currency),
      ...(line.description ? { description: line.description } : {}),
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

    const postingJournalLines = await this.fetchPostingJournalLines(local.id);
    const payablesAccountId = await this.getPayablesAccountId();

    // Dimension slots (same flow as the journal syncer): resolve the
    // value-mapping lookup and upsert missing Field values (autoCreate
    // default ON for Rillet), then apply the onUnmappedDimensionValue
    // policy over the COSTING lines — the AP control line never pushes,
    // so its dimensions never park a bill
    const settings = await this.getPostingSyncSettings();
    let dimensionValueMappings: Map<string, string> | undefined;
    if (settings.dimensionSlots.length > 0) {
      const costingLines = filterBillCostingLines(
        postingJournalLines,
        payablesAccountId
      );
      dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        costingLines,
        settings,
        dimensionValueMappings
      );

      const unmappedDimensionValues = collectUnmappedDimensionValues(
        costingLines,
        settings.dimensionSlots,
        dimensionValueMappings
      );
      if (unmappedDimensionValues.length > 0) {
        if (settings.onUnmappedDimensionValue === "warn") {
          throw new JournalEntrySyncError({
            errorCode: "UNMAPPED_DIMENSION_VALUES",
            message: `Bill ${local.invoiceId} carries ${unmappedDimensionValues.length} slotted dimension value(s) with no provider option mapping. Map the value(s) on the integration settings page (or enable auto-create on the slot), then retry.`,
            warning: true,
            metadata: { unmappedDimensionValues }
          });
        }
        // "drop" policy: pushed without these dimensions. The drain has
        // no success-metadata channel yet, so the record lives in the logs.
        console.warn("[RilletBillSyncer] dropped unmapped dimension values", {
          billId: local.id,
          droppedDimensionValues: unmappedDimensionValues
        });
      }
    }

    return mapBillToRilletBill({
      bill: local,
      vendorRemoteId,
      accountCodesById: await this.getAccountCodesById(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId,
      postingJournalLines,
      payablesAccountId,
      ...(dimensionValueMappings
        ? {
            dimensions: {
              slots: settings.dimensionSlots,
              fieldValueIdsByValue: dimensionValueMappings
            }
          }
        : {})
    });
  }

  /**
   * Lines of the bill's posted "Purchase Invoice" journal(s), debit-signed
   * — the source of truth for the bill's G/L costing (item-backed invoice
   * lines carry no account of their own; posting resolves GR/IR clearing,
   * variances and tax).
   */
  private async fetchPostingJournalLines(
    billId: string
  ): Promise<BillPostingJournalLine[]> {
    const rows = await this.database
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .leftJoin("account", "account.id", "journalLine.accountId")
      .select([
        "journalLine.id",
        "journalLine.accountId",
        "journalLine.amount",
        "journalLine.description",
        "account.class as accountClass"
      ])
      .where("journalLine.documentId", "=", billId)
      .where("journal.sourceType", "=", "Purchase Invoice")
      .where("journal.status", "=", "Posted")
      .where("journal.companyId", "=", this.companyId)
      .orderBy("journalLine.journalLineReference", "asc")
      .execute();

    const dimensionsByLine = await loadJournalLineDimensions(this.database, {
      companyId: this.companyId,
      journalLineIds: rows.map((row) => row.id)
    });

    return rows.map((row) => {
      const dimensions = dimensionsByLine.get(row.id);
      return {
        id: row.id,
        accountId: row.accountId ?? null,
        amount: toDebitSignedAmount(row.accountClass, Number(row.amount) || 0),
        description: row.description ?? null,
        ...(dimensions ? { dimensions } : {})
      };
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
