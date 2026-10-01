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
      global: { headers }
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
