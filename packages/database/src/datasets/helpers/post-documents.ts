import {
  assertBalanced,
  EPSILON,
  round
} from "../../../supabase/functions/shared/precision.ts";
import { insertId, insertRow, nextJournalEntryId, rows } from "../sql.ts";
import type { AccountClass, Ctx } from "../types.ts";
import {
  consumeFifo,
  type DefaultPostingRole,
  memoJournal,
  POSTING_ROLE_CLASS,
  type PostingJournal,
  paymentJournal,
  postingImbalance,
  purchaseInvoiceJournal,
  receiptJournal,
  salesInvoiceJournal,
  scrapJournal,
  shipmentJournal,
  voidJournal
} from "./posting-journals.ts";

/**
 * Writes the GL (and the cost layers) the posting functions leave behind for
 * the documents tiers 04/05/09 seeded as posted, in their shape: journal +
 * lines, accountingPeriodId, the document's journalId where it has one.
 */

export type AccountingPeriodRange = {
  id: string;
  startDate: string;
  endDate: string;
};

export type PostingContext = {
  defaults: Record<DefaultPostingRole, string>;
  classById: Map<string, AccountClass>;
  periods: AccountingPeriodRange[];
};

export async function loadPostingContext(
  ctx: Ctx,
  periods: AccountingPeriodRange[]
): Promise<PostingContext> {
  const roles = Object.keys(POSTING_ROLE_CLASS) as DefaultPostingRole[];
  const [row] = await rows<Record<string, string | null>>(
    ctx.client,
    `SELECT ${roles.map((r) => `"${r}"`).join(", ")}
     FROM "accountDefault" WHERE "companyId" = $1`,
    [ctx.companyId]
  );
  if (!row) throw new Error("Seed: this company has no accountDefault row");
  // account is companyGroup-scoped; only active posting accounts may be booked.
  const accounts = await rows<{ id: string; class: AccountClass }>(
    ctx.client,
    `SELECT id, class FROM account
     WHERE "companyGroupId" = $1 AND "isGroup" = false AND active = true`,
    [ctx.companyGroupId]
  );
  const classById = new Map(accounts.map((a) => [a.id, a.class]));
  const defaults = {} as Record<DefaultPostingRole, string>;
  for (const role of roles) {
    const id = row[role];
    if (!id || classById.get(id) !== POSTING_ROLE_CLASS[role]) {
      throw new Error(
        `Seed: accountDefault.${role} must be an active ${POSTING_ROLE_CLASS[role]} posting account`
      );
    }
    defaults[role] = id;
  }
  return { defaults, classById, periods };
}

export function periodFor(posting: PostingContext, date: string): string {
  const period = posting.periods.find(
    (p) => p.startDate <= date && date <= p.endDate
  );
  if (!period) {
    throw new Error(`Seed: no seeded accounting period contains ${date}`);
  }
  return period.id;
}

/** Inserts a Posted journal and its lines; returns the journal id. */
export async function insertPostingJournal(
  ctx: Ctx,
  posting: PostingContext,
  args: {
    journal: PostingJournal;
    documentId: string;
    postingDate: string;
    reasonAccountId?: string;
    /** A void keeps its original's journalLineReferences. */
    referencePrefix?: string;
  }
): Promise<{ id: string; journalEntryId: string }> {
  const { journal } = args;
  assertBalanced(
    postingImbalance(journal),
    0,
    EPSILON,
    `${journal.description} journal`
  );
  const journalEntryId = await nextJournalEntryId(ctx);
  const id = await insertId(ctx, "journal", {
    journalEntryId,
    accountingPeriodId: periodFor(posting, args.postingDate),
    description: journal.description,
    postingDate: args.postingDate,
    sourceType: journal.sourceType,
    status: "Posted",
    postedAt: `${args.postingDate}T17:00:00Z`,
    postedBy: ctx.userId
  });
  for (const line of journal.lines) {
    let accountId: string;
    if (line.role === "reasonAccount") {
      if (!args.reasonAccountId) {
        throw new Error(`Seed: ${journal.description} has no reason account`);
      }
      accountId = args.reasonAccountId;
    } else {
      accountId = posting.defaults[line.role];
    }
    await insertRow(ctx, "journalLine", {
      journalId: id,
      accountId,
      description: line.description,
      amount: line.amount,
      quantity: line.quantity,
      documentType: line.documentType,
      documentId: args.documentId,
      documentLineReference: line.documentLineReference ?? undefined,
      journalLineReference: `${args.referencePrefix ?? journalEntryId}-${line.group + 1}`,
      accrual: line.accrual
    });
  }
  return { id, journalEntryId };
}

