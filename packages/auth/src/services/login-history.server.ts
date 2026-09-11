import { getLogger } from "@carbon/logger";
import { getClientIp } from "@carbon/utils";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { logAuthEvent } from "./auth-events.server";
import { getDeviceId } from "./device.server";

const log = getLogger("auth", "login-history");

/**
 * How long sign-in history is kept. Pruned opportunistically on each insert so
 * the table is self-cleaning without a scheduled job, and stored IPs (PII) are
 * bounded (spec: .ai/specs/2026-08-26-user-devices-login-history.md).
 */
const RETENTION_DAYS = 90;

export type LoginMethod =
  | "magic_link"
  | "oauth_google"
  | "oauth_azure"
  | "passkey"
  | "verification_code"
  | "bypass"
  | "sso"
  | "unknown";

type AccessTokenClaims = {
  session_id?: string;
  amr?: { method?: string; timestamp?: number }[];
  app_metadata?: { provider?: string; providers?: string[] };
};

function decodeAccessToken(accessToken: string): AccessTokenClaims | null {
  try {
    const payloadSegment = accessToken.split(".")[1];
    if (!payloadSegment) return null;
    return JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8")
    ) as AccessTokenClaims;
  } catch {
    return null;
  }
}

/**
 * The GoTrue `auth.sessions` id carried in every access token's `session_id`
 * claim — stable across token refreshes for the session's whole life, so it
 * links a `userLogin` row to the live session it minted (and is what session
 * revocation deletes). Null on anything malformed.
 */
export function getSessionId(accessToken: string): string | null {
  const sessionId = decodeAccessToken(accessToken)?.session_id;
  return typeof sessionId === "string" && sessionId.length > 0
    ? sessionId
    : null;
}

/**
 * Best-effort login-method classification for the `/callback` route, which
 * serves magic-link AND both OAuth providers and cannot tell them apart from
 * its form payload. Reads the GoTrue access token's `amr` claim (most recent
 * entry) and, for OAuth, the provider from `app_metadata`. The label is
 * cosmetic — it never gates logic — so anything unresolvable is `"unknown"`.
 * Routes that know their method statically (passkey, verify, bypass) pass it
 * directly instead of calling this.
 */
