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
