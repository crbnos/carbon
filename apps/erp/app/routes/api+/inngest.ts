import { functions, inngest } from "@carbon/jobs/inngest";
import { serve } from "inngest/remix";

/**
 * Inngest API endpoint.
 *
 * Supports two modes via INNGEST_MODE env var:
 * - "serve" (default): Handle function execution via HTTP
 * - "connect": Return info message, execution handled by worker
 *
 * In "connect" mode, this endpoint still serves function discovery
 * but actual execution happens via the WebSocket worker.
 */

// const mode = process.env.INNGEST_MODE?.toLowerCase() || "serve";

const handler = serve({
  client: inngest,
  functions,
  // Enable streaming for long-running functions on Vercel
  streaming: "allow",
  serveHost: process.env.ERP_URL
});

// In connect mode, we still serve for discovery but can log/track differently
export const loader = handler;
export const action = handler;
