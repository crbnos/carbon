import type { Database } from "@carbon/database";
import { isBrowser } from "@carbon/utils";
import { createClient } from "@supabase/supabase-js";

import {
  SUPABASE_ANON_PUBLIC,
  SUPABASE_API_URL,
  SUPABASE_SERVICE_ROLE,
} from "~/config/env";

const getSupabaseClient = (supabaseKey: string, accessToken?: string) => {
  const global = accessToken
    ? {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    : {};

  const client = createClient<Database>(SUPABASE_API_URL, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...global,
  });

  return client;
};

/**
 * Provides a Supabase Client for the logged in user or get back a public and safe client without admin privileges
 *
 * It's a per request scoped client to prevent access token leaking over multiple concurrent requests and from different users.
 *
 */
export const getSupabase = (accessToken?: string) => {
  return getSupabaseClient(SUPABASE_ANON_PUBLIC, accessToken);
};

/**
 * Provides a Supabase Admin Client with full admin privileges
 *
 * It's a per request scoped client, to prevent access token leaking`.
 *
 */
export const getSupabaseServiceRole = () => {
  if (isBrowser)
    throw new Error(
      "getSupabaseServiceRole is not available in browser and should NOT be used in insecure environments"
    );

  return getSupabaseClient(SUPABASE_SERVICE_ROLE);
};

export const supabaseClient = getSupabase();
