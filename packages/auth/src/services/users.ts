import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_API_URL } from "../config/env";
import type { Permission } from "../types";

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${userId}`;
}

export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return {
    data: companies.data.map((company) => ({
      ...company,
      logo: company.logo
        ? `${SUPABASE_API_URL}/storage/v1/object/public/public/${company.logo}`
        : null,
    })),
    error: null,
  };
}

export async function getCompaniesForUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  const { data, error } = await client
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);

  if (error) {
    console.error(error, `Failed to get companies for user ${userId}`);
    return [];
  }

  return data?.map((row) => row.companyId) ?? [];
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

function isClaimPermission(key: string, value: unknown) {
  const action = key.split("_")[1];
  return (
    action !== undefined &&
    ["view", "create", "update", "delete"].includes(action) &&
    Array.isArray(value)
  );
}

export function makePermissionsFromClaims(claims: Json[] | null) {
  if (typeof claims !== "object" || claims === null) return null;
  let permissions: Record<string, Permission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: [],
          create: [],
          update: [],
          delete: [],
        };
      }

      switch (action) {
        case "view":
          permissions[module]["view"] = value as string[];
          break;
        case "create":
          permissions[module]["create"] = value as string[];
          break;
        case "update":
          permissions[module]["update"] = value as string[];
          break;
        case "delete":
          permissions[module]["delete"] = value as string[];
          break;
      }
    }
  });

  if ("role" in claims) {
    role = claims["role"] as string;
  }

  if ("items" in permissions) {
    delete permissions["items"];
  }

  return { permissions, role };
}