/** post-sales-invoice for every non-Draft invoice; a Voided one also gets its void journal. */
export async function postSalesInvoices(
  ctx: Ctx,
  posting: PostingContext
): Promise<void> {
  const invoices = await rows<{
    id: string;
    invoiceId: string;
    status: string;
    postingDate: string | null;
  }>(
    ctx.client,
    `SELECT id, "invoiceId", status, "postingDate"::text AS "postingDate"
     FROM "salesInvoice" WHERE "companyId" = $1 AND status <> 'Draft'
     ORDER BY "postingDate", "invoiceId"`,
    [ctx.companyId]
  );
  if (invoices.length === 0) return;
  const lines = await rows<{
    invoiceId: string;
    quantity: string;
    unitPrice: string;
    salesOrderLineId: string | null;
    invoiceLineType: string;
  }>(
    ctx.client,
    `SELECT "invoiceId", quantity, "unitPrice", "salesOrderLineId", "invoiceLineType"
     FROM "salesInvoiceLine"
     WHERE "companyId" = $1 AND "invoiceId" = ANY($2::text[])
     ORDER BY "createdAt", id`,
    [ctx.companyId, invoices.map((i) => i.id)]
  );
  for (const invoice of invoices) {
    if (!invoice.postingDate) {
      throw new Error(
        `Seed: sales invoice ${invoice.invoiceId} has no postingDate`
      );
    }
    const own = lines.filter((l) => l.invoiceId === invoice.id);
    const journal = salesInvoiceJournal({
      invoiceReadableId: invoice.invoiceId,
      documentId: invoice.id,
      lines: own.map((l) => {
        if (l.invoiceLineType !== "Part" || !l.salesOrderLineId) {
          throw new Error(
            `Seed: sales invoice ${invoice.invoiceId} has a line the seeded posting shape does not cover`
          );
        }
        return {
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          salesOrderLineId: l.salesOrderLineId
        };
      })
    });
    ctx.log(`journal — ${journal.description}`);
    const posted = await insertPostingJournal(ctx, posting, {
      journal,
      documentId: invoice.id,
      postingDate: invoice.postingDate
    });
    if (invoice.status === "Voided") {
      await insertPostingJournal(ctx, posting, {
        journal: voidJournal(journal, invoice.invoiceId),
        documentId: invoice.id,
        postingDate: invoice.postingDate,
        referencePrefix: posted.journalEntryId
      });
    }
  }
}

type PostedReceiptLine = {
  receiptId: string;
  receiptReadableId: string;
  postingDate: string;
  supplierId: string | null;
  externalDocumentId: string | null;
  purchaseOrderLineId: string;
  itemId: string;
  receivedQuantity: number;
  unitPrice: number;
  itemTrackingType: string | null;
  replenishmentSystem: string | null;
};

