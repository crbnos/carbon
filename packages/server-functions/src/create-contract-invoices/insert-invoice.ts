// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Draft sales invoice of a contract: opportunity, header, shipment and
// Service lines. Shared by the contract schedule source
// (`create-contract-invoices`) and the project billing source
// (`create-project-billing-invoices`), so both draft the same document.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { round } from "@carbon/database/precision";
import { getNextSequence } from "@carbon/database/sequence";
import type {
  ContractRow,
  Scope
} from "../post-customer-contract/schedule-writes";

type Enums = Database["public"]["Enums"];

/** One Service line of a contract invoice. A project billing line has no
 *  schedule row, so `customerContractInvoiceLineId` is null there. A Comment
 *  line (a project billing invoice's CLIN heading) has no item, no contract
 *  line and no amount. */
export type InvoiceLineValues = {
  invoiceLineType?: "Service" | "Comment";
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  customerContractId: string;
  customerContractLineId: string | null;
  customerContractInvoiceLineId: string | null;
  projectId: string | null;
  methodType: Enums["methodType"];
  unitOfMeasureCode: string;
};

/** Where a contract's invoices are drafted: its sales order's shipping
 *  location when it came from one, else the company's first location. A
 *  contract has no location of its own. */
export async function contractLocationId(
  trx: KyselyTx,
  companyId: string,
  contract: ContractRow
): Promise<string> {
  if (contract.salesOrderId) {
    const shipment = await trx
      .selectFrom("salesOrderShipment")
      .select("locationId")
      .where("id", "=", contract.salesOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (shipment?.locationId) return shipment.locationId;
  }
  const location = await trx
    .selectFrom("location")
    .select("id")
    .where("companyId", "=", companyId)
    .orderBy("createdAt")
    .orderBy("id")
    .executeTakeFirst();
  if (!location) {
    throw new Error("The company has no location to draft the invoice at");
  }
  return location.id;
}

/**
 * Inserts one Draft contract invoice: the opportunity, the header, the
 * shipment and the lines. Returns the invoice id and the inserted line ids in
 * `sortOrder` (the order of `lines`).
 */
export async function insertDraftContractInvoice(
  trx: KyselyTx,
  scope: Scope,
  args: {
    asOf: string;
    contract: ContractRow;
    locationId: string;
    holdReason: string | null;
    lines: InvoiceLineValues[];
  }
): Promise<{ invoiceId: string; lineIds: string[] }> {
  const { companyId, userId } = scope;
  const { asOf, contract, locationId, lines } = args;

  // Net merchandise per line, as the schedule priced it; tax on the net.
  const nets = lines.map((line) =>
    round(line.quantity * line.unitPrice * (1 - line.discountPercent))
  );
  const subtotal = round(nets.reduce((sum, net) => sum + net, 0));
  const totalTax = round(
    lines.reduce((sum, line, index) => sum + nets[index]! * line.taxPercent, 0)
  );

  const readableInvoiceId = await getNextSequence(
    trx,
    "salesInvoice",
    companyId
  );
  // Every sales invoice has an opportunity, as insertSalesInvoice makes one:
  // its documents live under the opportunity's storage folder, and the
  // invoice page reads it.
  const opportunity = await trx
    .insertInto("opportunity")
    .values({ companyId, customerId: contract.customerId })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  const invoice = await trx
    .insertInto("salesInvoice")
    .values({
      invoiceId: readableInvoiceId,
      status: "Draft",
      customerId: contract.customerId,
      invoiceCustomerId: contract.invoiceCustomerId ?? contract.customerId,
      invoiceCustomerContactId: contract.invoiceCustomerContactId,
      invoiceCustomerLocationId: contract.invoiceCustomerLocationId,
      locationId,
      paymentTermId: contract.paymentTermId,
      currencyCode: contract.currencyCode,
      exchangeRate: contract.exchangeRate,
      customerReference: contract.customerReference,
      customerContractId: contract.id,
      dateIssued: asOf,
      subtotal,
      totalDiscount: 0,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      opportunityId: opportunity.id,
      automationHoldReason: args.holdReason,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("salesInvoiceShipment")
    .values({
      id: invoice.id,
      locationId,
      // The contract's customer ship-to; sales rules evaluate the invoice's
      // lines against it.
      customerLocationId: contract.shipToCustomerLocationId,
      shippingCost: 0,
      companyId,
      createdBy: userId
    })
    .execute();

  const inserted = await trx
    .insertInto("salesInvoiceLine")
    .values(
      lines.map(({ invoiceLineType = "Service", ...line }, index) => ({
        invoiceId: invoice.id,
        invoiceLineType,
        ...line,
        exchangeRate: contract.exchangeRate,
        locationId,
        sortOrder: index + 1,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", "sortOrder"])
    .execute();
  // RETURNING order is not guaranteed: sort by the sortOrder each line got.
  const lineIds = inserted
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
    .map((line) => line.id);

  return { invoiceId: invoice.id, lineIds };
}
