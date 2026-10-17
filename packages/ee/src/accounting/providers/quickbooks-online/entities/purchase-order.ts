// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  deriveRate,
  effectiveComponents,
  effectiveTaxPercent,
  recoverableTax,
  round,
  SCALE,
  splitLineTax,
  type TaxComponentInput
} from "@carbon/utils";
import { createMappingService } from "../../../core/external-mapping";
import { getTaxCodeMappings } from "../../../core/tax-mapping";
import {
  type Accounting,
  BaseEntitySyncer,
  type ShouldSyncContext
} from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";
import {
  buildQboTxnTaxDetail,
  isQboUsCompany,
  loadQboInvoiceTaxCatalog,
  type QboInvoiceTaxCatalog,
  type QboTaxCodeMappings,
  QboTaxContext,
  qboNonTaxableCode,
  resolveQboLineTax
} from "./invoice-tax";
import {
  buildQboDocNumberFields,
  buildQboExpenseLines,
  loadQboAccountRefsById,
  type QboWriteOmit,
  updateWithSyncTokenRetry,
  withQboExpenseTaxCode
} from "./shared";

/**
 * QboPurchaseOrderSyncer — Carbon purchase orders → QBO PurchaseOrder
 * objects (push-to-accounting, owner carbon per DEFAULT_SYNC_CONFIG;
 * entityType "purchaseOrder" like the Xero counterpart).
 *
 * Push: only POs in a locked status (same gate as the Xero counterpart).
 * VendorRef via JIT vendor sync, POEmail from the supplier's primary
 * contact, lines per the model (ItemBasedExpenseLineDetail for item lines,
 * AccountBasedExpenseLineDetail with the mapped account otherwise),
 * DocNumber under QBO's 21-char cap else PrivateNote. POStatus maps from
 * the Carbon status (Completed/Closed → Closed, else Open).
 *
 * Pull is update-only (dates/status back onto the Carbon PO) — POs are
 * never created from QBO, mirroring the Xero counterpart.
 */

// Only sync POs in locked statuses (behavior copied from the Xero syncer)
const SYNCABLE_STATUSES: Accounting.PurchaseOrder["status"][] = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
];

// Row shapes (mirror the Xero PO syncer's, plus line accountId for the
// account-mapping resolution QBO needs)
type PurchaseOrderRow = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: Accounting.PurchaseOrder["status"];
  orderDate: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  supplierReference: string | null;
  updatedAt: string | null;
};

type PurchaseOrderLineRow = {
  id: string;
  purchaseOrderId: string;
  description: string | null;
  purchaseQuantity: number | null;
  unitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  extendedPrice: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  itemCode: string | null;
};

/** Carbon PO status → QBO POStatus. Pure — exported for tests. */
export function mapCarbonPoStatusToQbo(
  status: Accounting.PurchaseOrder["status"]
): "Open" | "Closed" {
  return status === "Completed" || status === "Closed" ? "Closed" : "Open";
}

/** QBO POStatus → Carbon PO status. Pure — exported for tests. */
export function mapQboPoStatusToCarbon(
  status: "Open" | "Closed" | undefined
): Accounting.PurchaseOrder["status"] | undefined {
  if (!status) return undefined;
  return status === "Closed" ? "Closed" : "To Receive";
}

/** A purchase order line as its tax is resolved. Amounts are base currency,
 *  as the PO lines are sent. */
export type QboPurchaseOrderTaxLine = {
  id: string;
  taxCodeId: string | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
};

/**
 * The tax code of each PO line and the PO's `TxnTaxDetail`, outside the US:
 * - a code with recoverable tax: its mapped purchase code with the line's tax;
 * - a code at 0% (zero-rated, exempt): its mapped code with no tax;
 * - a code whose tax is folded into cost (0% recoverable): the non-taxable
 *   code, the tax left out as before;
 * - a legacy taxed line (no code): the one purchase rate of its percentage;
 * - an untaxed line with no code: the non-taxable code.
 * A partly recoverable line is not split as a bill line is: a PO posts
 * nothing, and an item line's amount must stay quantity × unit price.
 * `recoverableShares` is keyed by tax code id, 0..1. Pure — exported for
 * tests.
 */
