export const BACKUP_INTEGRATION = "company-backup";
export const EXPORTS_PREFIX = "exports";

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
