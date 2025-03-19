import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsHeaders } from "../lib/headers.ts";
import { createMcp } from "../lib/mcp.ts";
import { prompt, tools } from "./tools.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

const mcp = createMcp({ prompt, tools });
const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const companyId = "cvcqgb0mc0m048ha48i0";

  const client = await getSupabaseServiceRole(
    req.headers.get("Authorization"),
    "crbn_8gX_n5oy_vRUmqTyCmKMD",
    companyId
  );
  const userId = "system";

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
