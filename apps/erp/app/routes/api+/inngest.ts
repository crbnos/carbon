import { functions, inngest, setWorkflowDispatch } from "@carbon/jobs/inngest";
import { serve } from "inngest/remix";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { executeFunction } from "./mcp+/lib/direct-executor";

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
  serveHost: process.env.INNGEST_SERVE_HOST || process.env.ERP_URL
});

// packages/jobs cannot import ~/modules, so the ERP app hands it the dispatcher.
// Wired on first request rather than at module scope: a top-level side effect is
// not removable by the client build, which would drag the server-only jobs graph
// into the browser bundle.
let dispatchWired = false;
function wireWorkflowDispatch() {
  if (dispatchWired) return;
  setWorkflowDispatch(executeFunction);
  dispatchWired = true;
}

// In connect mode, we still serve for discovery but can log/track differently
export function loader(args: LoaderFunctionArgs) {
  wireWorkflowDispatch();
  return handler(args);
}

export function action(args: ActionFunctionArgs) {
  wireWorkflowDispatch();
  return handler(args);
}
