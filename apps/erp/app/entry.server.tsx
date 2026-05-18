import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { notifyManifestQueue } from "~/services/mcp/notifyManifestQueue";

export const streamTimeout = 60_000;

// Fire a single pgmq message at process boot announcing the manifest content
// hash. The embeddings worker (pg_cron-driven edge function) consumes it.
// Guarded so multiple handleRequest invocations don't repeat the send.
let mcpBootTriggered = false;
function triggerMcpBootOnce(): void {
  if (mcpBootTriggered) return;
  mcpBootTriggered = true;
  void notifyManifestQueue(getCarbonServiceRole()).catch(() => {
    // already logged inside notifyManifestQueue
  });
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  triggerMcpBootOnce();
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext // Vercel's handler still expecting AppLoadContext type
  );
}
