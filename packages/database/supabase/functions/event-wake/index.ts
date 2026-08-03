import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
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
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    await sendInngestEvent("carbon/event-queue.process", {});

    return jsonResponse({ success: true });
  } catch (err) {
    // A failed wake is harmless: the pg_cron sweeper re-fires while the
    // queue is non-empty.
    logger.error("Error in event-wake", { error: (err as Error).message });
    return errorResponse(err, 500);
  }
});
