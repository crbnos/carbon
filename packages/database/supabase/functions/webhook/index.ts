import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import { corsHeaders } from "../lib/headers.ts";
import type { Database } from "../lib/types.ts";

const payloadValidator = z.object({
  webhookId: z.string(),
  type: z.enum(["INSERT", "UPDATE", "DELETE"]),
  record: z.any(),
  old: z.any().optional(),
  url: z.string(),
  companyId: z.string(),
  table: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  const { type, record, old, url, companyId, table, webhookId } =
    payloadValidator.parse(payload);

  const serviceRole = createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  try {
    console.log({
      function: "webhook",
      type,
      url,
      companyId,
      table,
    });

    // Send webhook request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        record,
        ...(old && { old }),
        companyId,
        table,
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status ${response.status}`);
    }

    await serviceRole.rpc("increment_webhook_success", {
      webhook_id: webhookId,
    });

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
    if (webhookId) {
      await serviceRole.rpc("increment_webhook_error", {
        webhook_id: webhookId,
      });
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
