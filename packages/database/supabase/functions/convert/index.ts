import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  getLocalTimeZone,
  now,
  toCalendarDate,
} from "npm:@internationalized/date";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { format } from "https://deno.land/std@0.205.0/datetime/format.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("methodVersionToActive"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("purchaseOrderToPurchaseInvoice"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("quoteToSalesOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
    purchaseOrderNumber: z.string().optional(),
    selectedLines: z.record(
      z.string(),
      z.object({
        quantity: z.number(),
        netUnitPrice: z.number(),
        convertedNetUnitPrice: z.number(),
        addOn: z.number(),
        convertedAddOn: z.number(),
        shippingCost: z.number(),
        convertedShippingCost: z.number(),
        leadTime: z.number(),
      })
    ),
    digitalQuoteAcceptedBy: z.string().optional(),
    digitalQuoteAcceptedByEmail: z.string().optional(),
  }),

  z.object({
    type: z.literal("salesOrderToSalesInvoice"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("salesRfqToQuote"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentToSalesInvoice"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("supplierQuoteToPurchaseOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
    selectedLines: z.record(
      z.string(),
      z.object({
        leadTime: z.number(),
        quantity: z.number(),
        shippingCost: z.number(),
        supplierShippingCost: z.number(),
        supplierUnitPrice: z.number(),
        supplierTaxAmount: z.number(),
        unitPrice: z.number(),
      })
    ),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  let convertedId = "";
  try {
    const { type, id, companyId, userId } = payloadValidator.parse(payload);

    console.log({
      function: "convert",
      type,
      id,
      companyId,
      userId,
    });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    switch (type) {
      case "methodVersionToActive": {
        const makeMethodId = id;
        const makeMethod = await client
          .from("makeMethod")
          .select("*")
          .eq("id", makeMethodId)
          .single();
        if (makeMethod.error) throw new Error(makeMethod.error.message);

        const [relatedMakeMethods, draftQuotes, draftJobs] = await Promise.all([
          client
            .from("makeMethod")
            .select("*")
            .eq("itemId", makeMethod.data?.itemId)
            .eq("companyId", companyId),
          client
            .from("quote")
            .select("*")
            .eq("companyId", companyId)
            .eq("status", "Draft"),
          client
            .from("job")
            .select("*")
            .eq("companyId", companyId)
            .eq("status", "Draft"),
        ]);

        if (relatedMakeMethods.error)
          throw new Error(relatedMakeMethods.error.message);

        if (draftQuotes.error) throw new Error(draftQuotes.error.message);
        if (draftJobs.error) throw new Error(draftJobs.error.message);

        const draftMakeMethodIds = relatedMakeMethods.data
          ?.filter(
            (makeMethod) =>
              makeMethod.id !== makeMethodId && makeMethod.status === "Draft"
          )
          ?.map((makeMethod) => makeMethod.id);

        const activeMakeMethodIds = relatedMakeMethods.data
          ?.filter(
            (makeMethod) =>
              makeMethod.id !== makeMethodId && makeMethod.status === "Active"
          )
          ?.map((makeMethod) => makeMethod.id);

        const relatedMakeMethodIds = [
          ...(draftMakeMethodIds ?? []),
          ...(activeMakeMethodIds ?? []),
        ];

        const [methodMaterials] = await Promise.all([
          client
            .from("methodMaterial")
            .select("*")
            .in("materialMakeMethodId", relatedMakeMethodIds)
            .eq("companyId", companyId),
        ]);

        if (methodMaterials.error)
          throw new Error(methodMaterials.error.message);

        await db.transaction().execute(async (trx) => {
          if (activeMakeMethodIds.length > 0) {
            await trx
              .updateTable("makeMethod")
              .set({ status: "Archived" })
              .where("id", "in", activeMakeMethodIds)
              .execute();
          }

          await trx
            .updateTable("makeMethod")
            .set({ status: "Active" })
            .where("id", "=", makeMethodId)
            .execute();

          if (relatedMakeMethodIds.length > 0) {
            await trx
              .updateTable("methodMaterial")
              .set({ materialMakeMethodId: makeMethodId })
              .where("materialMakeMethodId", "in", relatedMakeMethodIds)
              .execute();
          }
        });

        break;
      }
      case "purchaseOrderToPurchaseInvoice": {
        const purchaseOrderId = id;
        const [
          purchaseOrder,
          purchaseOrderLines,
          purchaseOrderPayment,
          purchaseOrderDelivery,
        ] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", purchaseOrderId),
          client
            .from("purchaseOrderPayment")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderDelivery")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
        ]);

        if (!purchaseOrder.data) throw new Error("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);
        if (!purchaseOrderPayment.data)
          throw new Error("Purchase order payment not found");
        if (!purchaseOrderDelivery.data)
          throw new Error("Purchase order delivery not found");

        const uninvoicedLines = purchaseOrderLines?.data?.reduce<
          (typeof purchaseOrderLines)["data"]
        >((acc, line) => {
          if (line?.quantityToInvoice && line.quantityToInvoice > 0) {
            acc.push(line);
          }

          return acc;
        }, []);

        const uninvoicedSubtotal = uninvoicedLines?.reduce((acc, line) => {
          if (
            line?.quantityToInvoice &&
            line.unitPrice &&
            line.quantityToInvoice > 0
          ) {
            acc += line.quantityToInvoice * line.unitPrice;
          }

          return acc;
        }, 0);

        let purchaseInvoiceId = "";

        await db.transaction().execute(async (trx) => {
          purchaseInvoiceId = await getNextSequence(
            trx,
            "purchaseInvoice",
            companyId
          );

          const purchaseInvoice = await trx
            .insertInto("purchaseInvoice")
            .values({
              invoiceId: purchaseInvoiceId!,
              status: "Draft",
              supplierId: purchaseOrder.data.supplierId,
              supplierReference: purchaseOrder.data.supplierReference ?? "",
              invoiceSupplierId: purchaseOrderPayment.data.invoiceSupplierId,
              invoiceSupplierContactId:
                purchaseOrderPayment.data.invoiceSupplierContactId,
              invoiceSupplierLocationId:
                purchaseOrderPayment.data.invoiceSupplierLocationId,
              locationId: purchaseOrderDelivery.data.locationId,
              paymentTermId: purchaseOrderPayment.data.paymentTermId,
              currencyCode: purchaseOrder.data.currencyCode ?? "USD",
              dateIssued: new Date().toISOString().split("T")[0],
              exchangeRate: purchaseOrder.data.exchangeRate ?? 1,
              subtotal: uninvoicedSubtotal ?? 0,
              supplierInteractionId: purchaseOrder.data.supplierInteractionId,
              totalDiscount: 0,
              totalAmount: uninvoicedSubtotal ?? 0,
              totalTax: 0,
              balance: uninvoicedSubtotal ?? 0,
              companyId,
              createdBy: userId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!purchaseInvoice.id)
            throw new Error("Purchase invoice not created");
          purchaseInvoiceId = purchaseInvoice.id;

          await trx
            .insertInto("purchaseInvoiceDelivery")
            .values({
              id: purchaseInvoiceId,
              locationId: purchaseOrderDelivery.data.locationId,
              supplierShippingCost:
                purchaseOrderDelivery.data.supplierShippingCost ?? 0,
              shippingMethodId: purchaseOrderDelivery.data.shippingMethodId,
              shippingTermId: purchaseOrderDelivery.data.shippingTermId,
              companyId,
              updatedBy: userId,
            })
            .execute();

          const purchaseInvoiceLines = uninvoicedLines?.reduce<
            Database["public"]["Tables"]["purchaseInvoiceLine"]["Insert"][]
          >((acc, line) => {
            if (
              line?.quantityToInvoice &&
              line.quantityToInvoice > 0 &&
              !line.invoicedComplete
            ) {
              acc.push({
                invoiceId: purchaseInvoiceId,
                invoiceLineType: line.purchaseOrderLineType,
                purchaseOrderId: line.purchaseOrderId,
                purchaseOrderLineId: line.id,
                itemId: line.itemId,
                locationId: line.locationId,
                shelfId: line.shelfId,
                accountNumber: line.accountNumber,
                assetId: line.assetId,
                description: line.description,
                quantity: line.quantityToInvoice,
                supplierUnitPrice: line.supplierUnitPrice ?? 0,
                supplierShippingCost: line.supplierShippingCost ?? 0,
                supplierTaxAmount: line.supplierTaxAmount ?? 0,
                purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
                inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
                conversionFactor: line.conversionFactor,
                exchangeRate: line.exchangeRate ?? 1,
                jobOperationId: line.jobOperationId,
                companyId,
                createdBy: userId,
              });
            }
            return acc;
          }, []);

          await trx
            .insertInto("purchaseInvoiceLine")
            .values(purchaseInvoiceLines)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: purchaseInvoiceId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      }
      case "quoteToSalesOrder": {
        const {
          selectedLines,
          purchaseOrderNumber,
          digitalQuoteAcceptedBy,
          digitalQuoteAcceptedByEmail,
        } = payload;
        const [quote, quoteLines, quotePayment, quoteShipping, company] =
          await Promise.all([
            client.from("quote").select("*").eq("id", id).single(),
            client.from("quoteLine").select("*").eq("quoteId", id),
            client.from("quotePayment").select("*").eq("id", id).single(),
            client.from("quoteShipment").select("*").eq("id", id).single(),
            client.from("company").select("*").eq("id", companyId).single(),
          ]);

        if (quote.error) throw new Error(`Quote with id ${id} not found`);
        if (quoteLines.error)
          throw new Error(`Quote Lines with id ${id} not found`);
        if (quotePayment.error)
          throw new Error(`Quote payment with id ${id} not found`);
        if (quoteShipping.error)
          throw new Error(`Quote shipping with id ${id} not found`);

        let insertedSalesOrderId = "";
        await db.transaction().execute(async (trx) => {
          const today = format(new Date(), "yyyy-MM-dd");
          const salesOrderId = await getNextSequence(
            trx,
            "salesOrder",
            companyId
          );

          // Check if any selected lines have quantity 0
          const hasZeroQuantityLines = quoteLines.data.some(
            (line) =>
              line.id &&
              selectedLines &&
              line.id in selectedLines &&
              selectedLines[line.id].quantity === 0
          );

          const originatedFromDigitalQuote =
            digitalQuoteAcceptedBy && digitalQuoteAcceptedByEmail;
          const salesOrderStatus = originatedFromDigitalQuote
            ? "Needs Approval"
            : "To Ship and Invoice";

          const salesOrder = await trx
            .insertInto("salesOrder")
            .values([
              {
                salesOrderId,
                revisionId: 0,
                orderDate: today,
                customerId: quote.data.customerId,
                customerContactId: quote.data.customerContactId,
                customerEngineeringContactId:
                  quote.data.customerEngineeringContactId,
                customerLocationId: quote.data.customerLocationId,
                customerReference: purchaseOrderNumber ?? "",
                locationId: quote.data.locationId,
                salesPersonId: quote.data.salesPersonId ?? userId,
                status: salesOrderStatus,
                createdBy: userId,
                companyId: companyId,
                currencyCode:
                  quote.data.currencyCode ??
                  company.data?.baseCurrencyCode ??
                  "USD",
                externalNotes: quote.data.externalNotes,
                internalNotes: quote.data.internalNotes,
                exchangeRate: quote.data.exchangeRate ?? 1,
                exchangeRateUpdatedAt:
                  quote.data.exchangeRateUpdatedAt ?? new Date().toISOString(),
                completedDate: originatedFromDigitalQuote
                  ? new Date().toISOString()
                  : null,
                opportunityId: quote.data.opportunityId,
              },
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!salesOrder.id) {
            throw new Error("sales order is not created");
          }
          insertedSalesOrderId = salesOrder.id;

          // Copy quotePayment data to salesOrderPayment
          await trx
            .insertInto("salesOrderPayment")
            .values({
              ...quotePayment.data,
              id: insertedSalesOrderId,
            })
            .execute();

          // Copy quoteShipment data to salesOrderShipment
          await trx
            .insertInto("salesOrderShipment")
            .values({
              ...quoteShipping.data,
              id: insertedSalesOrderId,
            })
            .execute();

          const salesOrderLineInserts: Database["public"]["Tables"]["salesOrderLine"]["Insert"][] =
            quoteLines.data
              .filter(
                (line) =>
                  line.id &&
                  selectedLines &&
                  line.id in selectedLines &&
                  selectedLines[line.id].quantity > 0
              )
              .map((line) => {
                return {
                  id: line.id,
                  salesOrderId: insertedSalesOrderId,
                  salesOrderLineType: line.itemType as "Part",
                  addOnCost: selectedLines![line.id!].addOn,
                  description: line.description,
                  itemId: line.itemId,
                  locationId: line.locationId ?? quote.data.locationId,
                  methodType: line.methodType,
                  internalNotes: line.internalNotes,
                  externalNotes: line.externalNotes,
                  saleQuantity: selectedLines![line.id!].quantity,
                  status: "Ordered",
                  unitOfMeasureCode: line.unitOfMeasureCode,
                  unitPrice: selectedLines![line.id!].netUnitPrice,
                  promisedDate: format(
                    new Date(
                      Date.now() +
                        selectedLines![line.id!].leadTime * 24 * 60 * 60 * 1000
                    ),
                    "yyyy-MM-dd"
                  ),
                  createdBy: userId,
                  companyId,
                  exchangeRate: quote.data.exchangeRate ?? 1,
                  taxPercent: line.taxPercent,
                  shippingCost: selectedLines![line.id!].shippingCost,
                };
              });

          if (salesOrderLineInserts.length > 0) {
            await trx
              .insertInto("salesOrderLine")
              .values(salesOrderLineInserts)
              .execute();

            await trx
              .updateTable("item")
              .set({ active: true })
              .where(
                "id",
                "in",
                salesOrderLineInserts.map((insert) => insert.itemId)
              )
              .execute();
          }

          const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
            ? "Partial"
            : "Ordered";
          await trx
            .updateTable("quote")
            .set({
              status: newQuoteStatus,
              digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
              digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null,
            })
            .where("id", "=", quote.data.id)
            .execute();

          const customerPartToItemInserts = quoteLines.data
            .map((line) => ({
              companyId,
              customerId: quote.data?.customerId!,
              customerPartId: line.customerPartId!,
              customerPartRevision: line.customerPartRevision ?? "",
              itemId: line.itemId!,
            }))
            .filter((line) => !!line.itemId && !!line.customerPartId);
          if (customerPartToItemInserts.length > 0) {
            await trx
              .insertInto("customerPartToItem")
              .values(customerPartToItemInserts)
              .onConflict((oc) =>
                oc.columns(["customerId", "itemId"]).doUpdateSet((eb) => ({
                  customerPartId: eb.ref("excluded.customerPartId"),
                  customerPartRevision: eb.ref("excluded.customerPartRevision"),
                }))
              )
              .execute();
          }

          const updatedItemModels = quoteLines.data
            .filter((line) => !!line.modelUploadId && !!line.itemId)
            .map((line) => ({
              id: line.itemId!,
              modelUploadId: line.modelUploadId!,
            }));

          if (updatedItemModels.length > 0) {
            for await (const update of updatedItemModels) {
              await trx
                .updateTable("item")
                .set(update)
                .where("id", "=", update.id)
                .execute();
            }
          }
        });

        if (!insertedSalesOrderId) {
          throw new Error("Failed to insert sales order");
        }

        convertedId = insertedSalesOrderId;
        break;
      }
      case "salesOrderToSalesInvoice": {
        const salesOrderId = id;
        const [
          salesOrder,
          salesOrderLines,
          salesOrderPayment,
          salesOrderShipment,
        ] = await Promise.all([
          client.from("salesOrder").select("*").eq("id", salesOrderId).single(),
          client
            .from("salesOrderLine")
            .select("*")
            .eq("salesOrderId", salesOrderId),
          client
            .from("salesOrderPayment")
            .select("*")
            .eq("id", salesOrderId)
            .single(),
          client
            .from("salesOrderShipment")
            .select("*")
            .eq("id", salesOrderId)
            .single(),
        ]);

        if (!salesOrder.data) throw new Error("Purchase order not found");
        if (salesOrderLines.error)
          throw new Error(salesOrderLines.error.message);
        if (!salesOrderPayment.data)
          throw new Error("Purchase order payment not found");
        if (!salesOrderShipment.data)
          throw new Error("Purchase order delivery not found");

        const uninvoicedLines = salesOrderLines?.data?.reduce<
          (typeof salesOrderLines)["data"]
        >((acc, line) => {
          if (line?.quantityToInvoice && line.quantityToInvoice > 0) {
            acc.push(line);
          }

          return acc;
        }, []);

        const uninvoicedSubtotal = uninvoicedLines?.reduce((acc, line) => {
          if (
            line?.quantityToInvoice &&
            line.unitPrice &&
            line.quantityToInvoice > 0
          ) {
            acc += line.quantityToInvoice * line.unitPrice;
          }

          return acc;
        }, 0);

        let salesInvoiceId = "";

        await db.transaction().execute(async (trx) => {
          salesInvoiceId = await getNextSequence(
            trx,
            "salesInvoice",
            companyId
          );

          const salesInvoice = await trx
            .insertInto("salesInvoice")
            .values({
              invoiceId: salesInvoiceId!,
              status: "Draft",
              customerId: salesOrder.data.customerId,
              customerReference: salesOrder.data.customerReference ?? "",
              invoiceCustomerId: salesOrderPayment.data.invoiceCustomerId,
              invoiceCustomerContactId:
                salesOrderPayment.data.invoiceCustomerContactId,
              invoiceCustomerLocationId:
                salesOrderPayment.data.invoiceCustomerLocationId,
              locationId: salesOrderShipment.data.locationId,
              paymentTermId: salesOrderPayment.data.paymentTermId,
              currencyCode: salesOrder.data.currencyCode ?? "USD",
              dateIssued: new Date().toISOString().split("T")[0],
              exchangeRate: salesOrder.data.exchangeRate ?? 1,
              subtotal: uninvoicedSubtotal ?? 0,
              opportunityId: salesOrder.data.opportunityId,
              totalDiscount: 0,
              totalAmount: uninvoicedSubtotal ?? 0,
              totalTax: 0,
              balance: uninvoicedSubtotal ?? 0,
              companyId,
              createdBy: userId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!salesInvoice.id) throw new Error("Purchase invoice not created");
          salesInvoiceId = salesInvoice.id;

          await trx
            .insertInto("salesInvoiceShipment")
            .values({
              id: salesInvoiceId,
              locationId: salesOrderShipment.data.locationId,
              shippingCost: salesOrderShipment.data.shippingCost ?? 0,
              shippingMethodId: salesOrderShipment.data.shippingMethodId,
              shippingTermId: salesOrderShipment.data.shippingTermId,
              companyId,
              createdBy: userId,
            })
            .execute();

          const salesInvoiceLines = uninvoicedLines?.reduce<
            Database["public"]["Tables"]["salesInvoiceLine"]["Insert"][]
          >((acc, line) => {
            if (
              line?.quantityToInvoice &&
              line.quantityToInvoice > 0 &&
              !line.invoicedComplete
            ) {
              acc.push({
                invoiceId: salesInvoiceId,
                invoiceLineType: line.salesOrderLineType,
                salesOrderId: line.salesOrderId,
                salesOrderLineId: line.id,
                methodType: line.methodType,
                itemId: line.itemId,
                locationId: line.locationId,
                shelfId: line.shelfId,
                accountNumber: line.accountNumber,
                assetId: line.assetId,
                description: line.description,
                quantity: line.quantityToInvoice,
                unitPrice: line.unitPrice ?? 0,
                addOnCost: line.addOnCost ?? 0,
                shippingCost: line.shippingCost ?? 0,
                taxPercent: line.taxPercent ?? 0,
                unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
                exchangeRate: line.exchangeRate ?? 1,
                companyId,
                createdBy: userId,
              });
            }
            return acc;
          }, []);

          await trx
            .insertInto("salesInvoiceLine")
            .values(salesInvoiceLines)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: salesInvoiceId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      }
      case "salesRfqToQuote": {
        const [salesRfq, salesRfqLines] = await Promise.all([
          client.from("salesRfq").select("*").eq("id", id).single(),
          client.from("salesRfqLines").select("*").eq("salesRfqId", id),
        ]);

        if (salesRfq.error)
          throw new Error(`Sales RFQ with id ${id} not found`);
        if (salesRfq.data?.status !== "Ready for Quote")
          throw new Error(
            `Sales RFQ with id ${id} is not in Ready for Quote status`
          );

        if (salesRfqLines.error) {
          throw new Error(`Sales RFQ Lines with id ${id} not found`);
        }

        // Create Item records for each line that does not yet have one assigned
        const linesToCreateItems = salesRfqLines.data.filter(
          (line) => !line.itemId
        );

        const readableIdToLineIdMapping = new Map<string, string>();
        let itemInserts: Database["public"]["Tables"]["item"]["Insert"][] = [];
        if (linesToCreateItems.length > 0) {
          itemInserts = await Promise.all(
            linesToCreateItems.map(async (line) => {
              let revisionId = line.customerPartRevision ?? "0";
              let readableId = line.customerPartId ?? "";
              let suffix = 1;

              // Check for uniqueness and append a suffix if necessary
              while (true) {
                const { data, error } = await client
                  .from("item")
                  .select("id")
                  .eq("readableId", readableId)
                  .eq("revision", revisionId)
                  .eq("companyId", companyId)
                  .single();

                if (
                  // If multiple line items in the RFQ have the same customer part number and revision,
                  // make sure they get assiged different readableIds
                  !readableIdToLineIdMapping.has(readableId) &&
                  (error || !data)
                ) {
                  // readableId is unique, we can use it
                  break;
                }

                // If not unique, append or increment suffix
                revisionId = `${revisionId} (${suffix})`;
                suffix++;
              }

              readableIdToLineIdMapping.set(readableId, line.id!);
              return {
                readableId,
                revision: revisionId,
                type: "Part" as const,
                active: false,
                name: line.description ?? line.itemName ?? "",
                description: "",
                itemTrackingType: "Inventory" as const,
                replenishmentSystem: "Make" as const,
                defaultMethodType: "Make" as const,
                unitOfMeasureCode: "EA",
                companyId: companyId,
                createdBy: userId,
              };
            })
          );
        }

        if (!salesRfq.data.customerId) {
          throw new Error(`Sales RFQ with id ${id} has no customerId`);
        }

        // Handle customer payment terms, shipping, currency codes, etc.
        const [customerPayment, customerShipping, customer, company] =
          await Promise.all([
            client
              .from("customerPayment")
              .select("*")
              .eq("customerId", salesRfq.data.customerId)
              .single(),
            client
              .from("customerShipping")
              .select("*")
              .eq("customerId", salesRfq.data.customerId)
              .single(),
            client
              .from("customer")
              .select("*")
              .eq("id", salesRfq.data.customerId)
              .single(),
            client.from("company").select("*").eq("id", companyId).single(),
          ]);

        if (customerPayment.error) throw customerPayment.error;
        if (customerShipping.error) throw customerShipping.error;
        if (customer.error) throw customer.error;
        if (company.error) throw company.error;

        const currencyCode =
          customer.data?.currencyCode ??
          company.data?.baseCurrencyCode ??
          "USD";
        const currency = await client
          .from("currency")
          .select("*")
          .eq("code", currencyCode)
          .eq("companyId", companyId)
          .single();
        const exchangeRate = currency.data?.exchangeRate ?? 1;

        const {
          paymentTermId,
          invoiceCustomerId,
          invoiceCustomerContactId,
          invoiceCustomerLocationId,
        } = customerPayment.data;

        const { shippingMethodId, shippingTermId } = customerShipping.data;

        let insertedQuoteId = "";
        let insertedQuoteLines: {
          id?: string;
          itemId?: string;
          methodType?: "Buy" | "Make" | "Pick";
        }[] = [];

        await db.transaction().execute(async (trx) => {
          // Create the items for any salesRfqLines that do not yet have an itemId
          if (itemInserts.length > 0) {
            const itemIds = await trx
              .insertInto("item")
              .values(itemInserts)
              .returning(["id", "readableId", "revision"])
              .execute();

            const partInserts: Database["public"]["Tables"]["part"]["Insert"][] =
              itemIds.map((item) => ({
                id: item.readableId!,
                companyId,
                createdBy: userId,
              }));
            await trx
              .insertInto("part")
              .values(partInserts)
              .onConflict((oc) =>
                oc.columns(["id", "companyId"]).doUpdateSet({
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                })
              )
              .execute();

            const salesRfqLineUpdates: Database["public"]["Tables"]["salesRfqLine"]["Update"][] =
              itemIds.map((item) => ({
                itemId: item.id!,
                id: readableIdToLineIdMapping.get(item.readableId!)!,
              }));
            for await (const update of salesRfqLineUpdates) {
              await trx
                .updateTable("salesRfqLine")
                .set({ itemId: update.itemId })
                .where("id", "=", update.id)
                .execute();
            }
          }

          // Create the quote
          const quoteId = await getNextSequence(trx, "quote", companyId);
          const externalLinkId = await trx
            .insertInto("externalLink")
            .values({
              documentId: quoteId,
              documentType: "Quote",
              companyId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!salesRfq.data.customerId) {
            throw new Error(`Sales RFQ with id ${id} has no customerId`);
          }

          const quote = await trx
            .insertInto("quote")
            .values([
              {
                quoteId,
                customerId: salesRfq.data?.customerId,
                customerContactId: salesRfq.data?.customerContactId,
                customerEngineeringContactId:
                  salesRfq.data?.customerEngineeringContactId,
                customerLocationId: salesRfq.data?.customerLocationId,
                customerReference: salesRfq.data?.customerReference,
                locationId: salesRfq.data?.locationId,
                expirationDate: toCalendarDate(
                  now(getLocalTimeZone()).add({ days: 30 })
                ).toString(),
                salesPersonId: salesRfq.data?.salesPersonId ?? userId,
                status: "Draft",
                externalNotes: salesRfq.data?.externalNotes,
                internalNotes: salesRfq.data?.internalNotes,
                companyId,
                createdBy: userId,
                currencyCode,
                exchangeRate,
                exchangeRateUpdatedAt: new Date().toISOString(),
                externalLinkId: externalLinkId.id,
                opportunityId: salesRfq.data.opportunityId,
              },
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!quote.id) {
            throw new Error("Failed to insert quote");
          }

          // Insert quotePayment
          await trx
            .insertInto("quotePayment")
            .values({
              id: quote.id,
              invoiceCustomerId: invoiceCustomerId,
              invoiceCustomerContactId: invoiceCustomerContactId,
              invoiceCustomerLocationId: invoiceCustomerLocationId,
              paymentTermId: paymentTermId,
              companyId,
            })
            .execute();

          // Insert quoteShipment
          await trx
            .insertInto("quoteShipment")
            .values({
              id: quote.id,
              locationId: salesRfq.data?.locationId,
              shippingMethodId: shippingMethodId,
              shippingTermId: shippingTermId,
              companyId,
            })
            .execute();

          const salesRfqLinesWithItemIds = await trx
            .selectFrom("salesRfqLines")
            .selectAll()
            .where("salesRfqId", "=", id)
            .execute();

          const quoteLineInserts: Database["public"]["Tables"]["quoteLine"]["Insert"][] =
            salesRfqLinesWithItemIds.map((line) => ({
              id: line.id ?? undefined,
              quoteId: quote.id!,
              itemId: line.itemId!,
              customerPartId: line.customerPartId,
              customerPartRevision: line.customerPartRevision,
              description: line.description ?? line.itemName ?? "",
              itemType: line.itemType!,
              locationId: salesRfq.data?.locationId,
              methodType: line.methodType!,
              modelUploadId: line.modelUploadId,
              internalNotes: line.internalNotes,
              externalNotes: line.externalNotes,
              quantity: line.quantity,
              status: "Not Started",
              unitOfMeasureCode: line.unitOfMeasureCode,
              companyId,
              createdBy: userId,
            }));

          if (quoteLineInserts.length > 0) {
            insertedQuoteLines = await trx
              .insertInto("quoteLine")
              .values(quoteLineInserts)
              .returning(["id", "itemId", "methodType"])
              .execute();
          }

          // update salesRfq status
          await trx
            .updateTable("salesRfq")
            .set({ status: "Ready for Quote" })
            .where("id", "=", id)
            .execute();

          const customerPartToItemInserts = salesRfqLinesWithItemIds
            .map((line) => ({
              companyId,
              customerId: salesRfq.data?.customerId!,
              customerPartId: line.customerPartId!,
              customerPartRevision: line.customerPartRevision ?? "",
              itemId: line.itemId!,
            }))
            .filter((line) => !!line.itemId && !!line.customerPartId);
          if (customerPartToItemInserts.length > 0) {
            await trx
              .insertInto("customerPartToItem")
              .values(customerPartToItemInserts)
              .onConflict((oc) =>
                oc.columns(["customerId", "itemId"]).doUpdateSet((eb) => ({
                  customerPartId: eb.ref("excluded.customerPartId"),
                  customerPartRevision: eb.ref("excluded.customerPartRevision"),
                }))
              )
              .execute();
          }

          await trx
            .updateTable("salesRfq")
            .set({
              status: "Quoted",
            })
            .where("id", "=", id)
            .execute();

          const updatedItemModels = salesRfqLinesWithItemIds
            .filter((line) => !!line.modelUploadId && !!line.itemId)
            .map((line) => ({
              id: line.itemId!,
              modelUploadId: line.modelUploadId!,
            }));

          if (updatedItemModels.length > 0) {
            for await (const update of updatedItemModels) {
              await trx
                .updateTable("item")
                .set(update)
                .where("id", "=", update.id)
                .execute();
            }
          }

          insertedQuoteId = quote.id!;
          convertedId = insertedQuoteId;
        });

        // get method for each make line
        await Promise.all(
          insertedQuoteLines
            .filter((line) => line.methodType === "Make")
            .map((line) =>
              client.functions.invoke("get-method", {
                body: {
                  type: "itemToQuoteLine",
                  sourceId: line.itemId,
                  targetId: `${insertedQuoteId}:${line.id}`,
                  companyId: companyId,
                  userId: userId,
                },
              })
            )
        );
        break;
      }
      case "shipmentToSalesInvoice": {
        const shipmentId = id;
        const [shipment, shipmentLines] = await Promise.all([
          client.from("shipment").select("*").eq("id", shipmentId).single(),
          client.from("shipmentLine").select("*").eq("shipmentId", shipmentId),
        ]);

        if (shipmentLines.error) throw shipmentLines.error;

        // Accumulate quantities for each sales order line
        const quantitiesByLine = shipmentLines.data.reduce<
          Record<string, number>
        >((acc, line) => {
          const lineId = line.lineId!;
          acc[lineId] = (acc[lineId] || 0) + line.shippedQuantity;
          return acc;
        }, {});

        const salesOrderLineIds = Object.keys(quantitiesByLine);

        if (
          !shipment.data?.sourceDocumentId ||
          shipment.data?.sourceDocument !== "Sales Order"
        ) {
          throw new Error("Shipment has no source document id");
        }

        const [
          salesOrder,
          salesOrderLines,
          salesOrderPayment,
          salesOrderShipment,
        ] = await Promise.all([
          client
            .from("salesOrder")
            .select("*")
            .eq("id", shipment.data?.sourceDocumentId)
            .single(),
          client.from("salesOrderLine").select("*").in("id", salesOrderLineIds),
          client
            .from("salesOrderPayment")
            .select("*")
            .eq("id", shipment.data?.sourceDocumentId)
            .single(),
          client
            .from("salesOrderShipment")
            .select("*")
            .eq("id", shipment.data?.sourceDocumentId)
            .single(),
        ]);

        if (!salesOrder.data) throw new Error("Purchase order not found");
        if (salesOrderLines.error)
          throw new Error(salesOrderLines.error.message);
        if (!salesOrderPayment.data)
          throw new Error("Purchase order payment not found");
        if (!salesOrderShipment.data)
          throw new Error("Purchase order delivery not found");

        const uninvoicedLines = salesOrderLines?.data?.reduce<
          (typeof salesOrderLines)["data"]
        >((acc, line) => {
          if (line.id in quantitiesByLine) {
            // Deduct any previously invoiced quantity
            const remainingQuantity =
              quantitiesByLine[line.id] - (line.quantityInvoiced ?? 0);

            if (remainingQuantity > 0) {
              acc.push({
                ...line,
                quantityToInvoice: remainingQuantity,
              });
            }
          }

          return acc;
        }, []);

        const uninvoicedSubtotal = uninvoicedLines?.reduce((acc, line) => {
          if (
            line?.quantityToInvoice &&
            line.unitPrice &&
            line.quantityToInvoice > 0
          ) {
            acc += line.quantityToInvoice * line.unitPrice;
          }

          return acc;
        }, 0);

        let salesInvoiceId = "";

        await db.transaction().execute(async (trx) => {
          salesInvoiceId = await getNextSequence(
            trx,
            "salesInvoice",
            companyId
          );

          const salesInvoice = await trx
            .insertInto("salesInvoice")
            .values({
              invoiceId: salesInvoiceId!,
              status: "Draft",
              customerId: salesOrder.data.customerId,
              customerReference: salesOrder.data.customerReference ?? "",
              invoiceCustomerId: salesOrderPayment.data.invoiceCustomerId,
              invoiceCustomerContactId:
                salesOrderPayment.data.invoiceCustomerContactId,
              invoiceCustomerLocationId:
                salesOrderPayment.data.invoiceCustomerLocationId,
              locationId: salesOrderShipment.data.locationId,
              paymentTermId: salesOrderPayment.data.paymentTermId,
              currencyCode: salesOrder.data.currencyCode ?? "USD",
              dateIssued: new Date().toISOString().split("T")[0],
              exchangeRate: salesOrder.data.exchangeRate ?? 1,
              subtotal: uninvoicedSubtotal ?? 0,
              opportunityId: salesOrder.data.opportunityId,
              shipmentId: shipmentId,
              totalDiscount: 0,
              totalAmount: uninvoicedSubtotal ?? 0,
              totalTax: 0,
              balance: uninvoicedSubtotal ?? 0,
              companyId,
              createdBy: userId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!salesInvoice.id) throw new Error("Purchase invoice not created");
          salesInvoiceId = salesInvoice.id;

          await trx
            .insertInto("salesInvoiceShipment")
            .values({
              id: salesInvoiceId,
              locationId: salesOrderShipment.data.locationId,
              shippingCost: salesOrderShipment.data.shippingCost ?? 0,
              shippingMethodId: salesOrderShipment.data.shippingMethodId,
              shippingTermId: salesOrderShipment.data.shippingTermId,
              companyId,
              createdBy: userId,
            })
            .execute();

          const salesInvoiceLines = uninvoicedLines?.reduce<
            Database["public"]["Tables"]["salesInvoiceLine"]["Insert"][]
          >((acc, line) => {
            if (
              line?.quantityToInvoice &&
              line.quantityToInvoice > 0 &&
              !line.invoicedComplete
            ) {
              acc.push({
                invoiceId: salesInvoiceId,
                invoiceLineType: line.salesOrderLineType,
                salesOrderId: line.salesOrderId,
                salesOrderLineId: line.id,
                methodType: line.methodType,
                itemId: line.itemId,
                locationId: line.locationId,
                shelfId: line.shelfId,
                accountNumber: line.accountNumber,
                assetId: line.assetId,
                description: line.description,
                quantity: line.quantityToInvoice,
                unitPrice: line.unitPrice ?? 0,
                addOnCost: line.addOnCost ?? 0,
                shippingCost: line.shippingCost ?? 0,
                taxPercent: line.taxPercent ?? 0,
                unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
                exchangeRate: line.exchangeRate ?? 1,
                companyId,
                createdBy: userId,
              });
            }
            return acc;
          }, []);

          if (salesInvoiceLines.length > 0) {
            await trx
              .insertInto("salesInvoiceLine")
              .values(salesInvoiceLines)
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: salesInvoiceId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      }
      case "supplierQuoteToPurchaseOrder": {
        const { selectedLines } = payload;

        const [quote, quoteLines, company, employeeJob] = await Promise.all([
          client.from("supplierQuote").select("*").eq("id", id).single(),
          client
            .from("supplierQuoteLine")
            .select("*, item(type)")
            .eq("supplierQuoteId", id),
          client.from("company").select("*").eq("id", companyId).single(),
          client
            .from("employeeJob")
            .select("*")
            .eq("id", userId)
            .eq("companyId", companyId)
            .single(),
        ]);

        if (quote.error) throw new Error(`Quote with id ${id} not found`);
        if (quoteLines.error)
          throw new Error(`Quote Lines with id ${id} not found`);

        const [supplierPayment, supplierShipping, supplier, pickMethods] =
          await Promise.all([
            client
              .from("supplierPayment")
              .select("*")
              .eq("supplierId", quote.data.supplierId)
              .single(),
            client
              .from("supplierShipping")
              .select("*")
              .eq("supplierId", quote.data.supplierId)
              .single(),
            client
              .from("supplier")
              .select("*")
              .eq("id", quote.data.supplierId)
              .single(),

            client
              .from("pickMethod")
              .select("*")
              .in(
                "itemId",
                quoteLines.data.map((line) => line.itemId)
              )
              .eq("locationId", employeeJob.data?.locationId ?? ""),
          ]);

        if (supplierPayment.error) throw supplierPayment.error;
        if (supplierShipping.error) throw supplierShipping.error;
        if (supplier.error) throw supplier.error;

        let insertedPurchaseOrderId = "";
        await db.transaction().execute(async (trx) => {
          const purchaseOrderId = await getNextSequence(
            trx,
            "purchaseOrder",
            companyId
          );

          const purchaseOrder = await trx
            .insertInto("purchaseOrder")
            .values([
              {
                purchaseOrderId,
                supplierId: quote.data.supplierId,
                supplierContactId: quote.data.supplierContactId,
                supplierLocationId: quote.data.supplierLocationId,
                supplierReference: quote.data.supplierReference,
                supplierInteractionId: quote.data.supplierInteractionId,
                createdBy: userId,
                companyId: companyId,
                currencyCode:
                  quote.data.currencyCode ??
                  supplier.data?.currencyCode ??
                  company.data?.baseCurrencyCode ??
                  "USD",
                exchangeRate: quote.data.exchangeRate ?? 1,
                exchangeRateUpdatedAt:
                  quote.data.exchangeRateUpdatedAt ?? new Date().toISOString(),
              },
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!purchaseOrder.id) {
            throw new Error("purchase order is not created");
          }
          insertedPurchaseOrderId = purchaseOrder.id;

          await Promise.all([
            trx
              .insertInto("purchaseOrderPayment")
              .values({
                id: insertedPurchaseOrderId,
                invoiceSupplierId: supplierPayment.data.invoiceSupplierId,
                invoiceSupplierContactId:
                  supplierPayment.data.invoiceSupplierContactId,
                invoiceSupplierLocationId:
                  supplierPayment.data.invoiceSupplierLocationId,
                paymentTermId: supplierPayment.data.paymentTermId,
                companyId: companyId,
              })
              .execute(),
            trx
              .insertInto("purchaseOrderDelivery")
              .values({
                id: insertedPurchaseOrderId,
                locationId: employeeJob.data?.locationId,
                shippingMethodId: supplierShipping.data.shippingMethodId,
                shippingTermId: supplierShipping.data.shippingTermId,
                companyId: companyId,
              })
              .execute(),
          ]);

          const purchaseOrderLineInserts: Database["public"]["Tables"]["purchaseOrderLine"]["Insert"][] =
            quoteLines.data
              .filter(
                (line) =>
                  line.id &&
                  selectedLines &&
                  line.id in selectedLines &&
                  selectedLines[line.id].quantity > 0
              )
              .map((line) => {
                return {
                  purchaseOrderId: insertedPurchaseOrderId,
                  purchaseOrderLineType: line.item?.type as "Part",
                  description: line.description,
                  itemId: line.itemId,
                  locationId: employeeJob.data?.locationId,
                  shelfId:
                    pickMethods.data?.find(
                      (method) => method.itemId === line.itemId
                    )?.defaultShelfId ?? null,
                  exchangeRate: quote.data.exchangeRate ?? 1,
                  conversionFactor: line.conversionFactor,
                  internalNotes: line.internalNotes,
                  externalNotes: line.externalNotes,
                  purchaseQuantity: selectedLines![line.id!].quantity,
                  inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
                  purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
                  supplierUnitPrice: selectedLines![line.id!].supplierUnitPrice,
                  supplierShippingCost:
                    selectedLines![line.id!].supplierShippingCost,
                  supplierTaxAmount: selectedLines![line.id!].supplierTaxAmount,
                  createdBy: userId,
                  companyId,
                };
              });

          if (purchaseOrderLineInserts.length > 0) {
            await trx
              .insertInto("purchaseOrderLine")
              .values(purchaseOrderLineInserts)
              .execute();

            await trx
              .updateTable("item")
              .set({ active: true })
              .where(
                "id",
                "in",
                purchaseOrderLineInserts.map((insert) => insert.itemId)
              )
              .execute();
          }

          // Create a map to deduplicate supplier parts by itemId and supplierId
          const supplierPartMap = new Map();

          quoteLines.data
            .filter(
              (line) =>
                !!line.itemId &&
                line.id &&
                selectedLines &&
                line.id in selectedLines
            )
            .forEach((line) => {
              const key = `${line.itemId}-${quote.data.supplierId}`;
              supplierPartMap.set(key, {
                companyId,
                supplierId: quote.data?.supplierId!,
                supplierPartId: line.supplierPartId!,
                supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
                conversionFactor: line.conversionFactor,
                itemId: line.itemId!,
                createdBy: userId,
              });
            });

          const supplierPartToItemInserts = Array.from(
            supplierPartMap.values()
          );

          if (supplierPartToItemInserts.length > 0) {
            await trx
              .insertInto("supplierPart")
              .values(supplierPartToItemInserts)
              .onConflict((oc) =>
                oc
                  .columns(["itemId", "supplierId", "companyId"])
                  .doUpdateSet((eb) => ({
                    supplierPartId: eb.ref("excluded.supplierPartId"),
                  }))
              )
              .execute();
          }
        });

        if (!insertedPurchaseOrderId) {
          throw new Error("Failed to insert purchase order");
        }

        convertedId = insertedPurchaseOrderId;

        break;
      }

      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return new Response(
      JSON.stringify({
        convertedId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
