// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "@carbon/logger/configure.server";
import { POSTHOG_API_HOST, SUPABASE_URL } from "@carbon/auth";
import { installFormBodyGuard } from "@carbon/auth/middleware/form-body.server";
import {
  getNonce,
  setStrictContentSecurityPolicy
} from "@carbon/auth/middleware/security.server";
import { getProcessPool } from "@carbon/database/client";
import { initFlags } from "@carbon/env/flags.server";
import { redisFlagsStore } from "@carbon/kv";
import { createTracing } from "@carbon/logger/tracing.server";
import { async } from "@carbon/utils";
import { attachDatabasePool, waitUntil } from "@vercel/functions";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";

installFormBodyGuard();

// Vercel freezes an instance once its response is sent: keep it up until idle
// database connections have closed and background work has finished.
if (process.env.VERCEL) {
  attachDatabasePool(getProcessPool());
  async.onBackground(waitUntil);
}

export const instrumentations = createTracing({
  serviceName: "carbon-mes",
  // Vercel can suspend the instance once the response is sent.
  afterRequest: process.env.VERCEL ? (flush) => waitUntil(flush()) : undefined
});

// Feature flags: every process reads the shared copy in Redis and syncs it in
// the background. Until the first document loads, each flag answers its
// registry default.
void initFlags({
  store: redisFlagsStore,
  waitUntil: process.env.VERCEL ? waitUntil : undefined
});

export const streamTimeout = 60_000;

// The ENFORCED CSP (NIST 800-171 3.13.13 control-of-mobile-code + SC-7/SC-8
// hardening) is still this safe subset — object-src 'none' (no plugins),
// base-uri 'self', frame-ancestors 'self' (no cross-origin framing while still
// allowing same-origin embeds like previews). The strict nonce policy runs
// report-only beside it until its reports are clean
// (.ai/plans/2026-09-28-csp-csrf.md).
const BASELINE_CSP_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
];

// Compose the baseline CSP with any route-set policy rather than replacing it:
// a route may attach its own directives (script-src with a nonce/hash, etc.)
// that must survive. Keep the route's policy intact and append only the
// baseline directives it omits (matched by directive name).
function composeContentSecurityPolicy(existing: string | null): string {
  if (!existing?.trim()) return BASELINE_CSP_DIRECTIVES.join("; ");
  const present = new Set(
    existing
      .split(";")
      .map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase())
      .filter(Boolean)
  );
  const additions = BASELINE_CSP_DIRECTIVES.filter(
    (directive) => !present.has(directive.split(/\s+/)[0].toLowerCase())
  );
  return additions.length
    ? `${existing.replace(/;\s*$/, "")}; ${additions.join("; ")}`
    : existing;
}

// nosniff, X-Frame-Options, Referrer-Policy and HSTS are set on every response
// (resource routes included) by securityMiddleware in root.tsx.
function applySecurityHeaders(headers: Headers, nonce: string) {
  headers.set(
    "Content-Security-Policy",
    composeContentSecurityPolicy(headers.get("Content-Security-Policy"))
  );
  setStrictContentSecurityPolicy(headers, nonce, {
    supabaseUrl: SUPABASE_URL,
    posthogHost: POSTHOG_API_HOST
  });
}

export { handleServerError as handleError } from "@carbon/logger/middleware.server";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  const nonce = getNonce(_loadContext);
  applySecurityHeaders(responseHeaders, nonce);
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext, // Vercel's handler still expecting AppLoadContext type
    { nonce }
  );
}