async function postedReceiptLines(ctx: Ctx): Promise<PostedReceiptLine[]> {
  const found = await rows<{
    receiptId: string;
    receiptReadableId: string;
    postingDate: string | null;
    supplierId: string | null;
    externalDocumentId: string | null;
    purchaseOrderLineId: string | null;
    itemId: string | null;
    receivedQuantity: string;
    unitPrice: string | null;
    itemTrackingType: string | null;
    replenishmentSystem: string | null;
  }>(
    ctx.client,
    `SELECT r.id AS "receiptId", r."receiptId" AS "receiptReadableId",
            r."postingDate"::text AS "postingDate", r."supplierId", r."externalDocumentId",
            rl."lineId" AS "purchaseOrderLineId", rl."itemId", rl."receivedQuantity",
            rl."unitPrice", i."itemTrackingType", i."replenishmentSystem"
     FROM receipt r
     JOIN "receiptLine" rl ON rl."receiptId" = r.id AND rl."companyId" = r."companyId"
     JOIN item i ON i.id = rl."itemId" AND i."companyId" = r."companyId"
     WHERE r."companyId" = $1 AND r.status = 'Posted'
       AND r."sourceDocument" = 'Purchase Order' AND rl."receivedQuantity" > 0
     ORDER BY r."postingDate", r."receiptId", rl."createdAt", rl.id`,
    [ctx.companyId]
  );
  return found.map((r) => {
    if (!r.postingDate || !r.purchaseOrderLineId || !r.itemId) {
      throw new Error(
        `Seed: posted receipt ${r.receiptReadableId} is incomplete`
      );
    }
    return {
      receiptId: r.receiptId,
      receiptReadableId: r.receiptReadableId,
      postingDate: r.postingDate,
      supplierId: r.supplierId,
      externalDocumentId: r.externalDocumentId,
      purchaseOrderLineId: r.purchaseOrderLineId,
      itemId: r.itemId,
      receivedQuantity: Number(r.receivedQuantity),
      unitPrice: Number(r.unitPrice),
      itemTrackingType: r.itemTrackingType,
      replenishmentSystem: r.replenishmentSystem
    };
  });
}

/**
 * post-purchase-invoice for every non-Draft invoice. The received share of a
 * line is what posted receipts of its PO line had brought in by the invoice's
 * posting date.
 */
export async function postPurchaseInvoices(
  ctx: Ctx,
  posting: PostingContext
): Promise<void> {
  const invoices = await rows<{
    id: string;
    invoiceId: string;
    status: string;
    postingDate: string | null;
    exchangeRate: string | null;
  }>(
    ctx.client,
    `SELECT id, "invoiceId", status, "postingDate"::text AS "postingDate", "exchangeRate"
     FROM "purchaseInvoice" WHERE "companyId" = $1 AND status <> 'Draft'
     ORDER BY "postingDate", "invoiceId"`,
    [ctx.companyId]
  );
  if (invoices.length === 0) return;
  const lines = await rows<{
    invoiceId: string;
    quantity: string;
    supplierUnitPrice: string;
    purchaseOrderLineId: string | null;
  }>(
    ctx.client,
    `SELECT "invoiceId", quantity, "supplierUnitPrice", "purchaseOrderLineId"
     FROM "purchaseInvoiceLine"
     WHERE "companyId" = $1 AND "invoiceId" = ANY($2::text[])
     ORDER BY "createdAt", id`,
    [ctx.companyId, invoices.map((i) => i.id)]
  );
  const receipts = await postedReceiptLines(ctx);
  for (const invoice of invoices) {
    const postingDate = invoice.postingDate;
    if (!postingDate) {
      throw new Error(
        `Seed: purchase invoice ${invoice.invoiceId} has no postingDate`
      );
    }
    if (Number(invoice.exchangeRate ?? 1) !== 1) {
      throw new Error(
        `Seed: purchase invoice ${invoice.invoiceId} is not base currency — seeded GL is USD only`
      );
    }
    const journal = purchaseInvoiceJournal({
      invoiceReadableId: invoice.invoiceId,
      lines: lines
        .filter((l) => l.invoiceId === invoice.id)
        .map((l) => {
          const poLineId = l.purchaseOrderLineId;
          if (!poLineId) {
            throw new Error(
              `Seed: purchase invoice ${invoice.invoiceId} has a line with no purchase order line`
            );
          }
          const received = receipts.filter(
            (r) =>
              r.purchaseOrderLineId === poLineId && r.postingDate <= postingDate
          );
          return {
            quantity: Number(l.quantity),
            unitCost: Number(l.supplierUnitPrice),
            purchaseOrderLineId: poLineId,
            receivedQuantity: received.reduce(
              (sum, r) => sum + r.receivedQuantity,
              0
            ),
            receiptUnitCost: received[0]?.unitPrice ?? null
          };
        })
    });
    ctx.log(`journal — ${journal.description}`);
    const posted = await insertPostingJournal(ctx, posting, {
      journal,
      documentId: invoice.id,
      postingDate
    });
    if (invoice.status === "Voided") {
      await insertPostingJournal(ctx, posting, {
        journal: voidJournal(journal, invoice.invoiceId),
        documentId: invoice.id,
        postingDate,
        referencePrefix: posted.journalEntryId
      });
    }
  }
}

