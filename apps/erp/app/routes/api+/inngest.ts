// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { functions, inngest, setWorkflowDispatch } from "@carbon/jobs/inngest";
import { describeRequest } from "@carbon/logger/middleware.server";
import {
  annotateRequestSpan,
  nameRequestSpan
} from "@carbon/logger/tracing.server";
import { serve } from "inngest/remix";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { callOperation } from "./v1+/lib/call.server";

const handler = serve({
  client: inngest,
  functions,
  // Enable streaming for long-running functions on Vercel
  streaming: "allow",
  serveHost: process.env.INNGEST_SERVE_HOST || process.env.ERP_URL
});

// As Inngest addresses them: `<app>-<function>`, plus the failure handler's.
const functionIds = new Set(
  functions.flatMap((fn) => {
    const id = fn.id(inngest.id);
    return [id, `${id}-failure`];
  })
);

// packages/jobs cannot import ~/modules, so the ERP app hands it the dispatcher.
// Wired on first request rather than at module scope: a top-level side effect is
// not removable by the client build, which would drag the server-only jobs graph
// into the browser bundle.
let dispatchWired = false;
function wireWorkflowDispatch() {
  if (dispatchWired) return;
  // A running workflow acts as its already-authorized owner; the per-operation
  // scope gate applies to API keys only.
  setWorkflowDispatch((name, context, args) =>
    callOperation(name, { ...context, authKind: "session", scopes: {} }, args)
  );
  dispatchWired = true;
}

export function loader(args: LoaderFunctionArgs) {
  wireWorkflowDispatch();
  return handler(args);
}

export function action(args: ActionFunctionArgs) {
  wireWorkflowDispatch();
  // Every function and step arrives on this one route, so without these the
  // trace cannot say which function the time went to.
  const { searchParams } = new URL(args.request.url);
  const functionId = searchParams.get("fnId");
  annotateRequestSpan({
    "inngest.function.id": functionId ?? undefined,
    "inngest.step.id": searchParams.get("stepId") ?? undefined
  });
  // Inngest only calls functions it registered, but the query string is the
  // caller's: an id that is not ours stays out of the span name.
  if (functionId && functionIds.has(functionId)) {
    nameRequestSpan(`${args.request.method} /api/inngest ${functionId}`);
    describeRequest(functionId);
  }
  return handler(args);
}
