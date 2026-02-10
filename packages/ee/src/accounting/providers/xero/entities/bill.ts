import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { createMappingService } from "../../../core/external-mapping";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";

// Note: This syncer uses the default ID mapping from BaseEntitySyncer
// which uses the externalIntegrationMapping table with entityType "bill"

// Type for rows returned from purchaseInvoice queries
type BillRow = {
  id: string;
  companyId: string;
  invoiceId: string;
  supplierId: string | null;
  status:
    | "Draft"
    | "Pending"
    | "Submitted"
    | "Return"
    | "Debit Note Issued"
    | "Paid"
    | "Partially Paid"
    | "Overdue"
    | "Voided";
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
  customFields: Record<string, unknown> | null;
};

// Type for rows returned from purchaseInvoiceLine queries
type BillLineRow = {
  id: string;
  invoiceId: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  itemCode: string | null;
  purchaseOrderLineId: string | null;
};

// Status mapping between Carbon and Xero
const CARBON_TO_XERO_STATUS: Record<BillRow["status"], Xero.Invoice["Status"]> =
  {
    Draft: "DRAFT",
    Pending: "SUBMITTED",
    Submitted: "AUTHORISED",
    Return: "DRAFT", // No direct equivalent, map to DRAFT
    "Debit Note Issued": "AUTHORISED",
    Paid: "PAID",
    "Partially Paid": "AUTHORISED", // Xero tracks partial payment via AmountDue
    Overdue: "AUTHORISED", // Xero doesn't have overdue status
    Voided: "VOIDED"
  };

const XERO_TO_CARBON_STATUS: Record<
  Xero.Invoice["Status"],
  Accounting.Bill["status"]
> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending",
  AUTHORISED: "Submitted",
  PAID: "Paid",
  VOIDED: "Voided",
  DELETED: "Voided"
};

export class BillSyncer extends BaseEntitySyncer<
  Accounting.Bill,
  Xero.Invoice,
  "UpdatedDateUTC"
