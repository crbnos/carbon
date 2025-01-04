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

export const getSupabaseServiceRole = async (
  authorizationHeader: string | null,
  apiKeyHeader: string | null,
  companyId: string
) => {
  if (!authorizationHeader && !apiKeyHeader) {
    throw new Error("Authorization header or API key header is required");
  }

  const serviceRole = createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  if (apiKeyHeader) {
    const { data, error } = await serviceRole
      .from("apiKey")
      .select("companyId")
      .eq("key", apiKeyHeader)
      .eq("companyId", companyId)
      .single();

    if (error) {
      throw new Error("Failed to get API key");
    }

    if (!data) {
      throw new Error("API key not found");
    }

    return serviceRole;
  }

  if (authorizationHeader) {
    const claims = JSON.parse(
      atob(authorizationHeader.split(" ")[1].split(".")[1])
    );
    if (claims.role !== "service_role") {
      throw new Error("Service role is required");
    }

    return serviceRole;
  }

  throw new Error("Authorization header or API key header is required");
};
