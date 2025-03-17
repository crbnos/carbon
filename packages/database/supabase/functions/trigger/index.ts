import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";
import { tasks } from "npm:@trigger.dev/sdk@3.0.0/v3";
import type { notifyTask } from "../../../../../apps/erp/app/trigger/notify.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const recipientValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("group"),
    groupIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("users"),
    userIds: z.array(z.string()),
  }),
]);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    event: z.enum([
      "quote-assignment",
      "sales-rfq-assignment",
      "sales-order-assignment",
    ]),
    documentId: z.string(),
    companyId: z.string(),
    recipient: recipientValidator,
    from: z.string().optional(),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);
    const { type, ...data } = validatedPayload;

    console.log({
      function: "trigger",
      type,
      ...data,
    });

    // verify that the request is authorized by an API key or service role
    await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      data.companyId
    );

    switch (type) {
      case "notify": {
        await tasks.trigger<typeof notifyTask>("notify", {
          companyId: data.companyId,
          documentId: data.documentId,
          event: data.event,
          recipient: data.recipient,
          from: data.from ?? "system",
        });
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
