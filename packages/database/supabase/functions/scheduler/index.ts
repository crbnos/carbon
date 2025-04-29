import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import { SchedulingStrategy } from "../lib/scheduling/types.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    jobId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("dependencies"),
    jobId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);
    const { type, companyId, userId, jobId } = validatedPayload;

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    switch (validatedPayload.type) {
      case "schedule": {
        console.log({
          function: "scheduler",
          type,
          jobId,
          companyId,
          userId,
        });
        const engine = new SchedulingEngine({ client, db, jobId, companyId });

        await engine.addDependencies(); // TODO: Remove this

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
      }
      case "dependencies": {
        const engine = new SchedulingEngine({ client, db, jobId, companyId });

        await engine.initialize();
        await engine.addDependencies();

        return new Response(
          JSON.stringify({
            success: true,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      default: {
        throw new Error(`Unsupported operation type: ${type}`);
      }
    }
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
