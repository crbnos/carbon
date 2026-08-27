import { randomBytes } from "node:crypto";
import { redis } from "@carbon/kv";
import type { AuthSession } from "../types";

/**
 * Panel sessions: a bearer credential for Carbon UI that runs inside another
 * product's iframe (the Onshape right panel).
 *
 * The `carbon` session cookie is `SameSite=Lax`, so it never reaches a
 * cross-site iframe. Instead, a popup on Carbon's own origin (which does have
 * the cookie) mints one of these: an opaque `cps_…` token whose `AuthSession`
 * lives in Redis for `PANEL_SESSION_TTL_SECONDS`. The iframe keeps the token in
 * `sessionStorage` and sends it as `Authorization: Bearer cps_…`;
 * `requirePermissions` resolves it exactly like a cookie session — same claims
 * check, same RLS client — and refreshes the Supabase token in place.
 *
 * Opaque by design: nothing about the user is decodable from the token, and
 * deleting the Redis key revokes it immediately.
 */

export const PANEL_SESSION_TTL_SECONDS = 12 * 60 * 60;

const TOKEN_PREFIX = "cps_";
// 24 random bytes → 32 base64url characters.
const TOKEN_PATTERN = /^cps_[A-Za-z0-9_-]{32}$/;

function keyFor(token: string) {
  return `panel-session:${token}`;
}

export function isPanelSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** The panel token on a request, or null when the request carries none. */
export function panelSessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return isPanelSessionToken(token) ? token : null;
}

export async function createPanelSession(
  authSession: AuthSession
): Promise<string> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  await redis.set(
    keyFor(token),
    JSON.stringify(authSession),
    "EX",
    PANEL_SESSION_TTL_SECONDS
  );
  return token;
}

export async function loadPanelSession(
  token: string
): Promise<AuthSession | null> {
  const raw = await redis.get(keyFor(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await redis.del(keyFor(token));
    return null;
  }
}

/** Overwrite the stored session (after a token refresh), keeping the remaining TTL. */
export async function savePanelSession(
  token: string,
  authSession: AuthSession
): Promise<void> {
  const ttl = await redis.ttl(keyFor(token));
  if (ttl <= 0) return;
  await redis.set(keyFor(token), JSON.stringify(authSession), "EX", ttl);
}

export async function deletePanelSession(token: string): Promise<void> {
  await redis.del(keyFor(token));
}
