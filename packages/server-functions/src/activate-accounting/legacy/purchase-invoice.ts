// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy purchase invoice: the lines `post-purchase-invoice`
// writes today, from the stored invoice, with today's account defaults
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a). Amounts come from
// `calculatePurchasePostingAmounts`, which converts the header freight at the
// invoice's exchange rate as the posting does. The lines and their dimensions
// come from `buildPurchaseInvoicePostingLines`, the posting's own builder; this
// file only reads the facts it needs from the stored rows. Every line but a
// comment is written, at zero too, so an invoice with one is journaled
// (`legacyPurchaseInvoices` leaves out a comment-only one).
//
// The GR/IR walk of the posting reads the receipts' journals, which a legacy
// receipt does not have. So a receipt's cost is its cost layers, else its
// quantity at the receipt line's unit price, as the opening received-not-
// invoiced item costs it. The receipts and invoices before this invoice are
// what the posting saw: receipts posted on or before its posting date, and
// the posted invoices on the same PO line ordered before it by posting date
// and creation. A receipt posted later on the same day counts as before it,
// and an invoice voided since does not count.
//
// The variance on inventory is the adjustment children the posting stored on
// receipt layers dated on or after the cutover; the reset closes the older
// layers, and their write-up with them. The rest of the variance is purchase
// variance, so a company that wrote no children books all of it there.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { resolveDefaultAccount } from "@carbon/database/journal-posting-status";
import {
  legacyPurchaseInvoices,
  POSTED_INVOICE_EXCLUDED_STATUSES
} from "@carbon/database/legacy-documents";
import { EPSILON } from "@carbon/utils";
import { sql } from "kysely";
import { InvalidInputError } from "../../errors";
import {
  buildPurchaseInvoicePostingLines,
  isItemLineType,
  type PurchaseInvoiceItem,
  type PurchaseInvoicePostingLine
} from "../../post-purchase-invoice/posting-lines";
import { calculatePurchasePostingAmounts } from "../../post-purchase-invoice/purchase-posting-amounts";
import { type LegacyJournal, readByIds } from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

type ReceiptGroup = { postingDate: string; quantity: number; cost: number };

export async function buildLegacyPurchaseInvoiceJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<LegacyJournal[]> {
  const invoices = await legacyPurchaseInvoices(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (invoices.length === 0) return [];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const lines = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceLine")
      .selectAll()
      .where("companyId", "=", companyId)
      .where("invoiceId", "in", ids)
      .orderBy("invoiceId")
      .orderBy("createdAt")
      .orderBy("id")
      .execute()
  );
  const itemIds = lines.map((line) => line.itemId);
  const purchaseOrderLineIds = lines.map((line) => line.purchaseOrderLineId);

  const deliveries = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceDelivery")
      .select(["id", "supplierShippingCost"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const suppliers = await readByIds(
    invoices.map((invoice) => invoice.supplierId),
    (ids) =>
      trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId", "intercompanyCompanyId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const items = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId", "costingMethod"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const purchaseOrderLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("purchaseOrderLine")
      .select(["id", "jobOperationId", "locationId"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const jobOperations = await readByIds(
    purchaseOrderLines.map((line) => line.jobOperationId),
    (ids) =>
      trx
        .selectFrom("jobOperation")
        .select(["id", "processId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  // Each PO line's receipts, in the order the posting's walk reads them.
  const receiptLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("receiptLine as line")
      .innerJoin("receipt", (join) =>
        join
          .onRef("receipt.id", "=", "line.receiptId")
          .onRef("receipt.companyId", "=", "line.companyId")
      )
      .select([
        "line.receiptId",
        "line.lineId",
        "line.itemId",
        "line.receivedQuantity",
        "line.unitPrice",
        "receipt.postingDate"
      ])
      .where("line.companyId", "=", companyId)
      .where("receipt.status", "=", "Posted")
      .where("receipt.sourceDocument", "=", "Purchase Order")
      .where("line.lineId", "in", ids)
      .where("line.receivedQuantity", ">", 0)
      .orderBy("receipt.postingDate")
      .orderBy("receipt.createdAt")
      .orderBy("receipt.id")
      .execute()
  );
  const receiptLayers = await readByIds(
    receiptLines.map((line) => line.receiptId),
    (ids) =>
      trx
        .selectFrom("costLedger")
        .select([
          "documentId",
          "itemId",
          sql<number>`sum("cost")`.as("cost"),
          sql<number>`sum("quantity")`.as("quantity")
        ])
        .where("companyId", "=", companyId)
        .where("documentType", "=", "Purchase Receipt")
        .where("documentId", "in", ids)
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        .where("quantity", ">", 0)
        .groupBy(["documentId", "itemId"])
        .execute()
  );
  // Every posted invoice line on these PO lines, in posting order: what was
  // invoiced before each legacy invoice.
  const invoicedLines = await readByIds(purchaseOrderLineIds, (ids) =>
    trx
      .selectFrom("purchaseInvoiceLine as line")
      .innerJoin("purchaseInvoice as invoice", (join) =>
        join
          .onRef("invoice.id", "=", "line.invoiceId")
          .onRef("invoice.companyId", "=", "line.companyId")
      )
      .select([
        "invoice.id as invoiceId",
        "line.purchaseOrderLineId",
        "line.quantity",
        "line.conversionFactor"
      ])
      .where("line.companyId", "=", companyId)
      .where("line.purchaseOrderLineId", "in", ids)
      .where("invoice.status", "not in", [...POSTED_INVOICE_EXCLUDED_STATUSES])
      .orderBy("invoice.postingDate")
      .orderBy("invoice.createdAt")
      .orderBy("invoice.id")
      .execute()
  );
  // The invoice's write-up of receipt layers that survive the reset.
  const writeUps = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("costLedger as child")
      .innerJoin("costLedger as layer", (join) =>
        join
          .onRef("layer.id", "=", "child.appliesToCostLedgerId")
          .onRef("layer.companyId", "=", "child.companyId")
      )
      .select([
        "child.documentId",
        "child.itemId",
        sql<number>`sum("child"."cost")`.as("cost")
      ])
      .where("child.companyId", "=", companyId)
      .where("child.adjustment", "=", true)
      .where("child.documentType", "=", "Purchase Invoice")
      .where("child.documentId", "in", ids)
      .where("layer.postingDate", ">=", cutoverDate)
      .groupBy(["child.documentId", "child.itemId"])
      .execute()
  );
  // A direct stock line whose receipt was posted with the invoice wrote an
  // item ledger row under the invoice; one whose receipt was left Draft
  // (skipReceiptPost) wrote none and booked WIP.
  const receivedWithInvoice = await readByIds(invoiceIds, (ids) =>
    trx
      .selectFrom("itemLedger")
      .select(["documentId", "itemId"])
      .distinct()
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Purchase Receipt")
      .where("documentId", "in", ids)
      .execute()
  );
  const assets = await readByIds(
    lines.map((line) => line.assetId),
    (ids) =>
      trx
        .selectFrom("fixedAsset as asset")
        .innerJoin("fixedAssetClass as class", (join) =>
          join
            .onRef("class.id", "=", "asset.fixedAssetClassId")
            .onRef("class.companyId", "=", "asset.companyId")
        )
        .select([
          "asset.id",
          "asset.locationId",
          "asset.fixedAssetClassId",
          "class.assetAccountId"
        ])
        .where("asset.companyId", "=", companyId)
        .where("asset.id", "in", ids)
        .execute()
  );
  const glAccounts = await readByIds(
    lines.map((line) => line.accountId),
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "name", "isGroup"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );

  const linesByInvoice = Map.groupBy(lines, (line) => line.invoiceId);
  const shippingByInvoice = new Map(
    deliveries.map((row) => [row.id, Number(row.supplierShippingCost ?? 0)])
  );
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));
  const itemCostByItem = new Map(itemCosts.map((row) => [row.itemId, row]));
  const purchaseOrderLineById = new Map(
    purchaseOrderLines.map((row) => [row.id, row])
  );
  const processByOperation = new Map(
    jobOperations.map((row) => [row.id, row.processId])
  );
  const assetById = new Map(assets.map((row) => [row.id, row]));
  const glAccountById = new Map(glAccounts.map((row) => [row.id, row]));
  const receivedWithInvoiceKeys = new Set(
    receivedWithInvoice.map((row) => `${row.documentId}:${row.itemId}`)
  );
  const writeUpByInvoiceItem = new Map(
    writeUps.map((row) => [`${row.documentId}:${row.itemId}`, Number(row.cost)])
  );

  // Receipt groups per PO line, one per receipt, costed from the layers.
  const layerByReceiptItem = new Map(
    receiptLayers.map((row) => [
      `${row.documentId}:${row.itemId}`,
      { cost: Number(row.cost), quantity: Number(row.quantity) }
    ])
  );
  const receiptsByLine = new Map<string, ReceiptGroup[]>();
  const groupByReceiptLine = new Map<string, ReceiptGroup>();
  for (const line of receiptLines) {
    const purchaseOrderLineId = line.lineId as string;
    const quantity = Number(line.receivedQuantity);
    const layer = layerByReceiptItem.get(`${line.receiptId}:${line.itemId}`);
    const cost =
      layer && layer.quantity > EPSILON
        ? (quantity / layer.quantity) * layer.cost
        : quantity * Number(line.unitPrice ?? 0);
    const key = `${line.receiptId}:${purchaseOrderLineId}`;
    const group = groupByReceiptLine.get(key);
    if (group) {
      group.quantity += quantity;
      group.cost += cost;
      continue;
    }
    const created = {
      postingDate: String(line.postingDate),
      quantity,
      cost
    };
    groupByReceiptLine.set(key, created);
    const list = receiptsByLine.get(purchaseOrderLineId);
    if (list) list.push(created);
    else receiptsByLine.set(purchaseOrderLineId, [created]);
  }

  // What the invoices posted before an invoice invoiced on a PO line, in
  // inventory units. A PO line's rows are in posting order.
  const invoicedRowsByLine = Map.groupBy(
    invoicedLines,
    (row) => row.purchaseOrderLineId
  );
  const invoicedBefore = (invoiceId: string, purchaseOrderLineId: string) => {
    let sum = 0;
    for (const row of invoicedRowsByLine.get(purchaseOrderLineId) ?? []) {
      if (row.invoiceId === invoiceId) break;
      sum += Number(row.quantity) * Number(row.conversionFactor ?? 1);
    }
    return sum;
  };

  return invoices.map((invoice) => {
    const supplier = invoice.supplierId
      ? supplierById.get(invoice.supplierId)
      : undefined;
    // An intercompany payable before the cutover: a stand-in when its
    // default is empty, which the enable re-points.
    const payables = supplier?.intercompanyCompanyId
      ? resolveDefaultAccount(
          defaults,
          "intercompanyPayablesAccount",
          "Provisional"
        )
      : { accountId: defaults.payablesAccount, accountDefaultRole: null };
    const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
    const amountsByLine = new Map(
      calculatePurchasePostingAmounts({
        lines: invoiceLines,
        exchangeRate: invoice.exchangeRate ?? 1,
        supplierShippingCost: shippingByInvoice.get(invoice.id) ?? 0
      }).map((amounts) => [amounts.id, amounts])
    );
    const postingDate = String(invoice.postingDate);
    /** The receipts the posting saw: posted on or before the invoice. */
    const receiptsBefore = (purchaseOrderLineId: string) =>
      (receiptsByLine.get(purchaseOrderLineId) ?? []).filter(
        (group) => group.postingDate <= postingDate
      );

    const postingLines: PurchaseInvoicePostingLine[] = [];
    for (const invoiceLine of invoiceLines) {
      if (invoiceLine.invoiceLineType === "Comment") continue;
      const base = {
        id: invoiceLine.id,
        invoiceLineType: invoiceLine.invoiceLineType,
        locationId: invoiceLine.locationId ?? null,
        amounts: amountsByLine.get(invoiceLine.id)!
      };
      const purchaseOrderLineId = invoiceLine.purchaseOrderLineId;
      const purchaseOrderLine = purchaseOrderLineId
        ? purchaseOrderLineById.get(purchaseOrderLineId)
        : undefined;

      if (isItemLineType(invoiceLine.invoiceLineType)) {
        const item = invoiceLine.itemId
          ? itemById.get(invoiceLine.itemId)
          : undefined;
        const itemCost = invoiceLine.itemId
          ? itemCostByItem.get(invoiceLine.itemId)
          : undefined;
        const itemFacts: PurchaseInvoiceItem = {
          itemId: invoiceLine.itemId ?? null,
          itemTrackingType: item?.itemTrackingType ?? null,
          replenishmentSystem: item?.replenishmentSystem ?? null,
          itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
          costingMethod: itemCost?.costingMethod ?? null
        };
        const itemKey = `${invoice.id}:${invoiceLine.itemId}`;
        if (!purchaseOrderLineId) {
          postingLines.push({
            ...base,
            kind: "direct",
            item: itemFacts,
            receivedWithInvoice: receivedWithInvoiceKeys.has(itemKey)
          });
          continue;
        }
        const receipts = receiptsBefore(purchaseOrderLineId);
        postingLines.push({
          ...base,
          kind: "ordered",
          item: itemFacts,
          purchaseOrderLine: {
            purchaseOrderLineId,
            quantityReceived: receipts.reduce(
              (sum, group) => sum + group.quantity,
              0
            ),
            quantityInvoiced: invoicedBefore(invoice.id, purchaseOrderLineId),
            receiptGroups: receipts,
            isOutsideProcessing: Boolean(purchaseOrderLine?.jobOperationId),
            processId: purchaseOrderLine?.jobOperationId
              ? (processByOperation.get(purchaseOrderLine.jobOperationId) ??
                null)
              : null,
            coverage: { storedWriteUp: writeUpByInvoiceItem.get(itemKey) ?? 0 }
          }
        });
        continue;
      }

      switch (invoiceLine.invoiceLineType) {
        case "Fixed Asset": {
          if (!invoiceLine.assetId) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a fixed asset line with no asset selected.`
            );
          }
          const asset = assetById.get(invoiceLine.assetId);
          if (!asset) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} names fixed asset ${invoiceLine.assetId}, which no longer exists.`
            );
          }
          const receipts = purchaseOrderLineId
            ? receiptsBefore(purchaseOrderLineId)
            : [];
          postingLines.push({
            ...base,
            kind: "fixedAsset",
            purchaseOrderLineId,
            purchaseOrderLineLocationId: purchaseOrderLine?.locationId ?? null,
            assetLocationId: asset.locationId,
            fixedAssetClassId: asset.fixedAssetClassId,
            acquisition:
              receipts.length > 0
                ? {
                    receiptCost: receipts.reduce(
                      (sum, group) => sum + group.cost,
                      0
                    )
                  }
                : { assetAccountId: asset.assetAccountId }
          });
          break;
        }
        case "G/L Account": {
          const glAccount = invoiceLine.accountId
            ? glAccountById.get(invoiceLine.accountId)
            : undefined;
          if (!glAccount) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a G/L line on account ${invoiceLine.accountId ?? "(none)"}, which is not in the chart of accounts.`
            );
          }
          if (glAccount.isGroup) {
            throw new InvalidInputError(
              `Purchase invoice ${invoice.invoiceId} has a G/L line on ${glAccount.name}, a group account. Move the line to a posting account.`
            );
          }
          postingLines.push({
            ...base,
            kind: "glAccount",
            purchaseOrderLineId,
            account: glAccount,
            costCenterId: invoiceLine.costCenterId ?? null,
            projectId: invoiceLine.projectId ?? null
          });
          break;
        }
        default:
          throw new Error(
            `Unsupported invoice line type: ${invoiceLine.invoiceLineType}`
          );
      }
    }

    const { lines: journalLines } = buildPurchaseInvoicePostingLines({
      invoice: {
        id: invoice.id,
        supplierId: invoice.supplierId,
        supplierReference: invoice.supplierReference
      },
      supplierTypeId: supplier?.supplierTypeId ?? null,
      accounts: defaults,
      payables,
      lines: postingLines
    });
    return {
      description: `Purchase Invoice ${invoice.invoiceId}`,
      postingDate,
      sourceType: "Purchase Invoice" as const,
      lines: journalLines
    };
  });
}
