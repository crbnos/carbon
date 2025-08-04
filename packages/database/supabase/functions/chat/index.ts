import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { createAnthropic } from "npm:@ai-sdk/anthropic@1.2.12";
import { APICallError, LanguageModelV1CallOptions } from "npm:ai@4.3.19";
import { z } from "npm:zod";
import { corsHeaders } from "../lib/headers.ts";

import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { getAuthFromAPIKey, getSupabase } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const model = createAnthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
})("claude-3-7-sonnet-20250219");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let client: SupabaseClient<Database> | null = null;
  let userId: string | null = null;
  let companyId: string | null = null;

  const CARBON_MCP_API_KEY = Deno.env.get("CARBON_MCP_API_KEY");
  if (CARBON_MCP_API_KEY) {
    const auth = await getAuthFromAPIKey(CARBON_MCP_API_KEY);
    if (auth) {
      client = auth.client;
      userId = auth.userId;
      companyId = auth.companyId;
    }
  }

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "") ?? null;

  if (token && !client) {
    client = getSupabase(token);
    companyId = req.headers.get("x-company-id");

    await client.auth.setSession({
      access_token: token,
      refresh_token: token,
    });

    const user = (await client.auth.getUser())?.data?.user;
    if (user) {
      userId = user.id;
    }
  }

  if (!client || !companyId || !userId) {
    return new Response("Unauthorized", {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    });
  }

  try {
    const payload = await req.json();
    const body = z.custom<LanguageModelV1CallOptions>().parse(payload);

    const result = await model.doGenerate(body);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error(error);
    if (error instanceof APICallError) {
      return new Response(
        JSON.stringify({
          message: "API call error",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
    return new Response(JSON.stringify(error), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
