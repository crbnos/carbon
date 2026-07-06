import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Database } from "../lib/types.ts";
import { checkApiKeyRateLimit } from "./ratelimit.ts";

/** Hash an API key using SHA-256 for secure lookup */
function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** PostgREST may reject opaque `sb_secret_*` env keys; use caller JWT when env is not JWT-shaped. */
function postgrestServiceKey(authorizationHeader: string | null): string {
  const envKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (envKey.split(".").length === 3) return envKey;
  const token =
    authorizationHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const p = JSON.parse(atob(parts[1]!)) as { role?: string };
      if (p.role === "service_role") return token;
    } catch {
      /* ignore */
    }
  }
  return envKey;
}

function isTrustedBearer(authorizationHeader: string | null): boolean {
  const envKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const token =
    authorizationHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return false;
  if (token === envKey) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const role = (JSON.parse(atob(parts[1]!)) as { role?: string }).role;
    return role === "service_role";
  } catch {
    return false;
  }
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

  const keyHash = hashApiKey(apiKey);

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
    rateLimit: row.rateLimit ?? 60,
    rateLimitWindow: row.rateLimitWindow ?? "1m",
  };
};

export const getSupabase = (authorizationHeader: string | null) => {
  if (!authorizationHeader) throw new Error("Authorization header is required");

  return createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: { Authorization: authorizationHeader },
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
    postgrestServiceKey(authorizationHeader),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  if (apiKeyHeader && companyId) {
    const keyHash = hashApiKey(apiKeyHeader);
    const { data, error } = await serviceRole
      .from("apiKey")
      .select("id, companyId, rateLimit, rateLimitWindow, expiresAt")
      .eq("keyHash" as any, keyHash)
      .eq("companyId", companyId)
      .single();

    if (error) {
      throw new Error("Failed to get API key");
    }

    if (!data) {
      throw new Error("API key not found");
    }

    const row = data as any;

    // Check expiration
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      throw new Error("API key has expired");
    }

    // Check rate limit
    const rl = await checkApiKeyRateLimit(
      serviceRole,
      row.id,
      row.rateLimit ?? 60,
      row.rateLimitWindow ?? "1m"
    );
    if (!rl.success) {
      throw new Error("Rate limit exceeded");
    }

    return serviceRole;
  }

  if (authorizationHeader) {
    if (!isTrustedBearer(authorizationHeader)) {
      throw new Error("Valid authorization is required");
    }

    return serviceRole;
  }

  throw new Error("Authorization header or API key header is required");
};

type RequiredPermissions = {
  view?: string | string[];
  create?: string | string[];
  update?: string | string[];
  delete?: string | string[];
};

type Permission = {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
};

function parseClaimsPermissions(
  claims: Record<string, unknown>
): { permissions: Record<string, Permission>; role: string | null } {
  const permissions: Record<string, Permission> = {};
  let role: string | null = null;

  for (const [key, value] of Object.entries(claims)) {
    if (key === "role") {
      role = value as string;
      continue;
    }
    const parts = key.split("_");
    if (parts.length !== 2) continue;
    const [mod, action] = parts;
    if (
      !["view", "create", "update", "delete"].includes(action!) ||
      !Array.isArray(value)
    )
      continue;

    if (!(mod! in permissions)) {
      permissions[mod!] = { view: [], create: [], update: [], delete: [] };
    }
    permissions[mod!][action as keyof Permission] = value as string[];
  }

  return { permissions, role };
}

function checkPermissions(
  claims: Record<string, Permission>,
  companyId: string,
  required: RequiredPermissions
): boolean {
  for (const [action, modules] of Object.entries(required)) {
    const moduleList =
      typeof modules === "string" ? [modules] : (modules as string[]);
    for (const mod of moduleList) {
      const perm = claims[mod]?.[action as keyof Permission];
      if (!perm || !perm.includes(companyId)) {
        return false;
      }
    }
  }
  return true;
}

export async function requirePermissions(
  req: Request,
  companyId: string,
  userId: string,
  permissions: RequiredPermissions
): Promise<ReturnType<typeof createClient<Database>>> {
  const authorizationHeader = req.headers.get("Authorization");
  const apiKeyHeader = req.headers.get("carbon-key");

  const serviceRole = createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    postgrestServiceKey(authorizationHeader),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  // API key path
  if (apiKeyHeader && companyId) {
    const keyHash = hashApiKey(apiKeyHeader);
    const { data, error } = await serviceRole
      .from("apiKey")
      .select("id, companyId, scopes, rateLimit, rateLimitWindow, expiresAt")
      .eq("keyHash" as any, keyHash)
      .eq("companyId", companyId)
      .single();

    if (error || !data) {
      throw new Error("API key not found");
    }

    const row = data as any;

    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      throw new Error("API key has expired");
    }

    const rl = await checkApiKeyRateLimit(
      serviceRole,
      row.id,
      row.rateLimit ?? 60,
      row.rateLimitWindow ?? "1m"
    );
    if (!rl.success) {
      throw new Error("Rate limit exceeded");
    }

    // Check API key scopes against required permissions
    const scopes: Record<string, string[]> = row.scopes ?? {};
    for (const [action, modules] of Object.entries(permissions)) {
      const moduleList =
        typeof modules === "string" ? [modules] : (modules as string[]);
      for (const mod of moduleList) {
        const scopeKey = `${mod}_${action}`;
        if (!(scopeKey in scopes) || !scopes[scopeKey]?.includes(companyId)) {
          throw new Error("API key lacks required permissions");
        }
      }
    }

    return serviceRole;
  }

  // JWT path
  if (!authorizationHeader) {
    throw new Error("Authorization header or API key header is required");
  }

  const token =
    authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid authorization token");
  }

  let role: string | undefined;
  try {
    role = (JSON.parse(atob(parts[1]!)) as { role?: string }).role;
  } catch {
    throw new Error("Invalid authorization token");
  }

  if (role === "service_role") {
    return serviceRole;
  }

  if (role === "authenticated") {
    const claimsResult = await serviceRole.rpc("get_claims", {
      uid: userId,
      company: companyId,
    });

    if (claimsResult.error || !claimsResult.data) {
      throw new Error("Failed to get user permissions");
    }

    const parsed = parseClaimsPermissions(
      claimsResult.data as unknown as Record<string, unknown>
    );

    if (!checkPermissions(parsed.permissions, companyId, permissions)) {
      throw new Error("Insufficient permissions");
    }

    return serviceRole;
  }

  throw new Error("Valid authorization is required");
}
