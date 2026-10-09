// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy purchase invoice: the lines `post-purchase-invoice`
// writes today, from the stored invoice, with today's account defaults
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a). Amounts come from
// `calculatePurchasePostingAmounts`, which converts the header freight at the
// invoice's exchange rate as the posting does.
//
// Mirrors post-purchase-invoice/index.ts:
// - a stock line with no PO: inventory (indirect cost for Non-Inventory, WIP
//   when no receipt was posted with it) against payables (~1130-1194);
// - a PO line: GR/IR Clearing at the receipt cost of the units it clears,
//   the variance on inventory and purchase variance, payables at invoice
//   cost (~1201-1594); the units it does not clear accrue GR/IR, or indirect
//   cost for a service (~1596-1693). All on `purchase-invoice:<poLineId>`;
// - a fixed asset line (~1698-2019) and a G/L line (~2021-2084);
// - the dimensions of every line (~2268-2361).
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
import { journalReference } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { resolveDefaultAccount } from "@carbon/database/journal-posting-status";
import {
  legacyPurchaseInvoices,
  POSTED_INVOICE_EXCLUDED_STATUSES
} from "@carbon/database/legacy-documents";
import { credit, debit, EPSILON, round } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../../lib/get-posting-group";
import { calculatePurchasePostingAmounts } from "../../post-purchase-invoice/purchase-posting-amounts";
import { type LegacyJournal, type LegacyJournalLine, readByIds } from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/** The posting's threshold for a variance worth a line. */
const VARIANCE_THRESHOLD = 0.005;

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

  const linesByInvoice = groupBy(lines, (line) => line.invoiceId);
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
  const invoicedRowsByLine = groupBy(
    invoicedLines,
    (row) => row.purchaseOrderLineId ?? ""
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

    // The variance of this invoice's PO lines per item, to share its write-up.
    const varianceByItem = new Map<string, number>();
    const journalLines: LegacyJournalLine[] = [];
    type Line = Omit<LegacyJournalLine, "dimensions" | "documentType">;
    type Dimensions = {
      supplierTypeId: string | null;
      itemPostingGroupId: string | null;
      itemId: string | null;
      locationId: string | null;
      costCenterId: string | null;
      projectId: string | null;
      processId: string | null;
      fixedAssetClassId: string | null;
    };
    const push = (line: Line, meta: Dimensions) =>
      journalLines.push({
        ...line,
        documentType: "Invoice",
        documentId: invoice.id,
        externalDocumentId: invoice.supplierReference,
        dimensions: {
          SupplierType: meta.supplierTypeId,
          ItemPostingGroup: meta.itemPostingGroupId,
          Item: meta.itemId,
          Supplier: invoice.supplierId,
          Location: meta.locationId,
          CostCenter: meta.costCenterId,
          Project: meta.projectId,
          Process: meta.processId,
          FixedAssetClass: meta.fixedAssetClassId
        }
      });
    const payable = (
      amount: number,
      quantity: number,
      keys: {
        journalLineReference: string;
        documentLineReference?: string | null;
        accrual?: boolean;
      }
    ): Line => ({
      accountId: payables.accountId,
      accountDefaultRole: payables.accountDefaultRole,
      description: "Accounts Payable",
      amount: round(credit("liability", amount)),
      quantity: round(quantity),
      journalLineReference: keys.journalLineReference,
      documentLineReference: keys.documentLineReference ?? null,
      ...(keys.accrual ? { accrual: true } : {})
    });

    // Write-ups to share, per item, across this invoice's PO lines.
    const pendingWriteUps: {
      itemId: string;
      variance: number;
      apply: (share: number) => void;
    }[] = [];

    for (const invoiceLine of invoiceLines) {
      if (invoiceLine.invoiceLineType === "Comment") continue;
      const amounts = amountsByLine.get(invoiceLine.id)!;
      const quantity = amounts.inventoryQuantity;
      const total = amounts.totalBaseCost;
      const unitCost = amounts.inventoryUnitCost;
      const purchaseOrderLineId = invoiceLine.purchaseOrderLineId;
      const reference = purchaseOrderLineId
        ? journalReference.to.purchaseInvoice(purchaseOrderLineId)
        : null;
      const purchaseOrderLine = purchaseOrderLineId
        ? purchaseOrderLineById.get(purchaseOrderLineId)
        : undefined;
      const item = invoiceLine.itemId
        ? itemById.get(invoiceLine.itemId)
        : undefined;
      const itemCost = invoiceLine.itemId
        ? itemCostByItem.get(invoiceLine.itemId)
        : undefined;
      const trackingType = item?.itemTrackingType ?? "Inventory";
      const itemMeta: Dimensions = {
        supplierTypeId: supplier?.supplierTypeId ?? null,
        itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
        itemId: invoiceLine.itemId ?? null,
        locationId: invoiceLine.locationId ?? null,
        costCenterId: null,
        projectId: null,
        processId: purchaseOrderLine?.jobOperationId
          ? (processByOperation.get(purchaseOrderLine.jobOperationId) ?? null)
          : null,
        fixedAssetClassId: null
      };

      switch (invoiceLine.invoiceLineType) {
        case "Part":
        case "Service":
        case "Consumable":
        case "Fixture":
        case "Material":
        case "Tool": {
          if (!purchaseOrderLineId) {
            // A direct invoice receives the goods itself.
            let debitAccount: string;
            let debitDescription: string;
            if (
              trackingType === "Inventory" &&
              receivedWithInvoiceKeys.has(`${invoice.id}:${invoiceLine.itemId}`)
            ) {
              const inventory = resolveInventoryAccount(
                item?.replenishmentSystem ?? null,
                defaults
              );
              debitAccount = inventory.account;
              debitDescription = inventory.description;
            } else if (trackingType === "Non-Inventory") {
              debitAccount = defaults.indirectCostAccount;
              debitDescription = "Indirect Cost Account";
            } else {
              debitAccount = defaults.workInProgressAccount;
              debitDescription = "WIP Account";
            }
            const journalLineReference = nanoid();
            const meta = { ...itemMeta, processId: null };
            push(
              {
                accountId: debitAccount,
                description: debitDescription,
                amount: round(debit("asset", total)),
                quantity: round(quantity),
                journalLineReference
              },
              meta
            );
            push(payable(total, quantity, { journalLineReference }), meta);
            break;
          }

          // Received units clear GR/IR at their receipt cost.
          const receipts = (
            receiptsByLine.get(purchaseOrderLineId) ?? []
          ).filter((group) => group.postingDate <= String(invoice.postingDate));
          const received = receipts.reduce(
            (sum, group) => sum + group.quantity,
            0
          );
          const invoiced = invoicedBefore(invoice.id, purchaseOrderLineId);
          const quantityToReverse = Math.max(
            0,
            Math.min(quantity, received - invoiced)
          );
          if (quantityToReverse > 0) {
            // Skip the units invoiced before, cost the next ones.
            let skip = received > invoiced ? invoiced : 0;
            let take = quantityToReverse;
            let receiptCost = 0;
            for (const group of receipts) {
              if (group.quantity <= 0) continue;
              const skipped = Math.min(skip, group.quantity);
              skip -= skipped;
              const taken = Math.min(take, group.quantity - skipped);
              receiptCost += taken * (group.cost / group.quantity);
              take -= taken;
            }
            const invoiceCost = quantityToReverse * unitCost;
            const variance = invoiceCost - receiptCost;
            const journalLineReference = nanoid();
            const keys = {
              quantity: round(quantityToReverse),
              documentLineReference: reference,
              journalLineReference
            };
            push(
              {
                accountId: defaults.goodsReceivedNotInvoicedAccount,
                description: "GR/IR Clearing",
                amount: round(debit("liability", receiptCost)),
                ...keys
              },
              itemMeta
            );
            // The variance: on inventory for the write-up the posting stored,
            // the rest on purchase variance. A line that wrote up layers waits
            // until each item's write-up is shared across the invoice's lines.
            const usesLayers =
              !purchaseOrderLine?.jobOperationId &&
              trackingType !== "Non-Inventory" &&
              (itemCost?.costingMethod ?? "FIFO") !== "Standard" &&
              Boolean(invoiceLine.itemId);
            const apply = (inventoryShare: number) => {
              const ppvShare = variance - inventoryShare;
              if (Math.abs(inventoryShare) > VARIANCE_THRESHOLD) {
                const inventory = resolveInventoryAccount(
                  item?.replenishmentSystem ?? null,
                  defaults
                );
                push(
                  {
                    accountId: inventory.account,
                    description: inventory.description,
                    amount: round(debit("asset", inventoryShare)),
                    ...keys
                  },
                  itemMeta
                );
              }
              if (Math.abs(ppvShare) > VARIANCE_THRESHOLD) {
                push(
                  {
                    accountId: defaults.purchaseVarianceAccount,
                    description: "Purchase Price Variance",
                    amount: round(debit("expense", ppvShare)),
                    ...keys
                  },
                  itemMeta
                );
              }
            };
            if (usesLayers && Math.abs(variance) > VARIANCE_THRESHOLD) {
              pendingWriteUps.push({
                itemId: invoiceLine.itemId!,
                variance,
                apply
              });
              varianceByItem.set(
                invoiceLine.itemId!,
                (varianceByItem.get(invoiceLine.itemId!) ?? 0) + variance
              );
            } else {
              apply(0);
            }
            push(payable(invoiceCost, quantityToReverse, keys), itemMeta);
          }

          // Units not yet received accrue GR/IR; a service expenses them.
          if (quantity > quantityToReverse) {
            const quantityToAccrue = quantity - quantityToReverse;
            const accrualCost = quantityToAccrue * unitCost;
            const isService = invoiceLine.invoiceLineType === "Service";
            const keys = {
              quantity: round(quantityToAccrue),
              documentLineReference: reference,
              journalLineReference: nanoid()
            };
            push(
              isService
                ? {
                    accountId: defaults.indirectCostAccount,
                    description: "Indirect Cost Account",
                    amount: round(debit("asset", accrualCost)),
                    ...keys
                  }
                : {
                    accountId: defaults.goodsReceivedNotInvoicedAccount,
                    description: "GR/IR Clearing",
                    accrual: true,
                    amount: round(debit("liability", accrualCost)),
                    ...keys
                  },
              itemMeta
            );
            push(
              payable(accrualCost, quantityToAccrue, {
                ...keys,
                ...(isService ? {} : { accrual: true })
              }),
              itemMeta
            );
          }
          break;
        }
        case "Fixed Asset": {
          if (!invoiceLine.assetId) {
            throw new Error(
              `Fixed Asset invoice line ${invoiceLine.id} has no asset selected`
            );
          }
          const asset = assetById.get(invoiceLine.assetId);
          if (!asset) {
            throw new Error(`Fixed asset ${invoiceLine.assetId} was not found`);
          }
          const receipts = purchaseOrderLineId
            ? (receiptsByLine.get(purchaseOrderLineId) ?? []).filter(
                (group) => group.postingDate <= String(invoice.postingDate)
              )
            : [];
          const meta: Dimensions = {
            supplierTypeId: supplier?.supplierTypeId ?? null,
            itemPostingGroupId: null,
            itemId: null,
            locationId:
              invoiceLine.locationId ??
              purchaseOrderLine?.locationId ??
              asset.locationId,
            costCenterId: null,
            projectId: null,
            processId: null,
            fixedAssetClassId: asset.fixedAssetClassId
          };
          const journalLineReference = nanoid();
          const keys = {
            quantity: round(quantity),
            documentLineReference: reference,
            journalLineReference
          };
          if (receipts.length > 0) {
            // Received: clear GR/IR at the receipt cost.
            const receiptCost = receipts.reduce(
              (sum, group) => sum + group.cost,
              0
            );
            const variance = total - receiptCost;
            push(
              {
                accountId: defaults.goodsReceivedNotInvoicedAccount,
                description: "GR/IR Clearing",
                amount: round(debit("liability", receiptCost)),
                ...keys
              },
              meta
            );
            if (Math.abs(variance) > VARIANCE_THRESHOLD) {
              push(
                {
                  accountId: defaults.purchaseVarianceAccount,
                  description: "Purchase Price Variance",
                  amount: round(debit("expense", variance)),
                  ...keys
                },
                meta
              );
            }
          } else {
            push(
              {
                accountId: asset.assetAccountId,
                description: "Fixed Asset Acquisition",
                amount: round(debit("asset", total)),
                ...keys
              },
              meta
            );
          }
          push(payable(total, quantity, keys), meta);
          break;
        }
        case "G/L Account": {
          const glAccount = invoiceLine.accountId
            ? glAccountById.get(invoiceLine.accountId)
            : undefined;
          if (!glAccount) throw new Error("Failed to fetch account");
          if (glAccount.isGroup) {
            throw new Error("Cannot post to a group account");
          }
          const meta: Dimensions = {
            supplierTypeId: null,
            itemPostingGroupId: null,
            itemId: null,
            locationId: invoiceLine.locationId ?? null,
            costCenterId: invoiceLine.costCenterId ?? null,
            projectId: invoiceLine.projectId ?? null,
            processId: null,
            fixedAssetClassId: null
          };
          const keys = {
            quantity: round(quantity),
            documentLineReference: reference,
            journalLineReference: nanoid()
          };
          push(
            {
              accountId: glAccount.id,
              description: glAccount.name,
              amount: round(debit("asset", total)),
              ...keys
            },
            meta
          );
          push(payable(total, quantity, keys), meta);
          break;
        }
        default:
          throw new Error(
            `Unsupported invoice line type: ${invoiceLine.invoiceLineType}`
          );
      }
    }

    // The write-up the posting stored for an item, shared across its lines
    // in proportion to their variance.
    for (const pending of pendingWriteUps) {
      const writeUp = writeUpByInvoiceItem.get(
        `${invoice.id}:${pending.itemId}`
      );
      const itemVariance = varianceByItem.get(pending.itemId) ?? 0;
      const share =
        writeUp && Math.abs(itemVariance) > EPSILON
          ? writeUp * (pending.variance / itemVariance)
          : 0;
      pending.apply(share);
    }

    return {
      description: `Purchase Invoice ${invoice.invoiceId}`,
      postingDate: String(invoice.postingDate),
      sourceType: "Purchase Invoice" as const,
      lines: journalLines
    };
  });
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}
