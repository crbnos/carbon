import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import { round } from "@carbon/utils";
import { type Insertable, type Kysely, sql } from "kysely";
import { buildRampBillPurchaseOrderLines } from "./ramp-sync-bill-po";

export type RampBillLine = {
  accountId: string;
  costCenterId: string | null;
  amount: number;
  description: string | null;
  purchaseOrderLineId?: string;
  quantity?: number;
};

export type RampBillDraft = {
  companyId: string;
  sourceId: string;
  supplierId: string;
  supplierReference: string;
  currencyCode: string;
  exchangeRate: number;
  decimals: number;
  totalAmount: number;
  dateIssued: string | null;
  dateDue: string | null;
  lines: RampBillLine[];
  purchaseOrderId?: string;
  memo?: string;
  carbonBornInvoiceId?: string | null;
};

export const POSTED_BILL_STATUSES = [
  "Open",
  "Paid",
  "Partially Paid",
  "Overdue"
] as const;
export const isPostedRampBill = (status: string) =>
  POSTED_BILL_STATUSES.some((posted) => posted === status);

/**
 * The source lock protects the entire Draft, including its mapping, not merely
 * the final insert. The reference lock also prevents two distinct Ramp ids from
 * claiming the same legacy invoice. External posting happens AFTER this commit.
 */
