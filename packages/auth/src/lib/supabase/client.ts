// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
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

export const storageReadFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
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

export const getCarbonClient = (
  supabaseKey: string,
  accessToken?: string
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
      global: { headers, fetch: storageReadFetch }
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
  accessToken?: string
): SupabaseClient<Database, "public"> => {
  return getCarbonClient(SUPABASE_ANON_KEY!, accessToken);
};

export const carbonClient = getCarbon();
