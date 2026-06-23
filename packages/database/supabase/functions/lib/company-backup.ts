import type { createClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

export const BACKUP_INTEGRATION = "company-backup";
export const EXPORTS_PREFIX = "exports";

type Client = ReturnType<typeof createClient<Database>>;

/** Extract the authenticated user id (JWT `sub`) from the request. */
export function getUserIdFromRequest(req: Request): string | null {
  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!)) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Company data export/import is owner-only — the same gate the settings UI
 * applies via `requiresOwnership`.
 */
export async function requireCompanyOwner(
  client: Client,
  companyId: string,
  userId: string
): Promise<void> {
  const company = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error(company.error.message);
  if (!company.data?.companyGroupId) {
    throw new Error("Company has no company group");
  }

  const group = await client
    .from("companyGroup")
    .select("ownerId")
    .eq("id", company.data.companyGroupId)
    .single();
  if (group.error) throw new Error(group.error.message);
  if (group.data?.ownerId !== userId) {
    throw new Error("Only the company owner can manage company data");
  }
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status
  });
}

export function errorResponse(
  err: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  return jsonResponse({ success: false, message }, status, corsHeaders);
}