/**
 * Posted purchase receipts and sales shipments, in date order: each receipt
 * line opens a FIFO cost layer (post-receipt), each shipment draws on the
 * layers or the item's unitCost (calculateCOGS), and both get their journal.
 */
export async function postInventoryDocuments(
  ctx: Ctx,
  posting: PostingContext
): Promise<void> {
  const receipts = await postedReceiptLines(ctx);
  const shipments = await rows<{
    shipmentId: string;
    shipmentReadableId: string;
    postingDate: string;
    shipmentLineId: string;
    itemId: string;
    shippedQuantity: string;
    itemTrackingType: string | null;
    replenishmentSystem: string | null;
    unitCost: string | null;
  }>(
    ctx.client,
    `SELECT s.id AS "shipmentId", s."shipmentId" AS "shipmentReadableId",
            s."postingDate"::text AS "postingDate", sl.id AS "shipmentLineId",
            sl."itemId", sl."shippedQuantity", i."itemTrackingType",
            i."replenishmentSystem", ic."unitCost"
     FROM shipment s
     JOIN "shipmentLine" sl ON sl."shipmentId" = s.id AND sl."companyId" = s."companyId"
     JOIN item i ON i.id = sl."itemId" AND i."companyId" = s."companyId"
     JOIN "itemCost" ic ON ic."itemId" = i.id AND ic."companyId" = s."companyId"
     WHERE s."companyId" = $1 AND s.status = 'Posted'
       AND s."sourceDocument" = 'Sales Order' AND sl."shippedQuantity" > 0
     ORDER BY s."postingDate", s."shipmentId", sl."createdAt", sl.id`,
    [ctx.companyId]
  );
  // Scrap write-offs (tier 03) draw layers like any other decrease.
  const scraps = await rows<{
    itemLedgerId: string;
    postingDate: string;
    itemId: string;
    quantity: string;
    comment: string | null;
    itemTrackingType: string | null;
    replenishmentSystem: string | null;
    unitCost: string | null;
  }>(
    ctx.client,
    `SELECT il.id AS "itemLedgerId", il."postingDate"::text AS "postingDate",
            il."itemId", -il.quantity AS quantity, il.comment,
            i."itemTrackingType", i."replenishmentSystem", ic."unitCost"
     FROM "itemLedger" il
     JOIN item i ON i.id = il."itemId" AND i."companyId" = il."companyId"
     JOIN "itemCost" ic ON ic."itemId" = i.id AND ic."companyId" = il."companyId"
     WHERE il."companyId" = $1 AND il."documentType" = 'Scrap'
       AND il."entryType" = 'Negative Adjmt.'
     ORDER BY il."postingDate", il.id`,
    [ctx.companyId]
  );

  type Layer = {
    line: PostedReceiptLine;
    quantity: number;
    cost: number;
    remaining: number;
  };
  const layersByItem = new Map<string, Layer[]>();
  const layers: Layer[] = [];
  const events = [
    ...receipts.map((line) => ({
      kind: "receipt" as const,
      date: line.postingDate,
      line
    })),
    ...shipments.map((row) => ({
      kind: "shipment" as const,
      date: row.postingDate,
      row
    })),
    ...scraps.map((scrap) => ({
      kind: "scrap" as const,
      date: scrap.postingDate,
      scrap
    }))
  ].sort((a, b) =>
    a.date === b.date
      ? (a.kind === "receipt" ? 0 : 1) - (b.kind === "receipt" ? 0 : 1)
      : a.date < b.date
        ? -1
        : 1
  );
  const shipmentCosts = new Map<string, number>();
  const scrapCosts = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "scrap") {
      const { scrap } = event;
      if (scrap.itemTrackingType === "Non-Inventory") continue;
      scrapCosts.set(
        scrap.itemLedgerId,
        consumeFifo(
          layersByItem.get(scrap.itemId) ?? [],
          Number(scrap.quantity),
          Number(scrap.unitCost ?? 0)
        )
      );
      continue;
    }
    if (event.kind === "receipt") {
      const { line } = event;
      if (line.itemTrackingType === "Non-Inventory") continue;
      const layer = {
        line,
        quantity: line.receivedQuantity,
        cost: line.receivedQuantity * line.unitPrice,
        remaining: line.receivedQuantity
      };
      layers.push(layer);
      layersByItem.set(line.itemId, [
        ...(layersByItem.get(line.itemId) ?? []),
        layer
      ]);
      continue;
    }
    const { row } = event;
    if (row.itemTrackingType === "Non-Inventory") continue;
    shipmentCosts.set(
      row.shipmentLineId,
      consumeFifo(
        layersByItem.get(row.itemId) ?? [],
        Number(row.shippedQuantity),
        Number(row.unitCost ?? 0)
      )
    );
  }

  // ── Receipts: one Direct Cost layer per line, then the receipt's journal ──
  for (const layer of layers) {
    await insertRow(ctx, "costLedger", {
      itemLedgerType: "Purchase",
      costLedgerType: "Direct Cost",
      adjustment: false,
      documentType: "Purchase Receipt",
      documentId: layer.line.receiptId,
      externalDocumentId: layer.line.externalDocumentId ?? undefined,
      itemId: layer.line.itemId,
      quantity: round(layer.quantity),
      nominalCost: round(layer.cost),
      cost: round(layer.cost),
      remainingQuantity: round(layer.remaining),
      supplierId: layer.line.supplierId ?? undefined,
      postingDate: layer.line.postingDate
    });
  }
  const receiptIds = [...new Set(receipts.map((r) => r.receiptId))];
  for (const receiptId of receiptIds) {
    const own = receipts.filter((r) => r.receiptId === receiptId);
    const first = own[0]!;
    const journal = receiptJournal({
      receiptReadableId: first.receiptReadableId,
      lines: own.map((r) => ({
        quantity: r.receivedQuantity,
        cost: r.receivedQuantity * r.unitPrice,
        purchaseOrderLineId: r.purchaseOrderLineId,
        replenishmentSystem: r.replenishmentSystem,
        itemTrackingType: r.itemTrackingType
      }))
    });
    ctx.log(`journal — ${journal.description}`);
    await insertPostingJournal(ctx, posting, {
      journal,
      documentId: receiptId,
      postingDate: first.postingDate
    });
  }

  // ── Shipments: one Sale row per item (post-shipment), then the journal ──
  const shipmentIds = [...new Set(shipments.map((s) => s.shipmentId))];
  for (const shipmentId of shipmentIds) {
    const own = shipments.filter(
      (s) =>
        s.shipmentId === shipmentId && s.itemTrackingType !== "Non-Inventory"
    );
    if (own.length === 0) continue;
    const postingDate = own[0]!.postingDate;
    const byItem = new Map<string, { quantity: number; cost: number }>();
    for (const s of own) {
      const item = s.itemId;
      const prior = byItem.get(item) ?? { quantity: 0, cost: 0 };
      byItem.set(item, {
        quantity: prior.quantity + Number(s.shippedQuantity),
        cost: prior.cost + (shipmentCosts.get(s.shipmentLineId) ?? 0)
      });
    }
    for (const [itemId, total] of byItem) {
      await insertRow(ctx, "costLedger", {
        itemLedgerType: "Sale",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Sales Shipment",
        documentId: shipmentId,
        itemId,
        quantity: round(-total.quantity),
        cost: round(-total.cost),
        remainingQuantity: 0,
        postingDate
      });
    }
    const journal = shipmentJournal({
      shipmentReadableId: own[0]!.shipmentReadableId,
      lines: own.map((s) => ({
        quantity: Number(s.shippedQuantity),
        cost: shipmentCosts.get(s.shipmentLineId) ?? 0,
        shipmentLineId: s.shipmentLineId,
        replenishmentSystem: s.replenishmentSystem,
        itemTrackingType: s.itemTrackingType
      }))
    });
    ctx.log(`journal — ${journal.description}`);
    await insertPostingJournal(ctx, posting, {
      journal,
      documentId: shipmentId,
      postingDate
    });
  }

  // ── Scrap: the decrease's cost row, then its journal against the scrap account ──
  for (const scrap of scraps) {
    const cost = scrapCosts.get(scrap.itemLedgerId);
    // A zero-value movement posts nothing, as bookAdjustment.
    if (!cost) continue;
    const quantity = Number(scrap.quantity);
    await insertRow(ctx, "costLedger", {
      itemLedgerType: "Negative Adjmt.",
      costLedgerType: "Direct Cost",
      adjustment: false,
      documentType: "Scrap",
      documentId: scrap.itemLedgerId,
      itemId: scrap.itemId,
      quantity: round(-quantity),
      cost: round(-cost),
      remainingQuantity: 0,
      postingDate: scrap.postingDate
    });
    const journal = scrapJournal({
      description: scrap.comment?.trim()
        ? `Scrap — ${scrap.comment.trim()}`
        : "Scrap",
      quantity,
      cost,
      replenishmentSystem: scrap.replenishmentSystem,
      itemTrackingType: scrap.itemTrackingType
    });
    ctx.log(`journal — ${journal.description}`);
    await insertPostingJournal(ctx, posting, {
      journal,
      documentId: scrap.itemLedgerId,
      postingDate: scrap.postingDate
    });
  }
}