export function resolveQboPurchaseOrderTax(args: {
  documentId: string;
  lines: ReadonlyArray<QboPurchaseOrderTaxLine>;
  recoverableShares: ReadonlyMap<string, number>;
  decimalPlaces: number;
  catalog: QboInvoiceTaxCatalog;
  mappings: QboTaxCodeMappings;
}): {
  lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>;
  txnTaxDetail: Qbo.TxnTaxDetail | undefined;
} {
  const lineTaxCodeRefs = new Map<string, Qbo.Ref>();
  const taxLines: Array<{
    rate: Qbo.TaxRate | null;
    netAmount: number;
    taxAmount: number;
  }> = [];
  for (const line of args.lines) {
    const netAmount = round(line.totalAmount, args.decimalPlaces);
    const taxAmount = line.taxAmount ?? 0;
    const taxPercent = line.taxPercent ?? 0;
    const foldedIntoCost =
      line.taxCodeId &&
      taxPercent !== 0 &&
      (args.recoverableShares.get(line.taxCodeId) ?? 0) === 0;
    if (
      foldedIntoCost ||
      (!line.taxCodeId && taxAmount === 0 && taxPercent === 0)
    ) {
      lineTaxCodeRefs.set(line.id, {
        value: qboNonTaxableCode(args.catalog, "purchase", args.documentId).Id
      });
      continue;
    }
    const match = resolveQboLineTax({
      documentId: args.documentId,
      direction: "purchase",
      taxCodeId: line.taxCodeId,
      taxPercent,
      netAmount,
      taxAmount,
      decimalPlaces: args.decimalPlaces,
      catalog: args.catalog,
      mappings: args.mappings
    });
    lineTaxCodeRefs.set(line.id, { value: match.code.Id });
    taxLines.push({ rate: match.rate, netAmount, taxAmount });
  }
  return {
    lineTaxCodeRefs,
    txnTaxDetail: buildQboTxnTaxDetail(taxLines, args.decimalPlaces)
  };
}

/**
 * The recoverable share (0..1) of each tax code's tax: its components in
 * force on `date` (every component when the date is unknown), split as a
 * posting splits a line's tax.
 */
async function loadRecoverableShares(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; taxCodeIds: string[]; date: string | null }
): Promise<Map<string, number>> {
  if (args.taxCodeIds.length === 0) return new Map();
  const rows = await database
    .selectFrom("taxCodeComponent")
    .select([
      "id",
      "taxCodeId",
      "name",
      "taxAuthorityId",
      "taxPercent",
      "recoverablePercent",
      "sequence",
      "isCompound",
      "taxReceivedAccountId",
      "taxPaidAccountId",
      "effectiveDate",
      "expirationDate"
    ])
    .where("companyId", "=", args.companyId)
    .where("taxCodeId", "in", args.taxCodeIds)
    .execute();
  return new Map(
    args.taxCodeIds.map((taxCodeId) => {
      const all: TaxComponentInput[] = rows
        .filter((row) => row.taxCodeId === taxCodeId)
        .map((row) => ({
          ...row,
          taxPercent: Number(row.taxPercent),
          recoverablePercent: Number(row.recoverablePercent)
        }));
      const components = args.date
        ? effectiveComponents({ components: all }, args.date)
        : all;
      const rate = effectiveTaxPercent(components);
      if (rate === 0) return [taxCodeId, 0];
      const parts = splitLineTax({
        base: 1,
        lineTax: rate,
        components,
        scale: SCALE
      });
      return [taxCodeId, deriveRate(recoverableTax(parts), rate)];
    })
  );
}

