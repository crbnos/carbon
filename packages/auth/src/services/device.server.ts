import { Edition } from "@carbon/utils";
import { createCookieSessionStorage } from "react-router";
import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
import { getCookieDomain } from "../utils/cookie";

const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

/**
 * One year. This cookie's whole purpose is to outlive the 7-day session — a
 * device that is forgotten every week can never be older than an attacker's
 * fresh one, which is the comparison the revoke gate rests on.
 */
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEVICE_KEY = "deviceId";

// Separate cookie from "carbon": it must survive logout, which clears that one.
// Signed with the same secret so a forged deviceId fails validation — an
// unsigned cookie would let anyone claim an established device.
const deviceStorage = createCookieSessionStorage({
  cookie: {
    name: "carbon-device",
    httpOnly: true,
    path: "/",
    sameSite: isTestEdition ? "none" : "lax",
    secrets: [SESSION_SECRET!],
    secure: !!cookieDomain,
    domain: cookieDomain
  }
});

export async function getDeviceId(request: Request): Promise<string | null> {
  try {
    const session = await deviceStorage.getSession(
      request.headers.get("Cookie")
    );
    const deviceId = session.get(DEVICE_KEY);
    return typeof deviceId === "string" && deviceId.length > 0
      ? deviceId
      : null;
  } catch {
    // Tampered or undecryptable cookie — treat as a device we have never seen,
    // never as a valid id.
    return null;
  }
}

/**
 * The device id for this request, minting one when absent. Returns the
 * `Set-Cookie` value ONLY when a new id was issued, so callers can append it to
 * the response they were already sending.
 *
 * Never throws: a client that refuses cookies still logs in, and is simply
 * treated as an unrecognised device on every request.
 */
export async function ensureDeviceId(
  request: Request
): Promise<{ deviceId: string; setCookie?: string }> {
  const existing = await getDeviceId(request);
  if (existing) return { deviceId: existing };

  const deviceId = crypto.randomUUID();
  const session = await deviceStorage.getSession();
  session.set(DEVICE_KEY, deviceId);
  const setCookie = await deviceStorage.commitSession(session, {
    maxAge: DEVICE_COOKIE_MAX_AGE
  });
  return { deviceId, setCookie };
}
