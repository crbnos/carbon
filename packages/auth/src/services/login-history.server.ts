import { getLogger } from "@carbon/logger";
import { getClientIp } from "@carbon/utils";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { logAuthEvent } from "./auth-events.server";

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
}): Promise<void> {
  const { request, userId, email, accessToken, method, app } = params;
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

    const { error } = await serviceRole.from("userLogin").insert({
      userId,
      sessionId: getSessionId(accessToken),
      method,
      app,
      ipAddress,
      city,
      country,
      userAgent
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
    const { error: pruneError } = await serviceRole
      .from("userLogin")
      .delete()
      .eq("userId", userId)
      .lt("createdAt", cutoff);
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
  } catch (error) {
    log.warn("Failed to record login history", { error, userId, app });
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
