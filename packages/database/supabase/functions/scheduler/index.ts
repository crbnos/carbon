import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import { SchedulingStrategy } from "../lib/scheduling/types.ts";
import { getSupabaseServiceRoleFromAuthorizationHeader } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  jobId: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    // const client = getSupabaseServiceRoleFromAuthorizationHeader(req.headers.get("Authorization"));
    const { jobId, companyId, userId } = payloadValidator.parse(payload);

    console.log({
      function: "scheduler",
      jobId,
      companyId,
      userId,
    });

    const client = getSupabaseServiceRoleFromAuthorizationHeader(
      req.headers.get("Authorization")
    );

    const engine = new SchedulingEngine({ client, db, jobId, companyId });

    await engine.initialize();
    await Promise.all([
      engine.prioritize(SchedulingStrategy.LeastTime),
      engine.assign(),
    ]);

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