/** post-memo for every Posted memo still without a journal (tier 09's and the return credits). */
export async function postMemos(
  ctx: Ctx,
  posting: PostingContext
): Promise<void> {
  const memos = await rows<{
    id: string;
    memoId: string;
    direction: "Credit" | "Debit";
    customerId: string | null;
    amount: string;
    exchangeRate: string;
    postingDate: string | null;
    reasonAccount: string | null;
  }>(
    ctx.client,
    `SELECT id, "memoId", direction, "customerId", amount, "exchangeRate",
            "postingDate"::text AS "postingDate", "reasonAccount"
     FROM memo
     WHERE "companyId" = $1 AND status = 'Posted' AND "journalId" IS NULL
     ORDER BY "postingDate", "memoId"`,
    [ctx.companyId]
  );
  for (const memo of memos) {
    const reasonClass = memo.reasonAccount
      ? posting.classById.get(memo.reasonAccount)
      : undefined;
    if (!memo.postingDate || !memo.reasonAccount || !reasonClass) {
      throw new Error(
        `Seed: posted memo ${memo.memoId} needs a posting date and an active reason account`
      );
    }
    if (Number(memo.exchangeRate) !== 1) {
      throw new Error(`Seed: memo ${memo.memoId} is not base currency`);
    }
    const journal = memoJournal({
      memoReadableId: memo.memoId,
      documentId: memo.id,
      direction: memo.direction,
      isAR: memo.customerId !== null,
      amount: Number(memo.amount),
      reasonAccountClass: reasonClass
    });
    ctx.log(`journal — ${journal.description}`);
    const { id } = await insertPostingJournal(ctx, posting, {
      journal,
      documentId: memo.id,
      postingDate: memo.postingDate,
      reasonAccountId: memo.reasonAccount
    });
    await ctx.client.query(
      `UPDATE memo SET "journalId" = $1, "updatedBy" = $2
       WHERE id = $3 AND "companyId" = $4`,
      [id, ctx.userId, memo.id, ctx.companyId]
    );
  }
}

/** post-payment's journal for one Posted payment, then payment.journalId. */
export async function postPayment(
  ctx: Ctx,
  posting: PostingContext,
  args: {
    paymentId: string;
    paymentReadableId: string;
    type: "Receipt" | "Disbursement";
    amount: number;
    postingDate: string;
    applies: { targetId: string; amount: number }[];
  }
): Promise<void> {
  const journal = paymentJournal({
    paymentReadableId: args.paymentReadableId,
    documentId: args.paymentId,
    type: args.type,
    amount: args.amount,
    applies: args.applies
  });
  const { id } = await insertPostingJournal(ctx, posting, {
    journal,
    documentId: args.paymentId,
    postingDate: args.postingDate
  });
  await ctx.client.query(
    `UPDATE payment SET "journalId" = $1, "updatedBy" = $2
     WHERE id = $3 AND "companyId" = $4`,
    [id, ctx.userId, args.paymentId, ctx.companyId]
  );
}