export function deriveLoginMethod(accessToken: string): LoginMethod {
  try {
    const payload = decodeAccessToken(accessToken);
    if (!payload) return "unknown";

    const latest = [...(payload.amr ?? [])].sort(
      (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)
    )[0];

    if (latest?.method === "otp" || latest?.method === "magiclink") {
      return "magic_link";
    }

    if (latest?.method === "oauth") {
      const oauthProviders = (payload.app_metadata?.providers ?? []).filter(
        (provider) => provider === "google" || provider === "azure"
      );
      const provider =
        oauthProviders.length === 1
          ? oauthProviders[0]
          : payload.app_metadata?.provider;
      if (provider === "google") return "oauth_google";
      if (provider === "azure") return "oauth_azure";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Record a completed sign-in (first factor succeeded) in `userLogin` and emit
 * the matching `login_success` auth event. Called from every login mint point
 * (ERP/MES callback + passkey verify, ERP bypass + signup verify) — see the
 * spec for why `unlock`, `refresh-session`, and `/mfa` are NOT logins.
 *
 * NEVER throws and swallows every I/O failure: a login must not fail because
 * history could not be written (the same fail-open stance the lockout takes on
 * Redis errors). Writes via the service role because no user-authed client
 * exists yet at the call sites — RLS on the table is read-only for owners.
 */
export async function recordLogin(params: {
  request: Request;
  userId: string;
  /** For the auth-event `actor` field only — not stored on the row. */
  email: string;
  /** The minted session's access token; links the row to its GoTrue session. */
  accessToken: string;
  method: LoginMethod;
  app: "erp" | "mes";
  /** From `ensureDeviceId`; read from the cookie when the caller omits it. */
  deviceId?: string | null;
  /**
   * True when a TOTP challenge still stands between this login and a session.
   * Such a row is recorded (the attempt belongs in the audit trail) but does
   * NOT age the device or count as a sighting — `completeMfaChallenge` clears
   * the flag once the second factor actually succeeds. Without this, failing
   * MFA would be enough to make an attacker's browser look established.
   */
  mfaPending?: boolean;
}): Promise<{ isNewDevice: boolean }> {
  const { request, userId, email, accessToken, method, app } = params;
  const mfaPending = params.mfaPending ?? false;
  try {
    // Right-to-left walk past our own proxies. The leftmost hop is whatever
    // the client sent — see getClientIp.
    //
    // Read from process.env at call time rather than importing @carbon/env:
    // that module validates EVERY required var at import, so a module-scope
    // import would make this file (and its tests) depend on unrelated config.
    const ipAddress = getClientIp(request, {
      trustedProxyCount: Number.parseInt(
        process.env.TRUSTED_PROXY_COUNT ?? "0",
        10
      ),
      trustedProxyIps:
        process.env.TRUSTED_PROXY_IPS?.split(",").map((ip) => ip.trim()) ?? []
    });
    // Vercel URL-encodes geo header values (e.g. "S%C3%A3o%20Paulo").
    const city = decodeGeoHeader(request.headers.get("x-vercel-ip-city"));
    const country = decodeGeoHeader(request.headers.get("x-vercel-ip-country"));
    const userAgent = request.headers.get("user-agent") || null;

    const serviceRole = getCarbonServiceRole();
    const deviceId = params.deviceId ?? (await getDeviceId(request));

    // Checked BEFORE the insert: this login's own row must not count as a
    // previous sighting of the device. Pending-MFA rows are excluded for the
    // same reason the gate ignores them — an attempt that never cleared the
    // second factor must not mark the device as already-seen, which would
    // suppress the new-device alert for the sign-in that DID succeed.
    let isNewDevice = false;
    if (deviceId) {
      const { data: seen } = await serviceRole
        .from("userLogin")
        .select("id")
        .eq("userId", userId)
        .eq("deviceId", deviceId)
        .eq("mfaPending", false)
        .limit(1)
        .maybeSingle();
      isNewDevice = !seen;
    }

    const { error } = await serviceRole.from("userLogin").insert({
      userId,
      sessionId: getSessionId(accessToken),
      method,
      app,
      ipAddress,
      city,
      country,
      userAgent,
      deviceId,
      mfaPending
    });
    if (error) {
      log.warn("Failed to record login history", { error, userId, app });
    }

    // Retention cutoff is an absolute instant (timezone-agnostic), so raw
    // epoch arithmetic is the sanctioned narrow exception to the no-JS-Date
    // rule here.
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    // Via RPC because the prune must NOT drop each device's earliest row: that
    // row is what getDeviceFirstSeenAt reads, so deleting it would silently
    // reset a long-trusted device's age and strip its ability to revoke (the
    // device cookie outlives the retention window — 365d vs 90d — so its anchor
    // row has to as well). Everything else, which is the IP/geo history that
    // retention is actually about, still goes. One statement so it cannot race
    // with a concurrent login.
    const { error: pruneError } = await serviceRole.rpc(
      "prune_user_login_history",
      { p_user_id: userId, p_cutoff: cutoff }
    );
    if (pruneError) {
      log.warn("Failed to prune login history", { error: pruneError, userId });
    }

    logAuthEvent("login_success", {
      actor: email,
      userId,
      ip: ipAddress ?? undefined,
      method,
      app
    });

    return { isNewDevice };
  } catch (error) {
    log.warn("Failed to record login history", { error, userId, app });
    // Report "not new" on failure: a spurious alert is worse than a missed one,
    // and we genuinely do not know.
    return { isNewDevice: false };
  }
}

/**
 * Promote this session's pending login row once the second factor succeeds.
 * Until this runs the row is inert: it does not age the device for the revoke
 * gate and does not count as a sighting for the new-device alert. Keyed by the
 * GoTrue session id, which is stable from the token that minted the login.
 *
 * NEVER throws, for the same reason `recordLogin` does not: a verified login
 * must not fail because its history row could not be updated.
 */
export async function markLoginMfaComplete(
  ...accessTokens: (string | null | undefined)[]
): Promise<{ isNewDevice: boolean }> {
  try {
    // Both the pre-challenge and post-challenge tokens: GoTrue's
    // challengeAndVerify raises the AAL of the existing session rather than
    // minting a new one, so these normally carry the same session_id — passing
    // both means a future rotation cannot strand the row as permanently pending.
    const sessionIds = [
      ...new Set(
        accessTokens
          .filter((token): token is string => !!token)
          .map(getSessionId)
          .filter((id): id is string => !!id)
      )
    ];
    if (sessionIds.length === 0) return { isNewDevice: false };
    const serviceRole = getCarbonServiceRole();
    const { data: promoted, error } = await serviceRole
      .from("userLogin")
      .update({ mfaPending: false })
      .in("sessionId", sessionIds)
      .eq("mfaPending", true)
      .select("userId, deviceId");
    if (error) {
      log.warn("Failed to clear mfaPending on login", { error });
      return { isNewDevice: false };
    }

    // The new-device alert is deferred to here, because the callback could not
    // know whether the second factor would ever be cleared. Now that it has,
    // ask whether any OTHER completed login has used this device before.
    const row = promoted?.[0];
    if (!row?.deviceId) return { isNewDevice: false };
    const { data: seen } = await serviceRole
      .from("userLogin")
      .select("sessionId")
      .eq("userId", row.userId)
      .eq("deviceId", row.deviceId)
      .eq("mfaPending", false)
      .limit(sessionIds.length + 1);
    // Existence, not a count — and the rows just promoted above are this very
    // login, so they are excluded in JS rather than through a PostgREST `not.in`
    // filter, whose value is a bare comma-joined string an id could break out of.
    return {
      isNewDevice: !(seen ?? []).some(
        (candidate) =>
          !candidate.sessionId || !sessionIds.includes(candidate.sessionId)
      )
    };
  } catch (error) {
    log.warn("Failed to clear mfaPending on login", { error });
    return { isNewDevice: false };
  }
}

function decodeGeoHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
