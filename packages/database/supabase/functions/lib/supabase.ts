import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import type { Database } from "../lib/types.ts";

/** Hash an API key using SHA-256 for secure lookup */
async function hashApiKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ApiKeyAuth = {
  client: ReturnType<typeof createClient<Database>>;
  companyId: string;
  userId: string;
  apiKeyId: string;
  scopes: Record<string, string[]>;
  rateLimit: number;
  rateLimitWindow: "1m" | "1h" | "1d";
};

export const getAuthFromAPIKey = async (
  apiKey: string
): Promise<ApiKeyAuth | null> => {
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

  const keyHash = await hashApiKey(apiKey);

  const apiKeyRow = await serviceRole
    .from("apiKey")
    .select(
      "id, companyId, createdBy, scopes, rateLimit, rateLimitWindow, expiresAt"
    )
    .eq("keyHash" as any, keyHash)
    .single();

  if (apiKeyRow.error) return null;

  const row = apiKeyRow.data as any;

  // Check expiration
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return null;
  }

  return {
    client: createClient<Database>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: {
            "carbon-key": apiKey,
          },
        },
      }
    ),
    companyId: row.companyId,
    userId: row.createdBy,
    apiKeyId: row.id,
    scopes: row.scopes ?? {},
    rateLimit: row.rateLimit ?? 1000,
    rateLimitWindow: row.rateLimitWindow ?? "1h",
  };
};

export const getSupabase = (authorizationHeader: string | null) => {
  if (!authorizationHeader) throw new Error("Authorization header is required");

  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
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
  apiKeyHeader?: string | null,
  companyId?: string
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

  if (apiKeyHeader && companyId) {
    const keyHash = await hashApiKey(apiKeyHeader);
    const { data, error } = await serviceRole
      .from("apiKey")
      .select("companyId, expiresAt")
      .eq("keyHash" as any, keyHash)
      .eq("companyId", companyId)
      .single();

    if (error) {
      throw new Error("Failed to get API key");
    }

    if (!data) {
      throw new Error("API key not found");
    }

    // Check expiration
    const expiresAt = (data as any).expiresAt;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      throw new Error("API key has expired");
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
