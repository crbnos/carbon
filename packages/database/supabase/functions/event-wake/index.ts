import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsHeaders } from "../lib/headers.ts";
import { sendInngestEvent } from "../lib/inngest.ts";
import { getFunctionLogger } from "../lib/logging.ts";

const logger = getFunctionLogger("event-wake");

/**
 * Wake the Inngest event-queue drainer. Machine-called from Postgres via
 * pg_net (dispatch_event_batch + the pg_cron sweeper) whenever messages are
 * pending in the `event_system` PGMQ queue. The payload carries no data —
 * the queue itself is the source of truth; this is only a doorbell.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await sendInngestEvent("carbon/event-queue.process", {});

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    // A failed wake is harmless: the pg_cron sweeper re-fires while the
    // queue is non-empty.
    logger.error("Error in event-wake", { error: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