> {
  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // The entityType "bill" maps to the purchaseInvoice table
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    // Use the mapping service to link bill -> purchaseInvoice
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link("bill", localId, this.provider.id, remoteId, {
      remoteUpdatedAt
    });
  }

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Invoice): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
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
    if (ids.length === 0) return new Map();
    return this.fetchBillsByIds(ids);
  }

  private async fetchBillsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Bill>> {
    if (ids.length === 0) return new Map();

    // Fetch bills
    const billRows = await this.database
      .selectFrom("purchaseInvoice")
      .select([
        "id",
        "companyId",
        "invoiceId",
        "supplierId",
        "status",
        "dateIssued",
        "dateDue",
        "datePaid",
        "currencyCode",
        "exchangeRate",
        "subtotal",
        "totalTax",
        "totalDiscount",
        "totalAmount",
        "balance",
        "supplierReference",
        "updatedAt",
        "customFields"
      ])
      .where("id", "in", ids)
      .where("companyId", "=", this.companyId)
      .execute();

    if (billRows.length === 0) return new Map();

    // Fetch lines for all bills
    const billIds = billRows.map((b) => b.id);
    const lineRows = await this.database
      .selectFrom("purchaseInvoiceLine")
      .leftJoin("item", "item.id", "purchaseInvoiceLine.itemId")
      .select([
        "purchaseInvoiceLine.id",
        "purchaseInvoiceLine.invoiceId",
        "purchaseInvoiceLine.description",
        "purchaseInvoiceLine.quantity",
        "purchaseInvoiceLine.unitPrice",
        "purchaseInvoiceLine.itemId",
        "purchaseInvoiceLine.accountNumber",
        "purchaseInvoiceLine.taxPercent",
        "purchaseInvoiceLine.taxAmount",
        "purchaseInvoiceLine.totalAmount",
        "purchaseInvoiceLine.purchaseOrderLineId",
        "item.readableId as itemCode"
      ])
      .where("purchaseInvoiceLine.invoiceId", "in", billIds)
      .execute();

    // Fetch supplier external IDs for mapping via the mapping service
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
        const externalId = await mappingService.getExternalId(
          "supplier",
          supplierId,
          this.provider.id
        );
        supplierExternalIds.set(supplierId, externalId);
      }
    }

    // Group lines by invoice
    const linesByInvoice = new Map<string, BillLineRow[]>();
    for (const line of lineRows) {
      const existing = linesByInvoice.get(line.invoiceId) ?? [];
      existing.push(line as BillLineRow);
      linesByInvoice.set(line.invoiceId, existing);
    }

    // Transform to Accounting.Bill
    const result = new Map<string, Accounting.Bill>();
    for (const row of billRows) {
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

  async fetchRemote(id: string): Promise<Xero.Invoice | null> {
    const result = await this.provider.request<{ Invoices: Xero.Invoice[] }>(
      "GET",
      `/Invoices/${id}`
    );

    if (result.error) return null;

    const data = result.data as { Invoices: Xero.Invoice[] } | undefined;
    const invoice = data?.Invoices?.[0];

    // Only return if it's a Bill (ACCPAY)
    if (!invoice || invoice.Type !== "ACCPAY") {
      return null;
    }

    return invoice;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Invoice>> {
    const result = new Map<string, Xero.Invoice>();
    if (ids.length === 0) return result;

    const response = await this.provider.request<{ Invoices: Xero.Invoice[] }>(
      "GET",
      `/Invoices?IDs=${ids.join(",")}`
    );

    if (response.error) {
      throwXeroApiError("fetch bills batch", response);
    }

    const data = response.data as { Invoices: Xero.Invoice[] } | undefined;
    for (const invoice of data?.Invoices ?? []) {
      // Only include Bills (ACCPAY)
      if (invoice.Type === "ACCPAY") {
        result.set(invoice.InvoiceID, invoice);
      }
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Bill
  ): Promise<Omit<Xero.Invoice, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    // Get supplier's Xero ContactID - ensure supplier is synced first
    let contactId = local.supplierExternalId;
    if (!contactId && local.supplierId) {
      contactId = await this.ensureDependencySynced("vendor", local.supplierId);
    }

    if (!contactId) {
      throw new Error(
        `Cannot sync bill ${local.id}: No supplier linked or supplier not synced to Xero`
      );
    }

    // Get default account code from provider settings
    const xeroProvider = this.provider as XeroProvider;
    const defaultAccountCode =
      xeroProvider.settings?.defaultPurchaseAccountCode;

    // Map line items
    const lineItems: Xero.InvoiceLineItem[] = await Promise.all(
      local.lines.map(async (line) => {
        let itemCode = line.itemCode;

        // If we have an itemId but no itemCode, try to get it from the item table
        if (!itemCode && line.itemId) {
          const item = await this.database
            .selectFrom("item")
            .select("readableId")
            .where("id", "=", line.itemId)
            .executeTakeFirst();
          itemCode = item?.readableId ?? null;
        }

        // Embed PO line reference in description for later extraction
        let description = line.description ?? undefined;
        if (line.purchaseOrderLineId) {
          const ref = `[ref:${line.purchaseOrderLineId}]`;
          description = description ? `${description} ${ref}` : ref;
        }

        // Determine if line has tax
        const hasTax =
          (line.taxPercent != null && line.taxPercent > 0) ||
          (line.taxAmount != null && line.taxAmount > 0);

        return {
          Description: description,
          Quantity: line.quantity,
          UnitAmount: line.unitPrice,
          ItemCode: itemCode?.slice(0, 30) ?? undefined,
          // Use line's account number if specified, otherwise use default from settings
          AccountCode: line.accountNumber ?? defaultAccountCode,
          TaxAmount: line.taxAmount ?? undefined,
          LineAmount: line.totalAmount,
          // TaxType is required by Xero: INPUT for purchase tax, NONE for zero tax
          TaxType: hasTax ? "INPUT" : "NONE"
        };
      })
    );

    // Calculate due date: use dateDue if provided, otherwise default to Net 30
    let dueDate = local.dateDue;
    if (!dueDate && local.dateIssued) {
      const issued = new Date(local.dateIssued);
      issued.setDate(issued.getDate() + 30);
      dueDate = issued.toISOString().split("T")[0]; // YYYY-MM-DD format
    } else if (!dueDate) {
      // If no dateIssued either, default to 30 days from now
      const now = new Date();
      now.setDate(now.getDate() + 30);
      dueDate = now.toISOString().split("T")[0];
    }

    return {
      InvoiceID: existingRemoteId!,
      Type: "ACCPAY",
      InvoiceNumber: local.invoiceId,
      Reference: local.supplierReference ?? undefined,
      Contact: { ContactID: contactId },
      Date: local.dateIssued ?? undefined,
      DueDate: dueDate,
      Status: CARBON_TO_XERO_STATUS[local.status],
      CurrencyCode: local.currencyCode,
      CurrencyRate: local.exchangeRate !== 1 ? local.exchangeRate : undefined,
      LineItems: lineItems,
      SubTotal: local.subtotal,
      TotalTax: local.totalTax,
      Total: local.totalAmount
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Invoice
  ): Promise<Partial<Accounting.Bill>> {
    // Determine Carbon status based on Xero status and amounts
    let status = XERO_TO_CARBON_STATUS[remote.Status];

    // Check for partial payment
    if (
      remote.Status === "AUTHORISED" &&
      remote.AmountPaid &&
      remote.AmountPaid > 0 &&
      remote.AmountDue &&
      remote.AmountDue > 0
    ) {
      status = "Partially Paid";
    }

    // Check for overdue (would need to compare DueDate with current date)
    if (
      remote.Status === "AUTHORISED" &&
      remote.DueDate &&
      new Date(remote.DueDate) < new Date()
    ) {
      status = "Overdue";
    }

    // Map line items
    const lines: Accounting.BillLine[] = (remote.LineItems ?? []).map(
      (line, index) => {
        // Extract [ref:<id>] from description if present
        const refMatch = line.Description?.match(/\s*\[ref:([^\]]+)\]$/);
        const purchaseOrderLineId = refMatch?.[1] ?? null;
        const description =
          line.Description?.replace(/\s*\[ref:[^\]]+\]$/, "") ?? null;

        return {
          id: line.LineItemID ?? `temp-${index}`,
          description,
          quantity: line.Quantity ?? 1,
          unitPrice: line.UnitAmount ?? 0,
          itemId: null, // Will be resolved during upsertLocal if ItemCode matches
          itemCode: line.ItemCode ?? null,
          accountNumber: line.AccountCode ?? null,
          taxPercent: null,
          taxAmount: line.TaxAmount ?? null,
          totalAmount: line.LineAmount ?? 0,
          purchaseOrderLineId
        };
      }
    );

    return {
      invoiceId: remote.InvoiceNumber ?? remote.InvoiceID,
      supplierExternalId: remote.Contact.ContactID,
      status,
      dateIssued: remote.Date ?? null,
      dateDue: remote.DueDate ?? null,
      datePaid: remote.Status === "PAID" ? new Date().toISOString() : null,
      currencyCode: remote.CurrencyCode ?? "USD",
      exchangeRate: remote.CurrencyRate ?? 1,
      subtotal: remote.SubTotal ?? 0,
      totalTax: remote.TotalTax ?? 0,
      totalDiscount: 0,
      totalAmount: remote.Total ?? 0,
      balance: remote.AmountDue ?? 0,
      supplierReference: remote.Reference ?? null,
      lines,
      updatedAt: remote.UpdatedDateUTC
        ? parseDotnetDate(remote.UpdatedDateUTC).toISOString()
        : new Date().toISOString()
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Bill>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    // Resolve supplier from Xero ContactID using mapping service
    let supplierId: string | null = null;
    if (data.supplierExternalId) {
      const txMappingService = createMappingService(tx, this.companyId);
      supplierId = await txMappingService.getEntityId(
        this.provider.id,
        data.supplierExternalId,
        "supplier"
      );
    }

    if (existingLocalId) {
      // Update existing purchase invoice (mapping is handled by linkEntities in base class)
      await tx
        .updateTable("purchaseInvoice")
        .set({
          supplierId,
          status: data.status,
          dateIssued: data.dateIssued,
          dateDue: data.dateDue,
          datePaid: data.datePaid,
          currencyCode: data.currencyCode,
          exchangeRate: data.exchangeRate,
          subtotal: data.subtotal,
          totalTax: data.totalTax,
          totalDiscount: data.totalDiscount,
          totalAmount: data.totalAmount,
          balance: data.balance,
          supplierReference: data.supplierReference,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", existingLocalId)
        .where("companyId", "=", this.companyId)
        .execute();

      // Update lines - delete existing and recreate
      await this.upsertLines(tx, existingLocalId, data.lines ?? []);

      return existingLocalId;
    }

    // Create new purchase invoice from Xero
    // This requires: supplierInteractionId, invoiceId (sequence), createdBy, companyId

    if (!supplierId) {
      throw new Error(
        `Cannot create purchase invoice from Xero: Supplier with Xero ContactID ${data.supplierExternalId} not found in Carbon. Sync the vendor first.`
      );
    }

    // Get a default user for createdBy (company owner or first admin)
    const defaultUser = await this.getDefaultUser(tx);
    if (!defaultUser) {
      throw new Error(
        `Cannot create purchase invoice from Xero: No default user found for company ${this.companyId}`
      );
    }

    // Create supplier interaction for this invoice
    const supplierInteraction = await tx
      .insertInto("supplierInteraction")
      .values({
        companyId: this.companyId,
        supplierId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Get next invoice ID from sequence
    const sequenceResult = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('purchaseInvoice', ${this.companyId}) as get_next_sequence
    `.execute(tx);

    const invoiceId =
      sequenceResult.rows[0]?.get_next_sequence ??
      data.invoiceId ??
      `XERO-${remoteId.slice(0, 8)}`;

    // Insert the new purchase invoice
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
        balance: data.balance ?? 0,
        supplierReference: data.supplierReference ?? null
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Insert lines for the new invoice
    await this.upsertLines(tx, newInvoice.id, data.lines ?? []);

    return newInvoice.id;
  }

  /**
   * Get a default user for system-generated records.
   * Tries company owner first, then falls back to first active employee.
   */
  private async getDefaultUser(tx: KyselyTx): Promise<string | null> {
    // Try company owner first
    const company = await tx
      .selectFrom("company")
      .select("ownerId")
      .where("id", "=", this.companyId)
      .executeTakeFirst();

    if (company?.ownerId) {
      return company.ownerId;
    }

    // Fall back to first active employee for this company (by user creation date)
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
    // Delete existing lines
    await tx
      .deleteFrom("purchaseInvoiceLine")
      .where("invoiceId", "=", invoiceId)
      .execute();

    if (lines.length === 0) return;

    // Resolve item IDs from item codes
    const itemCodes = lines
      .map((l) => l.itemCode)
      .filter((code): code is string => code !== null);

    const itemMap = new Map<string, string>();
    if (itemCodes.length > 0) {
      const items = await tx
        .selectFrom("item")
        .select(["id", "readableId"])
        .where("readableId", "in", itemCodes)
        .where("companyId", "=", this.companyId)
        .execute();

      for (const item of items) {
        itemMap.set(item.readableId, item.id);
      }
    }

    // Get the invoice to get companyId and createdBy
    const invoice = await tx
      .selectFrom("purchaseInvoice")
      .select(["companyId", "createdBy", "exchangeRate"])
      .where("id", "=", invoiceId)
      .executeTakeFirstOrThrow();

    // Insert new lines
    for (const line of lines) {
      const itemId = line.itemCode
        ? (itemMap.get(line.itemCode) ?? null)
        : null;

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
          itemId,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent,
          taxAmount: line.taxAmount,
          supplierTaxAmount: line.taxAmount ?? 0,
          totalAmount: line.totalAmount,
          supplierExtendedPrice: line.totalAmount,
          exchangeRate: invoice.exchangeRate,
          invoiceLineType: itemId ? "Part" : "G/L Account",
          supplierShippingCost: 0
        })
        .execute();
    }
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.Invoice, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);
    const invoices = existingRemoteId
      ? [{ ...data, InvoiceID: existingRemoteId }]
      : [data];

    const result = await this.provider.request<{ Invoices: Xero.Invoice[] }>(
      "POST",
      "/Invoices",
      { body: JSON.stringify({ Invoices: invoices }) }
    );

    if (result.error) {
      throwXeroApiError(
        existingRemoteId ? "update bill" : "create bill",
        result
      );
    }

    if (!result.data?.Invoices?.[0]?.InvoiceID) {
      throw new Error(
        "Xero API returned success but no InvoiceID was returned for bill"
      );
    }

    return result.data.Invoices[0].InvoiceID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Invoice, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const invoices: Xero.Invoice[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      invoices.push(
        existingRemoteId
          ? ({ ...payload, InvoiceID: existingRemoteId } as Xero.Invoice)
          : (payload as Xero.Invoice)
      );
      localIdOrder.push(localId);
    }

    const response = await this.provider.request<{ Invoices: Xero.Invoice[] }>(
      "POST",
      "/Invoices",
      { body: JSON.stringify({ Invoices: invoices }) }
    );

    if (response.error) {
      throwXeroApiError("batch upsert bills", response);
    }

    if (!response.data?.Invoices) {
      throw new Error(
        "Xero API returned success but no Invoices array was returned for bills"
      );
    }

    for (let i = 0; i < response.data.Invoices.length; i++) {
      const returnedInvoice = response.data.Invoices[i];
      const localId = localIdOrder[i];
      if (returnedInvoice?.InvoiceID && localId) {
        result.set(localId, returnedInvoice.InvoiceID);
      }
    }

    return result;
  }
}
