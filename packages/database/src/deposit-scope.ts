// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reads behind the customer-deposit funding rule (`fundingScopeCovers` in
// `@carbon/utils` payment-funding): a deposit funds only invoices that bill its
// own rental agreement or sales order. The draft save
// (`replaceInvoiceSettlements`) and post-payment both scope funding with these,
// so the two cannot disagree about which invoice a deposit may pay.
import type { Kysely, Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

export type InvoiceDocumentIds = {
  rentalAgreementIds: string[];
  salesOrderIds: string[];
};

/**
 * The rental agreements and sales orders each sales invoice bills, read from
 * its lines in one query for every target. An invoice with no such line maps
 * to empty lists, which no deposit covers.
 */
export async function loadSalesInvoiceDocumentIds(
  db: Db,
  companyId: string,
  invoiceIds: readonly string[]
): Promise<Map<string, InvoiceDocumentIds>> {
  const byInvoice = new Map<string, InvoiceDocumentIds>(
    invoiceIds.map((id) => [id, { rentalAgreementIds: [], salesOrderIds: [] }])
  );
  if (!invoiceIds.length) return byInvoice;
  const lines = await db
    .selectFrom("salesInvoiceLine")
    .select(["invoiceId", "rentalAgreementId", "salesOrderId"])
    .where("companyId", "=", companyId)
    .where("invoiceId", "in", [...invoiceIds])
    .execute();
  for (const line of lines) {
    const ids = byInvoice.get(line.invoiceId);
    if (!ids) continue;
    if (
      line.rentalAgreementId &&
      !ids.rentalAgreementIds.includes(line.rentalAgreementId)
    )
      ids.rentalAgreementIds.push(line.rentalAgreementId);
    if (line.salesOrderId && !ids.salesOrderIds.includes(line.salesOrderId))
      ids.salesOrderIds.push(line.salesOrderId);
  }
  return byInvoice;
}

/**
 * The document a customer deposit secures, with its readable id (RA000001,
 * SO000123) for the refusal message; null for an ordinary payment.
 */
export async function loadDepositScope(
  db: Db,
  companyId: string,
  payment: { rentalAgreementId: string | null; salesOrderId: string | null }
): Promise<{
  type: "rentalAgreement" | "salesOrder";
  id: string;
  readableId: string | null;
} | null> {
  if (payment.rentalAgreementId) {
    const agreement = await db
      .selectFrom("rentalAgreement")
      .select("rentalAgreementId")
      .where("id", "=", payment.rentalAgreementId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return {
      type: "rentalAgreement",
      id: payment.rentalAgreementId,
      readableId: agreement?.rentalAgreementId ?? null
    };
  }
  if (payment.salesOrderId) {
    const order = await db
      .selectFrom("salesOrder")
      .select("salesOrderId")
      .where("id", "=", payment.salesOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return {
      type: "salesOrder",
      id: payment.salesOrderId,
      readableId: order?.salesOrderId ?? null
    };
  }
  return null;
}
