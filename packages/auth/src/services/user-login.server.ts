import { getLogger } from "@carbon/logger";
import {
  datetime,
  formatDateTimeInZone,
  getClientIp,
  isPrivateIp,
  normalizeIp,
  parseUserAgent
} from "@carbon/utils";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { logAuthEvent } from "./auth-events.server";
import { getDeviceId } from "./device.server";

const log = getLogger("auth", "user-login");

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

export function getSessionId(accessToken: string): string | null {
  const sessionId = decodeAccessToken(accessToken)?.session_id;
  return typeof sessionId === "string" && sessionId.length > 0
    ? sessionId
    : null;
}

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

export type LoginContext = {
  ipAddress: string | null;
  city: string | null;
  country: string | null;
  userAgent: string | null;
};

export function getLoginContext(request: Request): LoginContext {
  const ipAddress = getClientIp(request, {
    trustedProxyCount: Number.parseInt(
      process.env.TRUSTED_PROXY_COUNT ?? "0",
      10
    ),
    trustedProxyIps:
      process.env.TRUSTED_PROXY_IPS?.split(",").map((ip) => ip.trim()) ?? []
  });
  const city = decodeGeoHeader(request.headers.get("x-vercel-ip-city"));
  const country = decodeGeoHeader(request.headers.get("x-vercel-ip-country"));
  const userAgent = request.headers.get("user-agent") || null;
  return { ipAddress, city, country, userAgent };
}

export function describeNewDeviceLogin(request: Request): {
  signedInAt: string;
  ipAddress: string | null;
  location: string | null;
  browser: string | null;
} {
  const { ipAddress, city, country, userAgent } = getLoginContext(request);
  const { browser, os } = parseUserAgent(userAgent);
  const normalizedIp = normalizeIp(ipAddress);
  const place = [city, country].filter(Boolean).join(", ");
  return {
    signedInAt: formatDateTimeInZone(datetime.timestamp(), "UTC", undefined, {
      dateStyle: "medium",
      timeStyle: "long"
    }),
    ipAddress: normalizedIp,
    location: place || (isPrivateIp(normalizedIp) ? "Local network" : null),
    browser:
      browser && os ? `${browser} on ${os}` : (browser ?? os ?? userAgent)
  };
}

export async function recordLogin(params: {
  request: Request;
  userId: string;
  email: string;
  accessToken: string;
  method: LoginMethod;
  app: "erp" | "mes";
  deviceId?: string | null;
  mfaPending?: boolean;
}): Promise<{ isNewDevice: boolean }> {
  const { request, userId, email, accessToken, method, app } = params;
  const mfaPending = params.mfaPending ?? false;
  try {
    const { ipAddress, city, country, userAgent } = getLoginContext(request);

    const serviceRole = getCarbonServiceRole();
    const deviceId = params.deviceId ?? (await getDeviceId(request));

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
      log.warn("Failed to record user login", { error, userId, app });
    }

    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { error: pruneError } = await serviceRole.rpc("prune_user_logins", {
      p_user_id: userId,
      p_cutoff: cutoff
    });
    if (pruneError) {
      log.warn("Failed to prune user logins", { error: pruneError, userId });
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
    log.warn("Failed to record user login", { error, userId, app });
    return { isNewDevice: false };
  }
}

export async function markLoginMfaComplete(
  ...accessTokens: (string | null | undefined)[]
): Promise<{ isNewDevice: boolean }> {
  try {
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

    const row = promoted?.[0];
    if (!row?.deviceId) return { isNewDevice: false };
    const { data: seen } = await serviceRole
      .from("userLogin")
      .select("sessionId")
      .eq("userId", row.userId)
      .eq("deviceId", row.deviceId)
      .eq("mfaPending", false)
      .limit(sessionIds.length + 1);
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
