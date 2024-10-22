import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import type { Database } from "../lib/types.ts";

export const getSupabase = (authorizationHeader: string | null) => {
  if (!authorizationHeader) throw new Error("Authorization header is required");

  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_PUBLIC") ?? "",
    {
      global: {
        headers: { authorizationHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
};

export const getSupabaseServiceRoleFromAuthorizationHeader = (
  authorizationHeader: string | null
) => {
  if (!authorizationHeader) throw new Error("Authorization header is required");

  // Verify that the request is coming from a service role
  const claims = JSON.parse(
    atob(authorizationHeader.split(" ")[1].split(".")[1])
  );
  if (claims.role !== "service_role") {
    throw new Error("Service role is required");
  }

  // Create a Supabase client with the service role key
  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      global: {
        headers: { authorizationHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
};

export const getSupabaseServiceRole = () => {
  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
};