export class QboPurchaseOrderSyncer extends BaseEntitySyncer<
  Accounting.PurchaseOrder,
  Qbo.PurchaseOrder,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private baseDecimalPlacesPromise?: Promise<number>;
  private readonly taxContext = new QboTaxContext({
    catalog: () => loadQboInvoiceTaxCatalog(this.qboProvider),
    mappings: () =>
      getTaxCodeMappings(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      })
  });

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
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

  /** The company base currency's decimals — the PO lines are base amounts. */
  private getBaseDecimalPlaces(): Promise<number> {
    this.baseDecimalPlacesPromise ??= (async () => {
      const row = await this.database
        .selectFrom("company")
        .innerJoin("currency", (join) =>
          join
            .onRef("currency.code", "=", "company.baseCurrencyCode")
            .onRef("currency.companyGroupId", "=", "company.companyGroupId")
        )
        .select("currency.decimalPlaces")
        .where("company.id", "=", this.companyId)
        .executeTakeFirst();
      if (row?.decimalPlaces == null)
        throw new Error("Company base currency precision is required");
      return row.decimalPlaces;
    })().catch((error) => {
      this.baseDecimalPlacesPromise = undefined;
      throw error;
    });
    return this.baseDecimalPlacesPromise;
  }

  /**
   * The PO's tax outside the US, or null when it goes out as before: a PO
   * with no tax and no tax code, or any PO of a US company (QuickBooks US
   * has no purchase tax).
   */
  private async resolveTax(local: Accounting.PurchaseOrder): Promise<{
    lineTaxCodeRefs: ReadonlyMap<string, Qbo.Ref>;
    txnTaxDetail: Qbo.TxnTaxDetail | undefined;
  } | null> {
    const lineIds = local.lines.map((line) => line.id);
    const codes =
      lineIds.length > 0
        ? await this.database
            .selectFrom("purchaseOrderLine")
            .select(["id", "taxCodeId"])
            .where("id", "in", lineIds)
            .where("companyId", "=", this.companyId)
            .execute()
        : [];
    const taxCodeIds = new Map(codes.map((row) => [row.id, row.taxCodeId]));
    const taxed = local.lines.some(
      (line) =>
        (line.taxAmount ?? 0) !== 0 ||
        (line.taxPercent ?? 0) !== 0 ||
        taxCodeIds.get(line.id)
    );
    if (!taxed) return null;
    const catalog = await this.taxContext.catalog(local.id);
    if (isQboUsCompany(catalog)) return null;
    const [mappings, decimalPlaces, recoverableShares] = await Promise.all([
      this.taxContext.mappings(local.id),
      this.getBaseDecimalPlaces(),
      loadRecoverableShares(this.database, {
        companyId: this.companyId,
        taxCodeIds: [
          ...new Set(
            [...taxCodeIds.values()].filter((id): id is string => !!id)
          )
        ],
        date: local.orderDate ?? null
      })
    ]);
    return resolveQboPurchaseOrderTax({
      documentId: local.id,
      lines: local.lines.map((line) => ({
        id: line.id,
        taxCodeId: taxCodeIds.get(line.id) ?? null,
        taxPercent: line.taxPercent,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount
      })),
      recoverableShares,
      decimalPlaces,
      catalog,
      mappings
    });
  }

  // =================================================================
  // 1. ID MAPPING — default implementation (entityType "purchaseOrder")
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Qbo.PurchaseOrder): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.PurchaseOrder | null> {
    const orders = await this.fetchOrdersByIds([id]);
    return orders.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    return this.fetchOrdersByIds(ids);
  }

  private async fetchOrdersByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.PurchaseOrder>> {
    if (ids.length === 0) return new Map();

    const orderRows = await this.database
      .selectFrom("purchaseOrder")
      .select([
        "id",
        "companyId",
        "purchaseOrderId",
        "supplierId",
        "status",
        "orderDate",
        "currencyCode",
        "exchangeRate",
        "supplierReference",
        "updatedAt"
      ])
      .where("id", "in", ids)
      .where("companyId", "=", this.companyId)
      .execute();

    if (orderRows.length === 0) return new Map();

    const lineRows = await this.database
      .selectFrom("purchaseOrderLine")
      .leftJoin("item", "item.id", "purchaseOrderLine.itemId")
      .leftJoin("account", "account.id", "purchaseOrderLine.accountId")
      .select([
        "purchaseOrderLine.id",
        "purchaseOrderLine.purchaseOrderId",
        "purchaseOrderLine.description",
        "purchaseOrderLine.purchaseQuantity",
        "purchaseOrderLine.unitPrice",
        "purchaseOrderLine.itemId",
        "purchaseOrderLine.accountId",
        "purchaseOrderLine.taxPercent",
        "purchaseOrderLine.taxAmount",
        "purchaseOrderLine.extendedPrice",
        "purchaseOrderLine.quantityReceived",
        "purchaseOrderLine.quantityInvoiced",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where(
        "purchaseOrderLine.purchaseOrderId",
        "in",
        orderRows.map((o) => o.id)
      )
      .execute();

    // Supplier external IDs (entityType "vendor" — what the vendor syncer
    // stores)
    const supplierExternalIds = new Map<string, string | null>();
    const mappingService = createMappingService(this.database, this.companyId);
    for (const row of orderRows) {
      if (!supplierExternalIds.has(row.supplierId)) {
        supplierExternalIds.set(
          row.supplierId,
          await mappingService.getExternalId(
            "vendor",
            row.supplierId,
            this.provider.id
          )
        );
      }
    }

    const linesByOrder = new Map<string, PurchaseOrderLineRow[]>();
    for (const line of lineRows as PurchaseOrderLineRow[]) {
      const existing = linesByOrder.get(line.purchaseOrderId) ?? [];
      existing.push(line);
      linesByOrder.set(line.purchaseOrderId, existing);
    }

    const result = new Map<string, Accounting.PurchaseOrder>();
    for (const row of orderRows as PurchaseOrderRow[]) {
      const lines = linesByOrder.get(row.id) ?? [];

      let subtotal = 0;
      let totalTax = 0;
      for (const line of lines) {
        subtotal += Number(line.extendedPrice) || 0;
        totalTax += Number(line.taxAmount) || 0;
      }

      result.set(row.id, {
        id: row.id,
        companyId: row.companyId,
        purchaseOrderId: row.purchaseOrderId,
        supplierId: row.supplierId,
        supplierExternalId: supplierExternalIds.get(row.supplierId) ?? null,
        status: row.status,
        orderDate: row.orderDate,
        deliveryDate: null,
        deliveryAddress: null,
        deliveryInstructions: null,
        currencyCode: row.currencyCode,
        exchangeRate: Number(row.exchangeRate) || 1,
        subtotal,
        totalTax,
        totalAmount: subtotal + totalTax,
        supplierReference: row.supplierReference,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: Number(line.purchaseQuantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          itemId: line.itemId,
          itemCode: line.itemCode,
          accountId: line.accountId,
          accountNumber: line.accountNumber,
          taxPercent: line.taxPercent != null ? Number(line.taxPercent) : null,
          taxAmount: line.taxAmount != null ? Number(line.taxAmount) : null,
          totalAmount: Number(line.extendedPrice) || 0,
          quantityReceived:
            line.quantityReceived != null
              ? Number(line.quantityReceived)
              : null,
          quantityInvoiced:
            line.quantityInvoiced != null ? Number(line.quantityInvoiced) : null
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

  async fetchRemote(id: string): Promise<Qbo.PurchaseOrder | null> {
    return this.qboProvider.getPurchaseOrder(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.PurchaseOrder>> {
    const result = new Map<string, Qbo.PurchaseOrder>();
    for (const id of ids) {
      const purchaseOrder = await this.fetchRemote(id);
      if (purchaseOrder) result.set(purchaseOrder.Id, purchaseOrder);
    }
    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.PurchaseOrder
  ): Promise<Omit<Qbo.PurchaseOrder, QboWriteOmit>> {
    // Tax resolves before any dependency is pushed.
    const tax = await this.resolveTax(local);

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
        `Cannot sync PO ${local.id}: No supplier linked or supplier not synced to QuickBooks Online`
      );
    }

    // JIT dependencies: line items before the document
    const itemRemoteIds = new Map<string, string>();
    for (const line of local.lines) {
      if (line.itemId && !itemRemoteIds.has(line.itemId)) {
        itemRemoteIds.set(
          line.itemId,
          await this.ensureDependencySynced("item", line.itemId)
        );
      }
    }

    const accountRefsById = await this.getAccountRefsById();
    const supplierEmail = await this.getSupplierEmail(local.supplierId);

    const docNumber = buildQboDocNumberFields(
      local.purchaseOrderId,
      local.supplierReference ? `Ref ${local.supplierReference}` : undefined
    );

    return {
      DocNumber: docNumber.DocNumber,
      PrivateNote: docNumber.PrivateNote,
      TxnDate: local.orderDate ?? undefined,
      VendorRef: { value: vendorRemoteId },
      POEmail: supplierEmail ? { Address: supplierEmail } : undefined,
      POStatus: mapCarbonPoStatusToQbo(local.status),
      ...(tax
        ? {
            GlobalTaxCalculation: "TaxExcluded" as const,
            ...(tax.txnTaxDetail ? { TxnTaxDetail: tax.txnTaxDetail } : {})
          }
        : {}),
      Line: buildQboExpenseLines({
        lines: local.lines,
        itemRemoteIds,
        accountRefsById,
        documentLabel: `purchase order ${local.purchaseOrderId}`
      }).map((line, index) => {
        const taxCodeRef = tax?.lineTaxCodeRefs.get(local.lines[index]!.id);
        return taxCodeRef ? withQboExpenseTaxCode(line, taxCodeRef) : line;
      })
    };
  }

  /** Email of the supplier's first linked contact (for POEmail). */
  private async getSupplierEmail(supplierId: string): Promise<string | null> {
    const row = await this.database
      .selectFrom("supplierContact")
      .innerJoin("contact", "contact.id", "supplierContact.contactId")
      .select("contact.email")
      .where("supplierContact.supplierId", "=", supplierId)
      .executeTakeFirst();

    return row?.email ?? null;
  }

  // =================================================================
  // 6. TRANSFORMATION (QBO -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.PurchaseOrder
  ): Promise<Partial<Accounting.PurchaseOrder>> {
    return {
      purchaseOrderId: remote.DocNumber ?? remote.Id,
      supplierExternalId: remote.VendorRef.value,
      status: mapQboPoStatusToCarbon(remote.POStatus),
      orderDate: remote.TxnDate ?? null,
      totalAmount: remote.TotalAmt ?? 0,
      updatedAt:
        parseQboDate(remote.MetaData?.LastUpdatedTime)?.toISOString() ??
        new Date().toISOString()
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (Update existing only — Xero parity)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.PurchaseOrder>,
    remoteId: string
  ): Promise<string> {
    const existingLocalId = await this.getLocalId(remoteId);

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new purchase order from QuickBooks Online. PO with ID ${remoteId} must be created in Carbon first and then synced.`
      );
    }

    await tx
      .updateTable("purchaseOrder")
      .set({
        status: data.status,
        orderDate: data.orderDate,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .where("companyId", "=", this.companyId)
      .execute();

    return existingLocalId;
  }

  // =================================================================
  // 8. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.PurchaseOrder, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (!existingRemoteId) {
      const created = await this.qboProvider.createPurchaseOrder(data);
      return created.Id;
    }

    const updated = await updateWithSyncTokenRetry({
      entityLabel: "purchase order",
      remoteId: existingRemoteId,
      fetchCurrent: () => this.qboProvider.getPurchaseOrder(existingRemoteId),
      update: (syncToken) =>
        this.qboProvider.updatePurchaseOrder({
          ...data,
          Id: existingRemoteId,
          SyncToken: syncToken
        })
    });
    return updated.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Qbo.PurchaseOrder, QboWriteOmit>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }

  // =================================================================
  // 9. SHOULD SYNC (same gate as the Xero counterpart)
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<Accounting.PurchaseOrder, Qbo.PurchaseOrder>
  ): boolean | string {
    if (context.direction === "push" && context.localEntity) {
      if (!SYNCABLE_STATUSES.includes(context.localEntity.status)) {
        return `Purchase order must be in a locked status to sync (current: ${context.localEntity.status})`;
      }
    }

    return true;
  }
}
