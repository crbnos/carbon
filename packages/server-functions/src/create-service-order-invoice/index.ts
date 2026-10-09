// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoices a Completed service order: one Draft sales invoice of its Unbilled
// billable items, laid out by the work tree (`planServiceInvoiceLines`). It
// follows create-contract-invoices (sequence, opportunity, header,
// salesInvoiceShipment, then lines). Posting stays with post-sales-invoice,
// which posts revenue only for these lines: their parts already left stock.
// Spec: .ai/specs/2026-10-08-field-service.md (Invoicing).

import { getCompanyTimeZone } from "@carbon/database";
import { inOrder, maybeSingle, rpcValue } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime, round } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError, ServerFnError } from "../errors";
import { planServiceInvoiceLines } from "./plan";

export const createServiceOrderInvoiceInput = z.object({
  serviceOrderId: z.string()
});

export type CreateServiceOrderInvoiceResult = {
  success: true;
  salesInvoiceId: string;
  /** The readable invoice id. */
  invoiceId: string;
};

const CONTRACT_NOTE = "(Covered by contract)";

/**
 * Drafts the invoice of one Completed service order, in one transaction:
 * 1. locks the order and refuses unless it is Completed with an Unbilled item;
 * 2. inserts the opportunity, the header (`serviceOrderId`, the customer and
 *    site, the order's location, the customer's payment term and currency)
 *    and `salesInvoiceShipment`;
 * 3. inserts the lines from the plan, in order;
 * 4. stamps each billable item with its line and sets it Billed;
 * 5. closes the order and stamps it with the invoice.
 * Tax stays at 0: the customer has no default rate (as create-contract-invoices
 * takes only what its source names).
 */
