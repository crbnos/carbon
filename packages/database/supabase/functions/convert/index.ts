import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { format } from "https://deno.land/std@0.205.0/datetime/format.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z
  .object({
    type: z.enum(["salesRfqToQuote", "quoteToSalesOrder"]),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
    selectedLines: z
      .record(
        z.string(),
        z.object({
          quantity: z.number(),
          unitPrice: z.number(),
          addOn: z.number(),
          leadTime: z.number(),
        })
      )
      .optional(),
  })
  .refine((data) => {
    if (data.type === "quoteToSalesOrder") {
      return !!data.selectedLines && Object.keys(data.selectedLines).length > 0;
    }
    return true;
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  let convertedId = "";
  try {
    const { type, id, companyId, userId, selectedLines } =
      payloadValidator.parse(payload);

    console.log({
      function: "convert",
      type,
      id,
      companyId,
      userId,
    });

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    switch (type) {
      case "quoteToSalesOrder": {
        const [quote, quoteLines, quotePayment, quoteShipping] =
          await Promise.all([
            client.from("quote").select("*").eq("id", id).single(),
            client.from("quoteLine").select("*").eq("quoteId", id),
            client.from("quotePayment").select("*").eq("id", id).single(),
            client.from("quoteShipment").select("*").eq("id", id).single(),
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

          const salesOrder = await trx
            .insertInto("salesOrder")
            .values([
              {
                salesOrderId,
                revisionId: 0,
                orderDate: today,
                customerId: quote.data.customerId,
                customerContactId: quote.data.customerContactId,
                customerLocationId: quote.data.customerLocationId,
                customerReference: quote.data.customerReference,
                locationId: quote.data.locationId,
                status: "Draft",
                createdBy: userId,
                companyId: companyId,
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
                (line) => line.id && selectedLines && line.id in selectedLines
              )
              .map((line) => {
                return {
                  salesOrderId: insertedSalesOrderId,
                  salesOrderLineType: line.itemType as "Part",
                  status: "Ordered",
                  itemId: line.itemId,
                  itemReadableId: line.itemReadableId,
                  unitOfMeasureCode: line.unitOfMeasureCode,
                  locationId: quote.data.locationId,
                  saleQuantity: selectedLines![line.id!].quantity,
                  unitPrice: selectedLines![line.id!].unitPrice,
                  addOnCost: selectedLines![line.id!].addOn,
                  promisedDate: format(
                    new Date(
                      Date.now() +
                        selectedLines![line.id!].leadTime * 24 * 60 * 60 * 1000
                    ),
                    "yyyy-MM-dd"
                  ),
                  createdBy: userId,
                  companyId,
                };
              });

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

          const newQuoteStatus: "Ordered" | "Partial" =
            quoteLines.data.length === salesOrderLineInserts.length
              ? "Ordered"
              : "Partial";
          await trx
            .updateTable("quote")
            .set({ status: newQuoteStatus })
            .where("id", "=", quote.data.id)
            .execute();

          await trx
            .updateTable("opportunity")
            .set({
              salesOrderId: insertedSalesOrderId,
            })
            .where("quoteId", "=", quote.data.id)
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

        const [customerPayment, customerShipping, employee] = await Promise.all(
          [
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
              .from("employeeJob")
              .select("*")
              .eq("employeeId", userId)
              .eq("companyId", companyId),
          ]
        );

        if (customerPayment.error) throw customerPayment.error;
        if (customerShipping.error) throw customerShipping.error;

        const {
          currencyCode,
          paymentTermId,
          invoiceCustomerId,
          invoiceCustomerContactId,
          invoiceCustomerLocationId,
        } = customerPayment.data;

        const { shippingMethodId, shippingTermId } = customerShipping.data;

        const validLines = salesRfqLines.data?.filter(
          (line) =>
            line.itemId &&
            line.itemType &&
            line.methodType &&
            line.quantity &&
            line.unitOfMeasureCode
        );

        let insertedQuoteId = "";
        let insertedQuoteLines: {
          id?: string;
          itemId?: string;
          methodType?: "Buy" | "Make" | "Pick";
        }[] = [];

        await db.transaction().execute(async (trx) => {
          const quoteId = await getNextSequence(trx, "quote", companyId);
          const quote = await trx
            .insertInto("quote")
            .values([
              {
                quoteId,
                customerId: salesRfq.data?.customerId,
                customerContactId: salesRfq.data?.customerContactId,
                customerLocationId: salesRfq.data?.customerLocationId,
                customerReference: salesRfq.data?.customerReference,
                locationId: salesRfq.data?.locationId,
                expirationDate: salesRfq.data?.expirationDate,
                salesPersonId: salesRfq.data?.createdBy,
                status: "Draft",
                externalNotes: salesRfq.data?.externalNotes,
                internalNotes: salesRfq.data?.internalNotes,
                companyId,
                createdBy: userId,
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
              currencyCode: currencyCode ?? "USD",
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

          const quoteLineInserts: Database["public"]["Tables"]["quoteLine"]["Insert"][] =
            validLines.map((line) => ({
              quoteId: quote.id!,
              itemId: line.itemId!,
              itemReadableId: line.itemReadableId!,
              customerPartId: line.customerPartId,
              customerPartRevision: line.customerPartRevision,
              description: line.description ?? line.itemName ?? "",
              itemType: line.itemType!,
              methodType: line.methodType!,
              modelUploadId: line.modelUploadId,
              notes: line.internalNotes,
              quantity: line.quantity,
              status: "Draft",
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

          await trx
            .updateTable("opportunity")
            .set({
              quoteId: quote.id!,
            })
            .where("salesRfqId", "=", id)
            .execute();

          const customerPartToItemInserts = validLines
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

          const updatedItemModels = validLines
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
