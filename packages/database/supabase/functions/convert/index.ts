import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["salesRfqToQuote"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const { type, id, companyId, userId } = payloadValidator.parse(payload);

    console.log({
      function: "convert",
      type,
      id,
      companyId,
      userId,
    });

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    switch (type) {
      case "salesRfqToQuote": {
        const [salesRfq, salesRfqLines] = await Promise.all([
          client.from("salesRfq").select("*").eq("id", id).single(),
          client.from("salesRfqLines").select("*").eq("salesRfqId", id),
        ]);

        if (salesRfq.error)
          throw new Error(`Sales RFQ with id ${id} not found`);
        if (salesRfq.data?.status !== "Draft")
          throw new Error(`Sales RFQ with id ${id} is not in Draft status`);

        if (salesRfqLines.error) {
          throw new Error(`Sales RFQ Lines with id ${id} not found`);
        }

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
                status: "Draft",
                companyId,
                createdBy: userId,
              },
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!quote.id) {
            throw new Error("Failed to insert quote");
          }

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
            .insertInto("salesRfqToQuote")
            .values([
              {
                salesRfqId: id,
                quoteId: quote.id!,
                companyId,
              },
            ])
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

          insertedQuoteId = quote.id!;
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
        success: true,
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
