// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reads behind the customer-deposit funding rule (`fundingScopeCovers` in
// `@carbon/utils` payment-funding): a deposit funds only invoices that bill its
// own rental agreement, sales order or customer contract. The draft save
// (`replaceInvoiceSettlements`) and post-payment both scope funding with these,
// so the two cannot disagree about which invoice a deposit may pay.
import type { Kysely, Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

export type InvoiceDocumentIds = {
  rentalAgreementIds: string[];
  salesOrderIds: string[];
  customerContractIds: string[];
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
    invoiceIds.map((id) => [
      id,
      { rentalAgreementIds: [], salesOrderIds: [], customerContractIds: [] }
    ])
  );
  if (!invoiceIds.length) return byInvoice;
  const [lines, headers] = await Promise.all([
    db
      .selectFrom("salesInvoiceLine")
      .select([
        "invoiceId",
        "rentalAgreementId",
        "salesOrderId",
        "customerContractId"
      ])
      .where("companyId", "=", companyId)
      .where("invoiceId", "in", [...invoiceIds])
      .execute(),
    db
      .selectFrom("salesInvoice")
      .select(["id", "customerContractId"])
      .where("companyId", "=", companyId)
      .where("id", "in", [...invoiceIds])
      .where("customerContractId", "is not", null)
      .execute()
  ]);
  const add = (list: string[], id: string | null) => {
    if (id && !list.includes(id)) list.push(id);
  };
  for (const line of lines) {
    const ids = byInvoice.get(line.invoiceId);
    if (!ids) continue;
    add(ids.rentalAgreementIds, line.rentalAgreementId);
    add(ids.salesOrderIds, line.salesOrderId);
    add(ids.customerContractIds, line.customerContractId);
  }
  for (const header of headers) {
    const ids = byInvoice.get(header.id);
    if (ids) add(ids.customerContractIds, header.customerContractId);
  }
  // A delivery invoice of the contract's own sales order bills the contract
  // too: a shipment converts to an invoice with the order on its lines.
  const salesOrderIds = [
    ...new Set(lines.map((line) => line.salesOrderId))
  ].filter((id): id is string => Boolean(id));
  if (salesOrderIds.length) {
    const contracts = await db
      .selectFrom("customerContract")
      .select(["id", "salesOrderId"])
      .where("companyId", "=", companyId)
      .where("salesOrderId", "in", salesOrderIds)
      .execute();
    const contractsByOrder = new Map<string, string[]>();
    for (const contract of contracts) {
      if (!contract.salesOrderId) continue;
      const list = contractsByOrder.get(contract.salesOrderId) ?? [];
      list.push(contract.id);
      contractsByOrder.set(contract.salesOrderId, list);
    }
    for (const ids of byInvoice.values()) {
      for (const orderId of ids.salesOrderIds) {
        for (const contractId of contractsByOrder.get(orderId) ?? []) {
          add(ids.customerContractIds, contractId);
        }
      }
    }
  }
  return byInvoice;
}

/**
 * The posted sales invoices that bill a customer contract: the invoice's own
 * `customerContractId`, a line's, or a line of the contract's sales order.
 * Contract financing reads the same set as the deposit scope.
 */
export async function loadContractInvoiceIds(
  db: Db,
  companyId: string,
  customerContractId: string
): Promise<string[]> {
  const contract = await db
    .selectFrom("customerContract")
    .select(["salesOrderId"])
    .where("id", "=", customerContractId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const rows = await db
    .selectFrom("salesInvoice as i")
    .select("i.id")
    .where("i.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb("i.customerContractId", "=", customerContractId),
        eb.exists(
          eb
            .selectFrom("salesInvoiceLine as l")
            .select("l.id")
            .whereRef("l.invoiceId", "=", "i.id")
            .whereRef("l.companyId", "=", "i.companyId")
            .where((line) =>
              line.or([
                line("l.customerContractId", "=", customerContractId),
                ...(contract?.salesOrderId
                  ? [line("l.salesOrderId", "=", contract.salesOrderId)]
                  : [])
              ])
            )
        )
      ])
    )
    .execute();
  return rows.map((row) => row.id);
}

/**
 * The document a customer deposit secures, with its readable id (RA000001,
 * SO000123) for the refusal message; null for an ordinary payment.
 */
export async function loadDepositScope(
  db: Db,
  companyId: string,
  payment: {
    rentalAgreementId: string | null;
    salesOrderId: string | null;
    customerContractId?: string | null;
  }
): Promise<{
  type: "rentalAgreement" | "salesOrder" | "customerContract";
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
  if (payment.customerContractId) {
    const contract = await db
      .selectFrom("customerContract")
      .select("customerContractId")
      .where("id", "=", payment.customerContractId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return {
      type: "customerContract",
      id: payment.customerContractId,
      readableId: contract?.customerContractId ?? null
    };
  }
  return null;
}
