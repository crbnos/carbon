// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  currentRequest,
  isReadRequest,
  oncePerRequest
} from "@carbon/logger/middleware.server";
import { startSpan } from "@carbon/logger/tracing.server";
import { async } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_JWT_SECRET,
  SUPABASE_SERVICE_ROLE_KEY
} from "../../config/env";
import {
  getCarbonClient,
  isStorageRead,
  storageReadFetch,
  urlAndMethod
} from "./client";

// How many Supabase calls one request has in flight at once, across every
// client it builds — its share of PostgREST's connections, like an HTTP
// agent's maxSockets.
const REQUEST_CONCURRENCY = 8;

// A select (or an RPC called with `{ get: true }`) or a storage read. Not a
// POST RPC: some write, and a write cut off mid-call may or may not have
// committed. Not a table write either: some GET routes write (an OAuth
// callback saving its tokens), and that must finish.
const isRead = (url: string, method: string) =>
  isStorageRead(url, method) ||
  (url.includes("/rest/v1/") && (method === "GET" || method === "HEAD"));

/**
 * The fetch for a client built while handling `request` (by default the one
 * being handled; undefined outside a request, for jobs' own work and scripts).
 *
 * - Every call waits for one of REQUEST_CONCURRENCY slots, shared by all the
 *   clients of the request, so `Promise.all` over a page's queries cannot take
 *   every connection. A call never waits on another, so this cannot deadlock.
 *   A call that has to queue records the wait as a `supabase slot wait` span,
 *   or the request would look slow with fast queries.
 * - On a read request, selects and storage reads stop when `request.signal`
 *   aborts — the browser has gone. RPCs, table writes, auth and edge function
 *   calls run to the end.
 */
export function requestFetch(
  request = currentRequest()
): typeof fetch | undefined {
  if (!request) return undefined;
  const limit = oncePerRequest("supabase:limit", () =>
    async.limit(REQUEST_CONCURRENCY)
  );
  const signal = isReadRequest(request) ? request.signal : undefined;
  return (input, init) => {
    const started =
      limit.activeCount < REQUEST_CONCURRENCY
        ? undefined
        : startSpan("supabase slot wait", {
            "carbon.request.calls_waiting": limit.pendingCount + 1
          });
    return limit(() => {
      started?.();
      const { url, method } = urlAndMethod(input, init);
      if (!signal || !isRead(url, method)) return storageReadFetch(input, init);
      return storageReadFetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal
      });
    });
  };
}

/** Bound to the request being handled, if any — see `requestFetch`. */
export const getCarbonServiceRole = (): SupabaseClient<Database> => {
  return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!, undefined, requestFetch());
};

export async function getUserScopedClient(
  userId: string,
  options?: { workflowRunId?: string }
): Promise<SupabaseClient<Database>> {
  if (!SUPABASE_JWT_SECRET) {
    throw new Error("SUPABASE_JWT_SECRET is required for user-scoped clients");
  }

  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
  const jwt = await new SignJWT({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    ...(options?.workflowRunId
      ? { workflow_run_id: options.workflowRunId }
      : {})
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  return getCarbonClient(SUPABASE_ANON_KEY!, jwt, requestFetch());
}
