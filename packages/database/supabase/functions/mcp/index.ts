import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { createMcp } from "../lib/mcp.ts";
import { getAuthFromAPIKey, getSupabase } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { prompt, tools } from "./tools.ee.ts";

const mcp = createMcp({ prompt, tools });
const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();

  console.log({
    function: "mcp",
    ...payload,
  });

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
    const result = await mcp.process({
      payload,
      context: {
        client,
        db,
        companyId,
        userId,
      },
    });
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(error), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
