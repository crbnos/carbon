import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

// const pool = getConnectionPool(1);
// const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { invoiceId, companyId } = await req.json();

  console.log({
    function: "update-sales-prices",
    invoiceId,
    companyId,
  });

  try {
    if (!invoiceId) throw new Error("Payload is missing invoiceId");

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key"),
      companyId
    );

    const [salesInvoice, salesInvoiceLines] = await Promise.all([
      client.from("salesInvoice").select("*").eq("id", invoiceId).single(),
      client.from("salesInvoiceLine").select("*").eq("invoiceId", invoiceId),
    ]);

    if (salesInvoice.error) throw new Error("Failed to fetch salesInvoice");
    if (salesInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");

    // const itemIds = salesInvoiceLines.data
    //   .filter((line) => Boolean(line.itemId))
    //   .map((line) => line.itemId);

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
