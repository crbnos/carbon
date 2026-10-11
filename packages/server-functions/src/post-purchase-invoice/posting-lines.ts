// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal lines of a posted purchase invoice, built from plain facts.
// Used by `post-purchase-invoice` and by the accounting cutover's legacy
// backfill (`activate-accounting/legacy/purchase-invoice.ts`), so a rebuilt
// journal has the lines the posting writes. No database access: each caller
// reads the facts its own way and passes them in.
//
// Per invoice line:
// - an item line with no PO receives the goods itself: inventory (indirect
//   cost for Non-Inventory, WIP when the receipt is not posted with the
//   invoice) against payables;
// - an item line on a PO clears GR/IR at the receipt cost of the received
//   units no earlier invoice cleared. The variance goes to inventory for the
//   units still on hand and to purchase variance for the rest; payables at
//   invoice cost. The units not yet received accrue GR/IR, or indirect cost
//   for a service. All on `purchase-invoice:<poLineId>`;
// - a fixed asset line clears GR/IR when a receipt brought the asset in,
//   else debits the asset class's account;
// - a G/L line debits its account.
// Every line but a comment is written, at zero too. Each debit and its
// payable share one `journalLineReference`.

import type { Database } from "@carbon/database";
import { journalReference } from "@carbon/database";
import type { OptionalDefaultRole } from "@carbon/database/journal-posting-status";
import {
  allocateVarianceAcrossLayers,
  credit,
  debit,
  EPSILON,
  type ReceiptLayerLike,
  round,
  type VarianceAllocation
} from "@carbon/utils";
import { nanoid } from "nanoid";
import { InvalidInputError } from "../errors";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import type { JournalLineDimensionValues } from "../lib/journal-line-dimensions";
import type { InvoiceProjectCharges } from "./project-charges";
import type { PurchasePostingAmounts } from "./purchase-posting-amounts";

