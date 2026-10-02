// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { async } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { MutableRefObject } from "react";
import type { StoreApi } from "zustand";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_INTERNAL_URL,
  SUPABASE_URL
} from "../../config/env";

// Retries are supabase-js's own: a read (GET/HEAD) is retried up to three
// times on a rejected fetch, a 503 or a 520, and a write is never replayed.
// The timeout bounds a database call that hangs; an aborted call is not retried.
const db = { timeout: 25_000 } as const;

const STORAGE_WAIT_MS = 25_000;
const STORAGE_BACKOFF_MS = [500, 1000];

// supabase-js retries database reads only. A storage read (a download, an
// info or exists check, a listing) gets the same here: a bounded wait for the
// response headers and two retries on a 5xx or a dropped connection. The body
// itself is not timed, so a large download is never cut off. Uploads, deletes
// and everything outside storage pass straight through.
const isStorageRead = (url: string, method: string) =>
  url.includes("/storage/v1/") &&
  (method === "GET" ||
    method === "HEAD" ||
    (method === "POST" && url.includes("/storage/v1/object/list")));

const urlAndMethod = (input: RequestInfo | URL, init?: RequestInit) => ({
  url: input instanceof Request ? input.url : String(input),
  method: (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase()
});

export const storageReadFetch: typeof fetch = async (input, init) => {
  const { url, method } = urlAndMethod(input, init);
  if (!isStorageRead(url, method)) return fetch(input, init);

  for (let attempt = 0; ; attempt++) {
    const retry = attempt < STORAGE_BACKOFF_MS.length;
    const waited = new AbortController();
    const timer = setTimeout(() => waited.abort(), STORAGE_WAIT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, waited.signal])
      : waited.signal;
    try {
      const response = await fetch(input, { ...init, signal });
      clearTimeout(timer);
      if (!retry || response.status < 500) return response;
      await response.body?.cancel();
    } catch (error) {
      clearTimeout(timer);
      if (!retry || init?.signal?.aborted) throw error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, STORAGE_BACKOFF_MS[attempt])
    );
  }
};

// How many calls a client serving one request has in flight at once — the
// request's share of PostgREST's connections, like an HTTP agent's maxSockets.
const REQUEST_CONCURRENCY = 8;

const READ_METHODS = new Set(["GET", "HEAD"]);

// A select, an RPC, or a storage read. A write to a table is not: some GET
// routes write (an OAuth callback saving its tokens), and that must finish.
const isRead = (url: string, method: string) =>
  isStorageRead(url, method) ||
  (url.includes("/rest/v1/") &&
    (READ_METHODS.has(method) || url.includes("/rest/v1/rpc/")));

/**
 * The fetch of a client that serves one request. Every call waits for one of
 * REQUEST_CONCURRENCY slots, so `Promise.all` over a page's queries cannot take
 * every connection. On a read request (GET/HEAD) its reads also stop when
 * `request.signal` aborts — the browser has gone — while table writes, auth and
 * edge function calls run to the end.
 */
export function requestFetch(request: Request): typeof fetch {
  const limit = async.limit(REQUEST_CONCURRENCY);
  const signal = READ_METHODS.has(request.method) ? request.signal : undefined;
  return (input, init) =>
    limit(() => {
      const { url, method } = urlAndMethod(input, init);
      if (!signal || !isRead(url, method)) return storageReadFetch(input, init);
      return storageReadFetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal
      });
    });
}

/**
 * `request` is given for a client that lives for one request: see
 * `requestFetch`. Clients for jobs and scripts have neither limit nor signal.
 */
export const getCarbonClient = (
  supabaseKey: string,
  accessToken?: string,
  request?: Request
): SupabaseClient<Database, "public"> => {
  // Always explicit. Left to supabase-js, a new-format key (`sb_secret_…`) is
  // not sent as the bearer on Edge Function calls, and those functions tell a
  // service-role caller from anyone else by this header.
  const headers = { Authorization: `Bearer ${accessToken ?? supabaseKey}` };

  const client = createClient<Database, "public">(
    SUPABASE_INTERNAL_URL!,
    supabaseKey,
    {
      db,
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers,
        fetch: request ? requestFetch(request) : storageReadFetch
      }
    }
  );

  return client;
};

export const getCarbonAPIKeyClient = (
  apiKey: string
): SupabaseClient<Database, "public"> => {
  const client = createClient(SUPABASE_INTERNAL_URL!, SUPABASE_ANON_KEY!, {
    db,
    global: {
      fetch: storageReadFetch,
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "carbon-key": apiKey
      }
    }
  });

  return client;
};

export const createCarbonWithAuthGetter = (
  store: MutableRefObject<StoreApi<{ accessToken: string }>>
): SupabaseClient<Database, "public"> => {
  return createClient<Database, "public">(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    db,
    global: { fetch: storageReadFetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    async accessToken() {
      if (!store.current) return null;
      const state = store.current.getState();
      return state.accessToken;
    }
  });
};

export const getCarbon = (
  accessToken?: string,
  request?: Request
): SupabaseClient<Database, "public"> => {
  return getCarbonClient(SUPABASE_ANON_KEY!, accessToken, request);
};

export const carbonClient = getCarbon();
