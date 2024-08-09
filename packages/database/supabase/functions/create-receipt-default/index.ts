import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const { companyId, locationId, userId } = await req.json();

  console.log({
    function: "create-receipt-default",
    companyId,
    locationId,
    userId,
  });

  let receiptId;
  try {
    if (!userId) throw new Error("Payload is missing userId");
    if (!companyId) throw new Error("Payload is missing companyId");

    await db.transaction().execute(async (trx) => {
      receiptId = await getNextSequence(trx, "receipt", companyId);
      const newReceipt = await trx
        .insertInto("receipt")
        .values({
          receiptId,
          companyId: companyId,
          locationId: locationId,
          createdBy: userId,
        })
        .returning(["id", "receiptId"])
        .execute();

      receiptId = newReceipt?.[0]?.id;
      if (!receiptId) throw new Error("Failed to create receipt");
    });

    return new Response(
      JSON.stringify({
        id: receiptId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 201,
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