const createServiceOrderInvoice = defineServerFn({
  name: "create-service-order-invoice",
  input: createServiceOrderInvoiceInput,
  permissions: { update: "service", create: "invoicing" },
  async run(
    { db, companyId, userId },
    { serviceOrderId }
  ): Promise<CreateServiceOrderInvoiceResult> {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    return db.transaction().execute(async (trx) => {
      // Row lock: two invoices of one order must not both bill it.
      const order = await trx
        .selectFrom("serviceOrder")
        .select([
          "id",
          "serviceOrderId",
          "status",
          "type",
          "projectId",
          "customerId",
          "customerLocationId",
          "customerContractId",
          "locationId",
          "invoiceDetail"
        ])
        .where("id", "=", serviceOrderId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new NotFoundError("Service order not found");
      if (order.status !== "Completed") {
        throw new ServerFnError(
          `Service order ${order.serviceOrderId} is ${order.status}. Only a Completed order is invoiced.`,
          422
        );
      }
      if (!order.customerId) {
        throw new ServerFnError(
          "A refurbishment has no customer to invoice",
          422
        );
      }
      const customerId = order.customerId;

      const [items, elements, customerPayment, customer, company, contract] =
        await inOrder([
          () =>
            trx
              .selectFrom("projectBillableItem")
              .innerJoin("projectLedger", (join) =>
                join
                  .onRef(
                    "projectLedger.id",
                    "=",
                    "projectBillableItem.projectLedgerId"
                  )
                  .onRef(
                    "projectLedger.companyId",
                    "=",
                    "projectBillableItem.companyId"
                  )
              )
              .select([
                "projectBillableItem.id",
                "projectBillableItem.projectElementId",
                "projectBillableItem.itemId",
                "projectBillableItem.description",
                "projectBillableItem.quantity",
                "projectBillableItem.unitPrice",
                "projectBillableItem.amount",
                "projectLedger.unitOfMeasureCode"
              ])
              .where("projectBillableItem.projectId", "=", order.projectId)
              .where("projectBillableItem.companyId", "=", companyId)
              .where("projectBillableItem.status", "=", "Unbilled")
              .orderBy("projectBillableItem.createdAt")
              .orderBy("projectBillableItem.id")
              .forUpdate()
              .execute(),
          () =>
            trx
              .selectFrom("projectElement")
              .select([
                "id",
                "parentId",
                "name",
                "sortOrder",
                "sequence",
                "fixedPrice"
              ])
              .where("projectId", "=", order.projectId)
              .where("companyId", "=", companyId)
              .execute(),
          () => maybeSingle(trx, "customerPayment", { customerId, companyId }),
          () => maybeSingle(trx, "customer", { id: customerId, companyId }),
          () =>
            maybeSingle(
              trx,
              "company",
              { id: companyId },
              { columns: ["baseCurrencyCode"] }
            ),
          async () =>
            order.customerContractId
              ? trx
                  .selectFrom("customerContract")
                  .select("customerContractId")
                  .where("id", "=", order.customerContractId)
                  .where("companyId", "=", companyId)
                  .executeTakeFirst()
              : undefined
        ]);
      if (customerPayment.error) throw customerPayment.error;
      if (customer.error) throw customer.error;
      if (company.error) throw company.error;
      if (items.length === 0) {
        throw new ServerFnError(
          `Service order ${order.serviceOrderId} has no unbilled charge. Close it instead.`,
          422
        );
      }

      const lines = planServiceInvoiceLines({
        elements: elements.map((element) => ({
          id: element.id,
          parentId: element.parentId,
          name: element.name,
          sortOrder: Number(element.sortOrder ?? 0),
          sequence: Number(element.sequence ?? 0),
          fixedPrice:
            element.fixedPrice === null ? null : Number(element.fixedPrice)
        })),
        items: items.map((item) => ({
          id: item.id,
          projectElementId: item.projectElementId,
          itemId: item.itemId,
          // A covered item names its contract on the invoice.
          description: contract?.customerContractId
            ? item.description.replace(
                CONTRACT_NOTE,
                `(Covered by contract ${contract.customerContractId})`
              )
            : item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
          unitOfMeasureCode: item.unitOfMeasureCode ?? "EA"
        })),
        invoiceDetail: order.invoiceDetail
      });

      const currencyCode =
        customer.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
      // 1 for the base currency; raises on a missing rate.
      const rate = await rpcValue(trx, "get_exchange_rate", {
        p_company_id: companyId,
        p_currency_code: currencyCode
      });
      if (rate.error) throw new Error(rate.error.message);
      const exchangeRate = Number(rate.data);

      const subtotal = round(
        lines.reduce(
          (sum, line) =>
            line.invoiceLineType === "Service"
              ? sum + line.quantity * line.unitPrice
              : sum,
          0
        )
      );

      const readableInvoiceId = await getNextSequence(
        trx,
        "salesInvoice",
        companyId
      );
      // Every sales invoice has an opportunity: its documents live under the
      // opportunity's storage folder.
      const opportunity = await trx
        .insertInto("opportunity")
        .values({ companyId, customerId })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      const invoice = await trx
        .insertInto("salesInvoice")
        .values({
          invoiceId: readableInvoiceId,
          status: "Draft",
          customerId,
          invoiceCustomerId:
            customerPayment.data?.invoiceCustomerId ?? customerId,
          invoiceCustomerContactId:
            customerPayment.data?.invoiceCustomerContactId ?? null,
          invoiceCustomerLocationId:
            customerPayment.data?.invoiceCustomerLocationId ?? null,
          locationId: order.locationId,
          paymentTermId: customerPayment.data?.paymentTermId ?? null,
          currencyCode,
          exchangeRate,
          customerReference: order.serviceOrderId,
          serviceOrderId: order.id,
          dateIssued: today,
          subtotal,
          totalDiscount: 0,
          totalTax: 0,
          totalAmount: subtotal,
          opportunityId: opportunity.id,
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("salesInvoiceShipment")
        .values({
          id: invoice.id,
          locationId: order.locationId,
          customerLocationId: order.customerLocationId,
          shippingCost: 0,
          companyId,
          createdBy: userId
        })
        .execute();

      // Multi-row RETURNING does not promise order: match on sortOrder.
      const inserted = await trx
        .insertInto("salesInvoiceLine")
        .values(
          lines.map((line, index) => ({
            invoiceId: invoice.id,
            invoiceLineType: line.invoiceLineType,
            description: line.description,
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitOfMeasureCode: line.unitOfMeasureCode,
            taxPercent: 0,
            exchangeRate,
            locationId: order.locationId,
            sortOrder: index + 1,
            companyId,
            createdBy: userId
          }))
        )
        .returning(["id", "sortOrder"])
        .execute();
      const lineIdBySortOrder = new Map(
        inserted.map((row) => [Number(row.sortOrder), row.id])
      );

      const stamps = lines.flatMap((line, index) =>
        line.billableItemIds.map((billableItemId) => ({
          billableItemId,
          lineId: lineIdBySortOrder.get(index + 1)!
        }))
      );
      if (stamps.length > 0) {
        await sql`
          UPDATE "projectBillableItem" b
          SET "salesInvoiceLineId" = v."lineId",
              "status" = 'Billed',
              "updatedBy" = ${userId},
              "updatedAt" = NOW()
          FROM (VALUES ${sql.join(
            stamps.map(
              (stamp) => sql`(${stamp.billableItemId}, ${stamp.lineId})`
            )
          )}) AS v("id", "lineId")
          WHERE b."id" = v."id" AND b."companyId" = ${companyId}
        `.execute(trx);
      }

      await trx
        .updateTable("serviceOrder")
        .set({
          status: "Closed",
          salesInvoiceId: invoice.id,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", order.id)
        .where("companyId", "=", companyId)
        .execute();

      return {
        success: true,
        salesInvoiceId: invoice.id,
        invoiceId: readableInvoiceId
      };
    });
  }
});

export default createServiceOrderInvoice;
