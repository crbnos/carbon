import { getLogger } from "@carbon/logger";
import { Edition } from "@carbon/utils";
import { checkBotId } from "botid/server";
import {
  BOT_PROTECTION,
  CarbonEdition,
  CLOUDFLARE_TURNSTILE_SECRET_KEY,
  CLOUDFLARE_TURNSTILE_SITE_KEY,
  IS_VERCEL
} from "../config/env";
import { logAuthEvent } from "./auth-events.server";

const log = getLogger("auth");

const BOT_BLOCKED_MESSAGE = "Bot verification failed. Please try again.";

// Which bot check guards login, decided once per process so the loader (which
// sets up the client half) and the action (which verifies) can never disagree.
//
// BOT_PROTECTION chooses. BotID is invisible but only works on Vercel: the
// challenge script is served through the rewrites in apps/*/vercel.json and
// checkBotId() needs Vercel's request context. Turnstile works anywhere with
// its two keys; the BYOC console's Integrations tab is where a self-hosted
// operator sets them. Unset: BotID for Cloud on Vercel, else Turnstile if its
// keys are set, else no check (the IP rate limit and lockout still stand).
//
// An explicit choice that cannot work stops the process at boot rather than
// leaving login unguarded without anyone noticing.
export type BotProtection =
  | { provider: "botid" }
  | { provider: "turnstile"; siteKey: string }
  | null;

function resolveBotProtection(): BotProtection {
  const turnstile: BotProtection =
    CLOUDFLARE_TURNSTILE_SITE_KEY && CLOUDFLARE_TURNSTILE_SECRET_KEY
      ? { provider: "turnstile", siteKey: CLOUDFLARE_TURNSTILE_SITE_KEY }
      : null;

  switch (BOT_PROTECTION) {
    case "botid":
      if (!IS_VERCEL) {
        throw new Error("BOT_PROTECTION=botid only works on Vercel");
      }
      return { provider: "botid" };
    case "turnstile":
      if (!turnstile) {
        throw new Error(
          "BOT_PROTECTION=turnstile needs CLOUDFLARE_TURNSTILE_SITE_KEY and CLOUDFLARE_TURNSTILE_SECRET_KEY"
        );
      }
      return turnstile;
    case undefined:
    case "":
      return CarbonEdition === Edition.Cloud && IS_VERCEL
        ? { provider: "botid" }
        : turnstile;
    default:
      throw new Error(
        `BOT_PROTECTION must be "botid" or "turnstile", got "${BOT_PROTECTION}"`
      );
  }
}

export const botProtection = resolveBotProtection();

// Returns a user-facing message when the request looks automated, null when
// the gate passes. `token` is the Turnstile response the form posted; BotID
// needs none, it reads the header its patched fetch added.
export async function verifyBotProtection({
  token,
  ip,
  actor
}: {
  token?: string;
  ip: string;
  actor?: string;
}): Promise<string | null> {
  if (!botProtection) return null;
  const isBot =
    botProtection.provider === "botid"
      ? await checkBotIdSafely()
      : !(await verifyTurnstileToken(token, ip));
  if (!isBot) return null;
  logAuthEvent("login_failed", { actor, ip, reason: "bot detected" });
  return BOT_BLOCKED_MESSAGE;
}

async function checkBotIdSafely(): Promise<boolean> {
  try {
    return (await checkBotId()).isBot;
  } catch (e) {
    // A throw is a platform misconfiguration (e.g. OIDC disabled on the
    // project), not a verdict on the caller — fail open so it cannot lock
    // every Cloud user out; the IP rate limit and account lockout still apply.
    log.error("BotID check failed", { error: e });
    return false;
  }
}

// Fails closed, unlike BotID: an operator chose Turnstile by setting its keys,
// so an unreachable siteverify is a reason to retry, not to wave bots through.
async function verifyTurnstileToken(
  token: string | undefined,
  remoteip: string
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: CLOUDFLARE_TURNSTILE_SECRET_KEY ?? "",
          response: token,
          // the client address, not the full x-forwarded-for proxy chain
          remoteip: remoteip.split(",")[0]?.trim() ?? ""
        })
      }
    );
    const result = await response.json();
    return Boolean(result.success);
  } catch (e) {
    log.error("Turnstile siteverify request failed", { error: e });
    return false;
  }
}