type Enums = Database["public"]["Enums"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** The posting's threshold for a variance worth a line. */
const VARIANCE_THRESHOLD = 0.005;

/** One line before it has a journal, and its dimension values by entity
 *  type, in the order the posting writes them. A null value writes none. */
export type PurchaseInvoiceJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

export type PurchaseInvoiceAccountDefaults = Pick<
  Database["public"]["Tables"]["accountDefault"]["Row"],
  | "goodsReceivedNotInvoicedAccount"
  | "purchaseVarianceAccount"
  | "indirectCostAccount"
  | "workInProgressAccount"
  | "rawMaterialsAccount"
  | "finishedGoodsAccount"
>;

/** What the journal reads of a line's item. */
export type PurchaseInvoiceItem = {
  itemId: string | null;
  /** Null when the item has no row: the line posts as Inventory. */
  itemTrackingType: Enums["itemTrackingType"] | null;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
  /** Null when the item has no cost record. The journal refuses it only
   *  when it must know whether the variance writes up receipt layers. */
  costingMethod: Enums["itemCostingMethod"] | null;
};

/**
 * How the variance of the received units splits between inventory and
 * purchase variance.
 * - `receiptLayers`: the receipt cost layers of the PO line's item, in FIFO
 *   order. Their unconsumed units take their share into inventory. With no
 *   layer (goods received before receipts wrote layers), the item's on-hand
 *   quantity measures the units still in stock.
 * - `storedWriteUp`: the write-up of the item's layers the posting stored for
 *   this invoice, shared across the invoice's lines of the item in
 *   proportion to their variance.
 */
export type VarianceCoverage =
  | { receiptLayers: ReceiptLayerLike[]; onHandQuantity: number }
  | { storedWriteUp: number };

/** A PO line, as it stood before this invoice. Quantities in inventory
 *  units. */
export type InvoicedPurchaseOrderLine = {
  purchaseOrderLineId: string;
  quantityReceived: number;
  /** What the invoices before this one invoiced. */
  quantityInvoiced: number;
  /** The receipts, in the order they were posted. */
  receiptGroups: { quantity: number; cost: number }[];
  /** A PO line for a job operation (outside processing). */
  isOutsideProcessing: boolean;
  processId: string | null;
  coverage: VarianceCoverage;
  /** A PO line made for a planning group (Projects Phase 3). */
  planningGroupId?: string | null;
};

type LineBase = {
  id: string;
  invoiceLineType: Enums["payableLineType"];
  locationId: string | null;
  amounts: Pick<
    PurchasePostingAmounts,
    "inventoryQuantity" | "totalBaseCost" | "inventoryUnitCost"
  >;
};

export type PurchaseInvoicePostingLine = LineBase &
  (
    | {
        /** An item line with no PO: the invoice receives the goods. */
        kind: "direct";
        item: PurchaseInvoiceItem;
        /** The invoice posts the receipt (an item ledger row) with it. */
        receivedWithInvoice: boolean;
      }
    | {
        kind: "ordered";
        item: PurchaseInvoiceItem;
        purchaseOrderLine: InvoicedPurchaseOrderLine;
      }
    | {
        kind: "fixedAsset";
        purchaseOrderLineId: string | null;
        purchaseOrderLineLocationId: string | null;
        assetLocationId: string | null;
        fixedAssetClassId: string | null;
        /** The receipt cost when a receipt brought the asset in, else the
         *  account of the asset's class, which the invoice debits. */
        acquisition: { receiptCost: number } | { assetAccountId: string };
      }
    | {
        kind: "glAccount";
        purchaseOrderLineId: string | null;
        account: { id: string; name: string };
        costCenterId: string | null;
        projectId: string | null;
        projectElementId?: string | null;
      }
  );

export type BuildPurchaseInvoicePostingLinesInput = {
  invoice: {
    id: string;
    supplierId: string | null;
    supplierReference: string | null;
  };
  supplierTypeId: string | null;
  accounts: PurchaseInvoiceAccountDefaults;
  /** Payables, or Intercompany Payables for a sister company's invoice. */
  payables: {
    accountId: string;
    accountDefaultRole: OptionalDefaultRole | null;
  };
  /** The invoice's lines in order, comments left out. */
  lines: PurchaseInvoicePostingLine[];
  /** The project charges of the invoice's lines (`loadInvoiceProjectCharges`).
   *  Absent: no line is charged to a project. */
  projectCharges?: InvoiceProjectCharges | null;
};

/** One projectLedger row the posting writes once the journal line ids exist:
 *  `journalLineIndex` is the index of its line in `lines`. */
export type PurchaseInvoiceProjectDraft = {
  invoiceLineId: string;
  projectId: string;
  projectElementId: string | null;
  costType: "Purchased Service" | "Other Direct" | "Material Variance";
  itemId: string | null;
  quantity: number;
  amount: number;
  journalLineIndex: number | null;
  fixedAssetId: string | null;
  postCapitalization: boolean;
  unallowable: boolean;
};

/** The units a line cleared from GR/IR and what their variance did. */
export type ReceivedVariance = {
  quantity: number;
  receiptCost: number;
  /** Invoice cost less receipt cost. */
  variance: number;
  /** The split of the variance, with the adjustment of each receipt layer. */
  allocation: VarianceAllocation;
  /** The units still on hand that get a new layer, when the PO line has no
   *  receipt layer. 0 otherwise. */
  selfHealQuantity: number;
};

export type PurchaseInvoicePosting = {
  lines: PurchaseInvoiceJournalLine[];
  /** By invoice line id: each PO item line that cleared received units, and
   *  each fixed asset line a receipt brought in. */
  receivedVariances: Map<string, ReceivedVariance>;
  /** The project ledger rows of the lines charged to a project. */
  projectDrafts: PurchaseInvoiceProjectDraft[];
};

const ITEM_LINE_TYPES: ReadonlySet<Enums["payableLineType"]> = new Set([
  "Part",
  "Service",
  "Consumable",
  "Fixture",
  "Material",
  "Tool"
]);

/** A line of an item: `direct` with no PO, else `ordered`. */
export function isItemLineType(type: Enums["payableLineType"]): boolean {
  return ITEM_LINE_TYPES.has(type);
}

/** Does the variance of the line's received units write up receipt layers?
 *  Standard cost, outside processing and Non-Inventory lines have none. */
export function usesReceiptLayers(
  item: PurchaseInvoiceItem,
  isOutsideProcessing: boolean
): boolean {
  return (
    !isOutsideProcessing &&
    (item.itemTrackingType ?? "Inventory") !== "Non-Inventory" &&
    item.itemId !== null &&
    costingMethodOf(item) !== "Standard"
  );
}

function costingMethodOf(item: PurchaseInvoiceItem) {
  if (!item.costingMethod) {
    throw new InvalidInputError(
      `Item ${item.itemId} on a purchase invoice has no cost record, so its invoice cannot be journaled.`
    );
  }
  return item.costingMethod;
}

type Clearing = {
  quantity: number;
  receiptCost: number;
  invoiceCost: number;
  variance: number;
  usesLayers: boolean;
};

/** The received units no earlier invoice cleared, costed at their receipts:
 *  skip the units invoiced before, cost the next ones. */
function clearReceipts(
  line: Extract<PurchaseInvoicePostingLine, { kind: "ordered" }>
): Clearing | null {
  const { amounts, purchaseOrderLine } = line;
  const { quantityReceived, quantityInvoiced } = purchaseOrderLine;
  const quantity = Math.max(
    0,
    Math.min(amounts.inventoryQuantity, quantityReceived - quantityInvoiced)
  );
  if (quantity <= 0) return null;

  const alreadyCleared =
    quantityReceived > quantityInvoiced ? quantityInvoiced : 0;
  let receiptCost = 0;
  let counted = 0;
  let cleared = 0;
  for (const group of purchaseOrderLine.receiptGroups) {
    if (!group.quantity) continue;
    const unitCost = group.cost / group.quantity;
    const available =
      alreadyCleared > counted
        ? group.quantity + counted - alreadyCleared
        : group.quantity;
    const taken = Math.max(0, Math.min(available, quantity - cleared));
    receiptCost += taken * unitCost;
    counted += group.quantity;
    cleared += taken;
  }
  const invoiceCost = quantity * amounts.inventoryUnitCost;
  return {
    quantity,
    receiptCost,
    invoiceCost,
    variance: invoiceCost - receiptCost,
    usesLayers: usesReceiptLayers(
      line.item,
      purchaseOrderLine.isOutsideProcessing
    )
  };
}

function allocate(
  clearing: Clearing,
  coverage: VarianceCoverage,
  itemVariance: number
): { allocation: VarianceAllocation; selfHealQuantity: number } {
  const { quantity, variance } = clearing;
  const significant = Math.abs(variance) > VARIANCE_THRESHOLD;
  if (!clearing.usesLayers || !significant) {
    return {
      allocation: {
        inventoryShare: 0,
        ppvShare: significant ? variance : 0,
        perLayer: []
      },
      selfHealQuantity: 0
    };
  }
  if ("storedWriteUp" in coverage) {
    const inventoryShare =
      coverage.storedWriteUp && Math.abs(itemVariance) > EPSILON
        ? coverage.storedWriteUp * (variance / itemVariance)
        : 0;
    return {
      allocation: {
        inventoryShare,
        ppvShare: variance - inventoryShare,
        perLayer: []
      },
      selfHealQuantity: 0
    };
  }
  if (coverage.receiptLayers.length > 0) {
    return {
      allocation: allocateVarianceAcrossLayers(
        coverage.receiptLayers,
        quantity,
        variance
      ),
      selfHealQuantity: 0
    };
  }
  // Goods received before receipts wrote layers: the units still on hand
  // take their share into a new layer, the write-up baked into it.
  const covered = Math.min(Math.max(0, coverage.onHandQuantity), quantity);
  const allocation = allocateVarianceAcrossLayers(
    [{ id: "legacy-self-heal", quantity, remainingQuantity: covered }],
    quantity,
    variance
  );
  return {
    allocation: { ...allocation, perLayer: [] },
    selfHealQuantity: covered
  };
}

export function buildPurchaseInvoicePostingLines(
  input: BuildPurchaseInvoicePostingLinesInput
): PurchaseInvoicePosting {
  const { invoice, accounts, payables, supplierTypeId } = input;
  const projectCharges = input.projectCharges ?? null;
  const projectDrafts: PurchaseInvoiceProjectDraft[] = [];

  const clearings = new Map<string, Clearing>();
  // The variance of the lines that share a stored write-up, per item.
  const writeUpVarianceByItem = new Map<string, number>();
  for (const line of input.lines) {
    if (line.kind !== "ordered") continue;
    const clearing = clearReceipts(line);
    if (!clearing) continue;
    // A line its receipt charged to a project has no layers: its whole
    // variance goes to the account the receipt debited.
    if (
      projectCharges?.chargedAtReceipt(
        line.purchaseOrderLine.purchaseOrderLineId
      )
    ) {
      clearing.usesLayers = false;
    }
    clearings.set(line.id, clearing);
    const itemId = line.item.itemId;
    if (
      itemId &&
      clearing.usesLayers &&
      Math.abs(clearing.variance) > VARIANCE_THRESHOLD &&
      "storedWriteUp" in line.purchaseOrderLine.coverage
    ) {
      writeUpVarianceByItem.set(
        itemId,
        (writeUpVarianceByItem.get(itemId) ?? 0) + clearing.variance
      );
    }
  }

  const lines: PurchaseInvoiceJournalLine[] = [];
  const receivedVariances = new Map<string, ReceivedVariance>();

  type Dimensions = {
    supplierTypeId: string | null;
    itemPostingGroupId: string | null;
    itemId: string | null;
    locationId: string | null;
    costCenterId: string | null;
    projectId: string | null;
    projectElementId?: string | null;
    processId: string | null;
    fixedAssetClassId: string | null;
  };
  type Line = Omit<
    PurchaseInvoiceJournalLine,
    "dimensions" | "documentType" | "documentId" | "externalDocumentId"
  >;
  const push = (line: Line, meta: Dimensions) =>
    lines.push({
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
        ProjectElement: meta.projectElementId ?? null,
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
    ...keys
  });

  for (const line of input.lines) {
    const { inventoryQuantity: quantity, totalBaseCost: total } = line.amounts;

    switch (line.kind) {
      case "direct": {
        const { item } = line;
        const trackingType = item.itemTrackingType ?? "Inventory";
        let debitAccount: string;
        let debitDescription: string;
        // A Non-Inventory line charged to a non-Statistical project debits
        // the project account.
        const directProjectCharge =
          trackingType === "Non-Inventory"
            ? (projectCharges?.forLine(line.id) ?? null)
            : null;
        if (trackingType === "Inventory" && line.receivedWithInvoice) {
          const inventory = resolveInventoryAccount(
            item.replenishmentSystem,
            accounts
          );
          debitAccount = inventory.account;
          debitDescription = inventory.description;
        } else if (directProjectCharge) {
          debitAccount = directProjectCharge.accountId;
          debitDescription = "Project Account";
        } else if (trackingType === "Non-Inventory") {
          debitAccount = accounts.indirectCostAccount;
          debitDescription = "Indirect Cost Account";
        } else {
          debitAccount = accounts.workInProgressAccount;
          debitDescription = "WIP Account";
        }
        const journalLineReference = nanoid();
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: item.itemPostingGroupId,
          itemId: item.itemId,
          locationId: line.locationId,
          costCenterId: null,
          projectId: null,
          processId: null,
          fixedAssetClassId: null
        };
        if (directProjectCharge) {
          projectDrafts.push({
            invoiceLineId: line.id,
            projectId: directProjectCharge.projectId,
            projectElementId: directProjectCharge.projectElementId,
            fixedAssetId: directProjectCharge.fixedAssetId,
            postCapitalization: directProjectCharge.postCapitalization,
            unallowable: directProjectCharge.unallowable,
            costType:
              line.invoiceLineType === "Service"
                ? "Purchased Service"
                : "Other Direct",
            itemId: item.itemId,
            quantity,
            amount: total,
            journalLineIndex: lines.length
          });
        }
        push(
          {
            accountId: debitAccount,
            description: debitDescription,
            amount: round(debit("asset", total)),
            quantity: round(quantity),
            journalLineReference
          },
          directProjectCharge
            ? {
                ...meta,
                projectId: directProjectCharge.projectId,
                projectElementId: directProjectCharge.projectElementId
              }
            : meta
        );
        push(payable(total, quantity, { journalLineReference }), meta);
        break;
      }

      case "ordered": {
        const { item, purchaseOrderLine } = line;
        const documentLineReference = journalReference.to.purchaseInvoice(
          purchaseOrderLine.purchaseOrderLineId
        );
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: item.itemPostingGroupId,
          itemId: item.itemId,
          locationId: line.locationId,
          costCenterId: null,
          projectId: null,
          processId: purchaseOrderLine.processId,
          fixedAssetClassId: null
        };

        // Received units clear GR/IR at their receipt cost.
        const clearing = clearings.get(line.id);
        if (clearing) {
          const { allocation, selfHealQuantity } = allocate(
            clearing,
            purchaseOrderLine.coverage,
            item.itemId ? (writeUpVarianceByItem.get(item.itemId) ?? 0) : 0
          );
          receivedVariances.set(line.id, {
            quantity: clearing.quantity,
            receiptCost: clearing.receiptCost,
            variance: clearing.variance,
            allocation,
            selfHealQuantity
          });
          const keys = {
            quantity: round(clearing.quantity),
            documentLineReference,
            journalLineReference: nanoid()
          };
          push(
            {
              accountId: accounts.goodsReceivedNotInvoicedAccount,
              description: "GR/IR Clearing",
              amount: round(debit("liability", clearing.receiptCost)),
              ...keys
            },
            meta
          );
          const receiptProjectCharge =
            projectCharges?.chargedAtReceipt(
              purchaseOrderLine.purchaseOrderLineId
            ) ?? null;
          // The on-hand share writes up inventory; the consumed share is
          // purchase variance.
          let inventoryVarianceLineIndex: number | null = null;
          if (Math.abs(allocation.inventoryShare) > VARIANCE_THRESHOLD) {
            inventoryVarianceLineIndex = lines.length;
            const inventory = resolveInventoryAccount(
              item.replenishmentSystem,
              accounts
            );
            push(
              {
                accountId: inventory.account,
                description: inventory.description,
                amount: round(debit("asset", allocation.inventoryShare)),
                ...keys
              },
              meta
            );
          }
          // A PO line made for a planning group (Projects Phase 3): the
          // consumed share of a member stripe's layer is that member's cost.
          // It posts to the member's project account with a Material Variance
          // row; the rest stays in PPV.
          let remainingPpvShare = allocation.ppvShare;
          if (purchaseOrderLine.planningGroupId && projectCharges) {
            const consumedByProject = new Map<
              string,
              { quantity: number; cost: number }
            >();
            for (const entry of allocation.consumed ?? []) {
              if (!entry.projectId) continue;
              const total = consumedByProject.get(entry.projectId) ?? {
                quantity: 0,
                cost: 0
              };
              consumedByProject.set(entry.projectId, {
                quantity: total.quantity + entry.quantity,
                cost: total.cost + entry.cost
              });
            }
            for (const [memberProjectId, share] of consumedByProject) {
              const amount = round(share.cost);
              if (Math.abs(amount) <= VARIANCE_THRESHOLD) continue;
              const memberCharge =
                projectCharges.stripeVarianceCharge(memberProjectId);
              if (!memberCharge) continue;
              projectDrafts.push({
                invoiceLineId: line.id,
                projectId: memberProjectId,
                projectElementId: null,
                fixedAssetId: memberCharge.fixedAssetId,
                postCapitalization: memberCharge.postCapitalization,
                unallowable: memberCharge.unallowable,
                costType: "Material Variance",
                itemId: item.itemId,
                quantity: share.quantity,
                amount,
                journalLineIndex: lines.length
              });
              push(
                {
                  accountId: memberCharge.accountId,
                  description: "Project Account (Price Variance)",
                  amount: round(debit("expense", amount)),
                  ...keys,
                  quantity: round(share.quantity)
                },
                { ...meta, projectId: memberProjectId, projectElementId: null }
              );
              remainingPpvShare -= amount;
            }
          }
          let ppvLineIndex: number | null = null;
          if (Math.abs(remainingPpvShare) > VARIANCE_THRESHOLD) {
            ppvLineIndex = lines.length;
            if (receiptProjectCharge) {
              projectDrafts.push({
                invoiceLineId: line.id,
                projectId: receiptProjectCharge.projectId,
                projectElementId: receiptProjectCharge.projectElementId,
                fixedAssetId: receiptProjectCharge.fixedAssetId,
                postCapitalization: receiptProjectCharge.postCapitalization,
                unallowable: receiptProjectCharge.unallowable,
                costType: "Material Variance",
                itemId: item.itemId,
                quantity: clearing.quantity,
                amount: remainingPpvShare,
                journalLineIndex: ppvLineIndex
              });
            }
            push(
              {
                accountId:
                  receiptProjectCharge?.accountId ??
                  accounts.purchaseVarianceAccount,
                description: receiptProjectCharge
                  ? "Project Account (Price Variance)"
                  : "Purchase Price Variance",
                amount: round(debit("expense", remainingPpvShare)),
                ...keys
              },
              receiptProjectCharge
                ? {
                    ...meta,
                    projectId: receiptProjectCharge.projectId,
                    projectElementId: receiptProjectCharge.projectElementId
                  }
                : meta
            );
          }
          // Charge at receipt into project stock (Projects Phase 2a): the
          // receipt charged the project at receipt cost while the goods
          // entered its stock, so the project's ledger gets the price variance
          // too, on the line that carries it (the inventory write-up, else the
          // PPV of consumed units).
          const stockReceiptCharge = receiptProjectCharge
            ? null
            : (projectCharges?.stockChargedAtReceipt(
                purchaseOrderLine.purchaseOrderLineId
              ) ?? null);
          const stockVariance = round(
            allocation.inventoryShare + allocation.ppvShare
          );
          if (
            stockReceiptCharge &&
            Math.abs(stockVariance) > VARIANCE_THRESHOLD
          ) {
            projectDrafts.push({
              invoiceLineId: line.id,
              projectId: stockReceiptCharge.projectId,
              projectElementId: stockReceiptCharge.projectElementId,
              // Stock builds no asset until it is issued.
              fixedAssetId: null,
              postCapitalization: false,
              unallowable: stockReceiptCharge.unallowable,
              costType: "Material Variance",
              itemId: item.itemId,
              quantity: clearing.quantity,
              amount: stockVariance,
              journalLineIndex: inventoryVarianceLineIndex ?? ppvLineIndex
            });
          }
          push(payable(clearing.invoiceCost, clearing.quantity, keys), meta);
        }

        // Units not yet received accrue GR/IR. A service is never received,
        // so it expenses them to indirect cost.
        const quantityCleared = clearing?.quantity ?? 0;
        if (quantity > quantityCleared) {
          const quantityToAccrue = quantity - quantityCleared;
          const accrualCost = quantityToAccrue * line.amounts.inventoryUnitCost;
          const isService = line.invoiceLineType === "Service";
          // A service charged to a non-Statistical project debits the project
          // account instead of indirect cost.
          const serviceProjectCharge = isService
            ? (projectCharges?.forLine(line.id) ?? null)
            : null;
          const keys = {
            quantity: round(quantityToAccrue),
            documentLineReference,
            journalLineReference: nanoid()
          };
          if (serviceProjectCharge) {
            projectDrafts.push({
              invoiceLineId: line.id,
              projectId: serviceProjectCharge.projectId,
              projectElementId: serviceProjectCharge.projectElementId,
              fixedAssetId: serviceProjectCharge.fixedAssetId,
              postCapitalization: serviceProjectCharge.postCapitalization,
              unallowable: serviceProjectCharge.unallowable,
              costType: "Purchased Service",
              itemId: item.itemId,
              quantity: quantityToAccrue,
              amount: accrualCost,
              journalLineIndex: lines.length
            });
          }
          push(
            isService
              ? {
                  accountId:
                    serviceProjectCharge?.accountId ??
                    accounts.indirectCostAccount,
                  description: serviceProjectCharge
                    ? "Project Account"
                    : "Indirect Cost Account",
                  amount: round(debit("asset", accrualCost)),
                  ...keys
                }
              : {
                  accountId: accounts.goodsReceivedNotInvoicedAccount,
                  description: "GR/IR Clearing",
                  accrual: true,
                  amount: round(debit("liability", accrualCost)),
                  ...keys
                },
            serviceProjectCharge
              ? {
                  ...meta,
                  projectId: serviceProjectCharge.projectId,
                  projectElementId: serviceProjectCharge.projectElementId
                }
              : meta
          );
          push(
            payable(accrualCost, quantityToAccrue, {
              ...keys,
              ...(isService ? {} : { accrual: true })
            }),
            meta
          );
        }
        break;
      }

      case "fixedAsset": {
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: null,
          itemId: null,
          locationId:
            line.locationId ??
            line.purchaseOrderLineLocationId ??
            line.assetLocationId,
          costCenterId: null,
          projectId: null,
          processId: null,
          fixedAssetClassId: line.fixedAssetClassId
        };
        const keys = {
          quantity: round(quantity),
          documentLineReference: line.purchaseOrderLineId
            ? journalReference.to.purchaseInvoice(line.purchaseOrderLineId)
            : null,
          journalLineReference: nanoid()
        };
        if ("receiptCost" in line.acquisition) {
          // Received: clear GR/IR at the receipt cost.
          const { receiptCost } = line.acquisition;
          const variance = total - receiptCost;
          const significant = Math.abs(variance) > VARIANCE_THRESHOLD;
          receivedVariances.set(line.id, {
            quantity,
            receiptCost,
            variance,
            allocation: {
              inventoryShare: 0,
              ppvShare: significant ? variance : 0,
              perLayer: []
            },
            selfHealQuantity: 0
          });
          push(
            {
              accountId: accounts.goodsReceivedNotInvoicedAccount,
              description: "GR/IR Clearing",
              amount: round(debit("liability", receiptCost)),
              ...keys
            },
            meta
          );
          if (significant) {
            push(
              {
                accountId: accounts.purchaseVarianceAccount,
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
              accountId: line.acquisition.assetAccountId,
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

      case "glAccount": {
        // A non-Statistical project replaces the line's account.
        const glProjectCharge = projectCharges?.forLine(line.id) ?? null;
        const meta: Dimensions = {
          supplierTypeId: null,
          itemPostingGroupId: null,
          itemId: null,
          locationId: line.locationId,
          costCenterId: line.costCenterId,
          projectId: glProjectCharge?.projectId ?? line.projectId,
          projectElementId: glProjectCharge
            ? glProjectCharge.projectElementId
            : (line.projectElementId ?? null),
          processId: null,
          fixedAssetClassId: null
        };
        if (glProjectCharge) {
          projectDrafts.push({
            invoiceLineId: line.id,
            projectId: glProjectCharge.projectId,
            projectElementId: glProjectCharge.projectElementId,
            fixedAssetId: glProjectCharge.fixedAssetId,
            postCapitalization: glProjectCharge.postCapitalization,
            unallowable: glProjectCharge.unallowable,
            costType: "Other Direct",
            itemId: null,
            quantity,
            amount: total,
            journalLineIndex: lines.length
          });
        }
        const keys = {
          quantity: round(quantity),
          documentLineReference: line.purchaseOrderLineId
            ? journalReference.to.purchaseInvoice(line.purchaseOrderLineId)
            : null,
          journalLineReference: nanoid()
        };
        push(
          {
            accountId: glProjectCharge?.accountId ?? line.account.id,
            description: glProjectCharge
              ? "Project Account"
              : line.account.name,
            amount: round(debit("asset", total)),
            ...keys
          },
          meta
        );
        push(payable(total, quantity, keys), meta);
        break;
      }
    }
  }

  return { lines, receivedVariances, projectDrafts };
}
