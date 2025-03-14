import type { Database } from "@carbon/database";
import { isBrowser } from "@carbon/utils";
import { createClient } from "@supabase/supabase-js";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from "../../config/env";

const getCarbonClient = (supabaseKey: string, accessToken?: string) => {
  const global = accessToken
    ? {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    : {};

  const client = createClient<Database>(SUPABASE_URL, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...global,
  });

  return client;
};

export const getCarbonAPIKeyClient = (apiKey: string) => {
  const client = createClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          "carbon-key": apiKey,
        },
      },
    }
  );

  return client;
};

export const getCarbon = (accessToken?: string) => {
  return getCarbonClient(SUPABASE_ANON_KEY, accessToken);
};

export const getCarbonServiceRole = () => {
  if (isBrowser)
    throw new Error(
      "getCarbonServiceRole is not available in browser and should NOT be used in insecure environments"
    );

  return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY);
};

export const carbonClient = getCarbon();
