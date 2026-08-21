import { CONTROLLED_ENVIRONMENT, SESSION_IDLE_LOCK_MS } from "@carbon/auth";
import * as cookie from "cookie";

const CONSOLE_PIN_PREFIX = "console-pin-";
const CONSOLE_PIN_MAX_AGE = 60 * 60; // 1 hour in seconds
const CONSOLE_PIN_MAX_AGE_MS = CONSOLE_PIN_MAX_AGE * 1000;

// A controlled environment (ITAR/CUI, NIST 3.1.10) drops a shared-console operator
// to re-PIN after the standard idle-lock window instead of 1h. pinnedAt is refreshed
// on every shell navigation (see x+/_layout loader), so this is an inactivity window.
const consolePinMaxAgeMs = () =>
  CONTROLLED_ENVIRONMENT ? SESSION_IDLE_LOCK_MS : CONSOLE_PIN_MAX_AGE_MS;

// --- Console Pin-In State ---

export interface ConsolePinIn {
  userId: string;
  name: string;
  avatarUrl: string | null;
  pinnedAt: number; // unix timestamp ms
}

export function getConsolePinIn(
  request: Request,
  companyId: string
): ConsolePinIn | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const raw = cookie.parse(cookieHeader)[`${CONSOLE_PIN_PREFIX}${companyId}`];
  if (!raw) return null;

  try {
    const parsed: ConsolePinIn = JSON.parse(raw);
    // Check manual expiry (defense-in-depth alongside cookie maxAge)
    const elapsed = Date.now() - parsed.pinnedAt;
    if (elapsed > consolePinMaxAgeMs()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setConsolePinIn(companyId: string, data: ConsolePinIn): string {
  return cookie.serialize(
    `${CONSOLE_PIN_PREFIX}${companyId}`,
    JSON.stringify(data),
    {
      path: "/",
      maxAge: CONSOLE_PIN_MAX_AGE
    }
  );
}

export function clearConsolePinIn(companyId: string): string {
  return cookie.serialize(`${CONSOLE_PIN_PREFIX}${companyId}`, "", {
    path: "/",
    maxAge: 0
  });
}

export function refreshConsolePinIn(
  companyId: string,
  existing: ConsolePinIn
): string {
  return setConsolePinIn(companyId, {
    ...existing,
    pinnedAt: Date.now()
  });
}