export async function stageOrResumeRampBill(
  db: Kysely<KyselyDatabase>,
  args: RampBillDraft
) {
  if (
    !args.lines.length ||
    !Number.isFinite(args.totalAmount) ||
    args.totalAmount <= 0
  ) {
    throw new Error("Ramp bill requires coded lines and a positive total");
  }
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ramp:bill:${args.companyId}:${args.sourceId}`}, 0))`.execute(
      tx
    );
    if (args.supplierReference) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ramp:bill-reference:${args.companyId}:${args.supplierId}:${args.supplierReference}`}, 0))`.execute(
        tx
      );
    }
    const mapping = createMappingService(tx, args.companyId);
    const mappedId = await mapping.getEntityId("ramp", args.sourceId, "bill");
    const explicitId = mappedId ?? args.carbonBornInvoiceId;
    let existing = explicitId
      ? await tx
          .selectFrom("purchaseInvoice")
          .selectAll()
          .where("id", "=", explicitId)
          .where("companyId", "=", args.companyId)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    if (explicitId && !existing)
      throw new Error(
        "Mapped Ramp bill invoice does not exist in this company"
      );
    if (!existing && args.supplierReference) {
      const candidates = await tx
        .selectFrom("purchaseInvoice")
        .selectAll()
        .where("companyId", "=", args.companyId)
        .where("supplierId", "=", args.supplierId)
        .where("supplierReference", "=", args.supplierReference)
        .limit(2)
        .forUpdate()
        .execute();
      if (candidates.length > 1)
        throw new Error(
          "Ambiguous legacy Ramp bill invoices; reconcile manually"
        );
      existing = candidates[0];
    }
    if (existing) {
      if (!explicitId && existing.status !== "Draft") {
        throw new Error(
          "Reference-only invoice is not a valid legacy Ramp Draft; reconcile manually"
        );
      }
      if (existing.status !== "Draft" && !isPostedRampBill(existing.status)) {
        throw new Error(
          `Ramp bill invoice is ${existing.status}, not safely postable`
        );
      }
      if (
        existing.supplierId !== args.supplierId ||
        existing.currencyCode !== args.currencyCode ||
        existing.supplierReference !== args.supplierReference
      ) {
        throw new Error(
          "Existing Ramp bill invoice identity or currency does not match"
        );
      }
      const otherSource = await mapping.getExternalId(
        "bill",
        existing.id,
        "ramp"
      );
      if (otherSource && otherSource !== args.sourceId)
        throw new Error("Invoice is already linked to a different Ramp bill");
      if (
        !mappedId &&
        existing.status === "Draft" &&
        (existing.createdBy !== "system" ||
          existing.postingDate ||
          args.carbonBornInvoiceId)
      ) {
        throw new Error(
          "Untracked Draft is not a valid legacy Ramp bill; reconcile manually"
        );
      }
      const delivery = await tx
        .selectFrom("purchaseInvoiceDelivery")
        .selectAll()
        .where("id", "=", existing.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      const lines = await tx
        .selectFrom("purchaseInvoiceLine")
        .selectAll()
        .where("invoiceId", "=", existing.id)
        .where("companyId", "=", args.companyId)
        .orderBy("sortOrder")
        .execute();
      const total = lines.reduce(
        (sum, line) =>
          sum +
          Number(line.quantity) * Number(line.supplierUnitPrice) +
          Number(line.supplierShippingCost) +
          Number(line.supplierTaxAmount),
        Number(delivery?.supplierShippingCost ?? 0)
      );
      if (
        !delivery ||
        !lines.length ||
        round(total, args.decimals) !== args.totalAmount
      ) {
        throw new Error(
          "Existing Ramp bill invoice is incomplete or its total differs from Ramp"
        );
      }
      if (existing.status === "Draft") {
        const reconciled = args.purchaseOrderId
          ? await buildRampBillPurchaseOrderLines(tx, args, existing.id)
          : undefined;
        // A legacy Draft is adopted only if its complete coded/provenance shape
        // matches this source. Never select an arbitrary Draft attached to a PO.
        if (
          Number(delivery.supplierShippingCost) !== 0 ||
          lines.length !== args.lines.length ||
          lines.some((line, index) => {
            const expected = args.lines[index]!;
            const poLine = reconciled?.lines[index];
            const provenance = [
              "itemId",
              "assetId",
              "locationId",
              "storageUnitId",
              "jobOperationId",
              "purchaseUnitOfMeasureCode",
              "inventoryUnitOfMeasureCode"
            ] as const;
            return (
              line.accountId !== expected.accountId ||
              line.costCenterId !== expected.costCenterId ||
              line.invoiceLineType !==
                (poLine?.invoiceLineType ?? "G/L Account") ||
              round(Number(line.quantity)) !==
                round(Number(poLine?.quantity ?? 1)) ||
              line.conversionFactor !==
                (poLine?.invoiceLineType ? poLine.conversionFactor : 1) ||
              provenance.some(
                (field) => line[field] !== (poLine?.[field] ?? null)
              ) ||
              line.purchaseOrderId !==
                (args.purchaseOrderId && expected.purchaseOrderLineId
                  ? args.purchaseOrderId
                  : null) ||
              line.purchaseOrderLineId !==
                (expected.purchaseOrderLineId ?? null) ||
              round(
                Number(line.quantity) * Number(line.supplierUnitPrice),
                args.decimals
              ) !== expected.amount ||
              Number(line.supplierTaxAmount) !== 0 ||
              Number(line.supplierShippingCost) !== 0
            );
          })
        )
          throw new Error(
            "Existing Draft does not match the complete Ramp bill lines"
          );
      }
      await mapping.link("bill", existing.id, "ramp", args.sourceId, {
        createdBy: "system"
      });
      return {
        invoiceRowId: existing.id,
        status: existing.status,
        created: false
      };
    }

    // Stage only covered PO lines, reproducing the converter's provenance in
    // this transaction. Calling the convert edge here cannot atomically persist
    // the source mapping and would leave an unidentifiable Draft after a crash.
    const po = args.purchaseOrderId
      ? await buildRampBillPurchaseOrderLines(tx, args)
      : undefined;
    const interaction = await tx
      .insertInto("supplierInteraction")
      .values({ companyId: args.companyId, supplierId: args.supplierId })
      .returning("id")
      .executeTakeFirstOrThrow();
    const sequence = await sql<{
      value: string;
    }>`SELECT get_next_sequence('purchaseInvoice', ${args.companyId}) as value`.execute(
      tx
    );
    const invoiceId = sequence.rows[0]?.value;
    if (!invoiceId) throw new Error("Failed to generate Ramp invoice number");
    const invoice = await tx
      .insertInto("purchaseInvoice")
      .values({
        ...po?.header,
        invoiceId,
        status: "Draft",
        supplierId: args.supplierId,
        supplierReference: args.supplierReference,
        currencyCode: args.currencyCode,
        exchangeRate: args.exchangeRate,
        dateIssued: args.dateIssued,
        dateDue: args.dateDue,
        supplierInteractionId: interaction.id,
        companyId: args.companyId,
        createdBy: "system",
        ...(args.memo
          ? { internalNotes: JSON.stringify({ content: args.memo }) }
          : {})
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        ...po?.delivery,
        id: invoice.id,
        companyId: args.companyId,
        supplierShippingCost: 0
      })
      .execute();
    const rows: Insertable<KyselyDatabase["purchaseInvoiceLine"]>[] =
      args.lines.map((line, index) => ({
        ...po?.lines[index],
        invoiceId: invoice.id,
        companyId: args.companyId,
        createdBy: "system",
        invoiceLineType: po?.lines[index]?.invoiceLineType ?? "G/L Account",
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        description: line.description,
        quantity: po?.lines[index]?.quantity ?? 1,
        supplierUnitPrice: po?.lines[index]?.supplierUnitPrice ?? line.amount,
        supplierShippingCost: 0,
        supplierTaxAmount: 0,
        taxPercent: 0,
        exchangeRate: args.exchangeRate,
        sortOrder: index + 1
      }));
    await tx.insertInto("purchaseInvoiceLine").values(rows).execute();
    const total = await sql<{
      amount: string;
    }>`SELECT sum("quantity" * "supplierUnitPrice") AS amount
      FROM "purchaseInvoiceLine" WHERE "invoiceId" = ${invoice.id} AND "companyId" = ${args.companyId}`.execute(
      tx
    );
    if (
      round(Number(total.rows[0]?.amount), args.decimals) !== args.totalAmount
    ) {
      throw new Error(
        "Staged invoice does not exactly reconcile to the Ramp bill total"
      );
    }
    await mapping.link("bill", invoice.id, "ramp", args.sourceId, {
      createdBy: "system"
    });
    return {
      invoiceRowId: invoice.id,
      status: "Draft" as const,
      created: true
    };
  });
}
