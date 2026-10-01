// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes } from "node:crypto";
import type { AuthSession } from "@carbon/auth";
import { hasPermission } from "@carbon/auth";
import { logAuthEvent } from "@carbon/auth/auth-events.server";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import {
  CONTROLLED_ENVIRONMENT,
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_IDLE_LOCK_MS
} from "@carbon/env";
import { redis } from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type PanelSession,
  panelSessionFromAuthSession,
  panelSessionRefusal,
  panelSessionTtlSeconds
} from "./session-policy";

export {
  PANEL_SESSION_TTL_SECONDS,
  type PanelSession
} from "./session-policy";

/**
 * Onshape panel sessions: a bearer credential for the Carbon UI that runs inside
 * Onshape's right-panel iframe.
 *
 * The `carbon` session cookie is `SameSite=Lax`, so it never reaches a
 * cross-site iframe. Instead, a popup on Carbon's own origin (which does have
 * the cookie) mints one of these: an opaque `cps_…` token whose identity lives
 * in Redis for at most `PANEL_SESSION_TTL_SECONDS`. The iframe keeps the token
 * in `sessionStorage` and sends it as `Authorization: Bearer cps_…`.
 *
 * The session holds identity only, never a Supabase token. Each request builds
 * its database client from a short-lived token signed for the user
 * (`getUserScopedClient`, as the MCP bearer path does). Sharing the cookie
 * session's refresh token would have both sides rotating one chain, and GoTrue
 * revokes the whole session family on the first reuse it sees.
 *
 * Opaque by design: nothing about the user is decodable from the token, and
 * deleting the Redis key revokes it immediately.
 */

/** How often a request re-stamps `lastActiveAt`, like the cookie heartbeat. */
const ACTIVITY_STAMP_INTERVAL_MS = 60_000;

const TOKEN_PREFIX = "cps_";
// 24 random bytes → 32 base64url characters.
const TOKEN_PATTERN = /^cps_[A-Za-z0-9_-]{32}$/;

function keyFor(token: string) {
  return `panel-session:${token}`;
}

export function isPanelSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function panelSessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return isPanelSessionToken(token) ? token : null;
}

/** Null when the ERP session has no time left to lend the panel. */
export async function createPanelSession(
  authSession: AuthSession
): Promise<string | null> {
  const now = Date.now();
  const session = panelSessionFromAuthSession(authSession, now);
  const ttl = panelSessionTtlSeconds(session, now, {
    controlled: CONTROLLED_ENVIRONMENT,
    absoluteMaxMs: SESSION_ABSOLUTE_MAX_MS
  });
  if (ttl <= 0) return null;

  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const stored = await redis.set(
    keyFor(token),
    JSON.stringify(session),
    "EX",
    ttl
  );
  // The client is fail-soft: a token Redis never stored would 401 on first use.
  return stored === "OK" ? token : null;
}

async function loadPanelSession(token: string): Promise<PanelSession | null> {
  const raw = await redis.get(keyFor(token));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Partial<PanelSession> & {
      accessToken?: string;
    };
    // A session minted before panel sessions stopped carrying Supabase tokens:
    // it has to sign in again once.
    if (session.accessToken || !session.userId || !session.createdAt) {
      await redis.del(keyFor(token));
      return null;
    }
    return session as PanelSession;
  } catch {
    await redis.del(keyFor(token));
    return null;
  }
}

async function stampActivity(token: string, session: PanelSession) {
  // XX: a session deleted since it was read (logout, a refusal) stays deleted.
  await redis.set(
    keyFor(token),
    JSON.stringify({ ...session, lastActiveAt: Date.now() }),
    "KEEPTTL",
    "XX"
  );
}

export async function deletePanelSession(token: string): Promise<void> {
  await redis.del(keyFor(token));
}

/**
 * The session policy the cookie path applies on every request
 * (`requireAuthSession`), applied to a panel session. Every refusal is a 401:
 * the panel sends the user back through the sign-in popup, and the cookie path
 * there routes them through `/unlock` or `/mfa`.
 */
async function requirePanelSession(token: string): Promise<PanelSession> {
  const session = await loadPanelSession(token);
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const refusal = panelSessionRefusal(session, Date.now(), {
    controlled: CONTROLLED_ENVIRONMENT,
    absoluteMaxMs: SESSION_ABSOLUTE_MAX_MS,
    idleLockMs: SESSION_IDLE_LOCK_MS,
    hasVerifiedTotpFactor: session.mfaVerified
      ? false
      : await userHasVerifiedTotpFactor(session.userId)
  });
  if (refusal) {
    await deletePanelSession(token);
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}

/**
 * The Onshape panel's own gate, purpose-built for the bearer-token iframe path.
 *
 * It mirrors `requirePermissions`' claims check but is deliberately separate:
 * `requirePermissions` is the cookie/API-key gate for the rest of Carbon and
 * carries no Onshape coupling. Panel API routes call THIS instead, and get the
 * same return shape.
 *
 * Stricter than the cookie path in two ways. Only employees pass: a portal,
 * deactivated or role-less account is refused outright. And the acting user is
 * always the session user: console pin-ins never reach a cross-site iframe.
 *
 * A panel request is always a fetch from an iframe, so both failure modes are a
 * status, never a redirect: 401 when the token is missing/expired/revoked, 403
 * when the user lacks the permission.
 */
export async function requireOnshapePanelPermissions(
  request: Request,
  requiredPermissions: {
    view?: string | string[];
    create?: string | string[];
    update?: string | string[];
    delete?: string | string[];
    bypassRls?: boolean;
  }
): Promise<{
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  email: string;
  userId: string;
  sessionUserId: string;
  consoleMode: boolean;
}> {
  const token = panelSessionTokenFromRequest(request);
  if (!token) {
    // Panel-only endpoint: refuse rather than falling back to a cookie session
    // (which can never reach the cross-site iframe anyway).
    throw new Response("Unauthorized", { status: 401 });
  }

  const session = await requirePanelSession(token);
  const { companyId, companyGroupId, email, userId } = session;

  const myClaims = await getUserClaims(userId, companyId);

  const deny = (reason: string) => {
    logAuthEvent("permission_denied", {
      userId,
      actor: email,
      companyId,
      ip: getClientIp(request) ?? undefined,
      reason: `onshape panel: ${reason}`
    });
    return new Response("Forbidden", { status: 403 });
  };

  if (myClaims.role !== "employee") {
    throw deny(`${myClaims.role ?? "no"} role`);
  }

  const hasRequiredPermissions = Object.entries(requiredPermissions).every(
    ([action, permission]) => {
      if (action === "bypassRls") return true;
      const permissions =
        typeof permission === "string"
          ? [permission]
          : Array.isArray(permission)
            ? permission
            : null;
      if (!permissions) return false;
      // `hasPermission` honours the "0" all-companies scope, as
      // `requirePermissions` and the panel's own `me` route do.
      return permissions.every((p) =>
        hasPermission(
          myClaims.permissions,
          p,
          action as "view" | "create" | "update" | "delete",
          companyId
        )
      );
    }
  );

  if (!hasRequiredPermissions) {
    throw deny(JSON.stringify(requiredPermissions));
  }

  // Only an authorized request counts as activity.
  if (Date.now() - session.lastActiveAt > ACTIVITY_STAMP_INTERVAL_MS) {
    await stampActivity(token, session);
  }

  const client = requiredPermissions.bypassRls
    ? getCarbonServiceRole()
    : await getUserScopedClient(userId);

  return {
    client,
    companyId,
    companyGroupId,
    email,
    userId,
    sessionUserId: userId,
    consoleMode: false
  };
}
