import { Edition } from "@carbon/utils";
import { createCookieSessionStorage } from "react-router";
import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
import { getCookieDomain } from "../utils/cookie";

const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEVICE_KEY = "deviceId";

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
    return null;
  }
}

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
