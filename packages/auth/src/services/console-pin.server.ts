import { oncePerRead } from "@carbon/logger/middleware.server";
import { Edition } from "@carbon/utils";
import { type Cookie, createCookie } from "react-router";
import {
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  DOMAIN,
  SESSION_IDLE_LOCK_MS,
  SESSION_SECRET
} from "../config/env";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import { getCookieDomain } from "../utils/cookie";

/**
 * Console (shared MES kiosk) pin-in state.
 *
 * A console terminal is logged in as ONE session user; an operator "pins in"
 * with their PIN and every action is then attributed to them (`requirePermissions`
 * returns their id as `userId`). The pin-in lives in the `console-pin-<companyId>`
 * cookie, which is therefore an identity claim and must be:
 *
 * - SIGNED (`SESSION_SECRET`, like the `carbon` session cookie) so a hand-crafted
 *   value is rejected. A legacy unsigned value fails `unsign` and reads as
 *   "not pinned" — the operator simply pins in again.
 * - BOUND to the company and the terminal's session user, so a cookie copied to
 *   another company name or another terminal is ignored.
 * - RE-VALIDATED against the database on every request (`resolveConsolePinIn`):
 *   the pinned user must still be an ACTIVE employee of THIS company and console
 *   mode must still be switched on. A signature only proves we issued the cookie,
 *   not that the operator is still allowed to act.
 */

const CONSOLE_PIN_PREFIX = "console-pin-";
const CONSOLE_PIN_MAX_AGE = 60 * 60; // 1 hour in seconds
const CONSOLE_PIN_MAX_AGE_MS = CONSOLE_PIN_MAX_AGE * 1000;

// A controlled environment (ITAR/CUI, NIST 3.1.10) drops a shared-console operator
// to re-PIN after the standard idle-lock window instead of 1h. pinnedAt is refreshed
// on every shell navigation (see MES x+/_layout loader), so this is an inactivity
// window.
const consolePinMaxAgeMs = () =>
  CONTROLLED_ENVIRONMENT ? SESSION_IDLE_LOCK_MS : CONSOLE_PIN_MAX_AGE_MS;

export interface ConsolePinIn {
  userId: string;
  name: string;
  avatarUrl: string | null;
  pinnedAt: number; // unix timestamp ms
}

interface StoredConsolePinIn extends ConsolePinIn {
  companyId: string;
  sessionUserId: string;
}

const isTestEdition = CarbonEdition === Edition.Test;
const secure = !!getCookieDomain(DOMAIN);

const cookies = new Map<string, Cookie>();

function getConsolePinCookie(companyId: string): Cookie {
  let cookie = cookies.get(companyId);
  if (!cookie) {
    cookie = createCookie(`${CONSOLE_PIN_PREFIX}${companyId}`, {
      httpOnly: true,
      path: "/",
      sameSite: isTestEdition ? "none" : "lax",
      secrets: [SESSION_SECRET!],
      secure,
      maxAge: CONSOLE_PIN_MAX_AGE
    });
    cookies.set(companyId, cookie);
  }
  return cookie;
}

function isStoredConsolePinIn(value: unknown): value is StoredConsolePinIn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    typeof v.companyId === "string" &&
    typeof v.sessionUserId === "string" &&
    typeof v.name === "string" &&
    (v.avatarUrl === null || typeof v.avatarUrl === "string") &&
    typeof v.pinnedAt === "number" &&
    Number.isFinite(v.pinnedAt)
  );
}

/**
 * Read the pin-in cookie WITHOUT touching the database: signature, shape,
 * company/terminal binding and idle window. Exported for its tests only — use
 * `resolveConsolePinIn` for any identity decision.
 */
export async function readConsolePinInCookieUnverified(
  request: Request,
  companyId: string,
  sessionUserId: string
): Promise<ConsolePinIn | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  let parsed: unknown;
  try {
    parsed = await getConsolePinCookie(companyId).parse(cookieHeader);
  } catch {
    return null;
  }

  if (!isStoredConsolePinIn(parsed)) return null;
  if (parsed.companyId !== companyId) return null;
  if (parsed.sessionUserId !== sessionUserId) return null;
  if (Date.now() - parsed.pinnedAt > consolePinMaxAgeMs()) return null;

  return {
    userId: parsed.userId,
    name: parsed.name,
    avatarUrl: parsed.avatarUrl,
    pinnedAt: parsed.pinnedAt
  };
}

async function loadConsolePinIn(
  request: Request,
  companyId: string,
  sessionUserId: string
): Promise<ConsolePinIn | null> {
  const pinIn = await readConsolePinInCookieUnverified(
    request,
    companyId,
    sessionUserId
  );
  if (!pinIn) return null;

  const serviceRole = getCarbonServiceRole();
  // `employees` only lists users whose `user.active` is true; `employee.active`
  // is false once the person is deactivated in this company.
  const [employee, settings] = await Promise.all([
    serviceRole
      .from("employees")
      .select("id")
      .eq("id", pinIn.userId)
      .eq("companyId", companyId)
      .eq("active", true)
      .maybeSingle(),
    serviceRole
      .from("companySettings")
      .select("consoleEnabled")
      .eq("id", companyId)
      .maybeSingle()
  ]);

  if (employee.error || settings.error) return null;
  if (!employee.data || !settings.data?.consoleEnabled) return null;

  return pinIn;
}

/**
 * The operator pinned in at this console terminal, or null. Null whenever the
 * cookie is missing, forged, legacy (unsigned), bound to another company or
 * terminal, idle past its window, names someone who is not an active employee
 * of `companyId`, or console mode has been switched off for the company.
 *
 * Memoized per read request — `requirePermissions` and the MES shell middleware
 * both resolve it.
 */
export function resolveConsolePinIn(
  request: Request,
  companyId: string,
  sessionUserId: string
): Promise<ConsolePinIn | null> {
  return oncePerRead(`console-pin:${companyId}:${sessionUserId}`, () =>
    loadConsolePinIn(request, companyId, sessionUserId)
  );
}

export function setConsolePinIn(
  companyId: string,
  sessionUserId: string,
  data: ConsolePinIn
): Promise<string> {
  return getConsolePinCookie(companyId).serialize({
    ...data,
    companyId,
    sessionUserId
  } satisfies StoredConsolePinIn);
}

export function clearConsolePinIn(companyId: string): Promise<string> {
  return getConsolePinCookie(companyId).serialize("", { maxAge: 0 });
}
