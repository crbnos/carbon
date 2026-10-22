// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Edition } from "@carbon/utils";
import { createCookie } from "react-router";
import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
import { authCookieName, getCookieDomain } from "../utils/cookie";

/**
 * Marks the browser that asked for a sign-in email, so the link in it can
 * refuse to complete anywhere else (MAGIC_LINK_SAME_BROWSER). A mail
 * security sandbox opening the link has no such cookie, so it is shown a
 * page with nothing to press and the one-time token survives for the
 * person. On the shared DOMAIN, like the session, so a link the MES asked
 * for opens on the ERP's /magic-link page in the same browser.
 *
 * As long as the link lives (GoTrue's one hour), and carrying nothing but
 * when: it proves "this browser asked", not who for.
 */
const MAX_AGE_SECONDS = 60 * 60;

const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

const signInBrowserCookie = createCookie(authCookieName("carbon-sign-in"), {
  httpOnly: true,
  path: "/",
  sameSite: isTestEdition ? "none" : "lax",
  secrets: [SESSION_SECRET!],
  secure: isTestEdition || !!cookieDomain,
  domain: cookieDomain,
  maxAge: MAX_AGE_SECONDS
});

/** The Set-Cookie for a browser that just asked for a sign-in email. */
export function markSignInBrowser(): Promise<string> {
  return signInBrowserCookie.serialize({ at: Date.now() });
}

/** Whether this browser asked for a sign-in email within the link's life. */
export async function isSignInBrowser(request: Request): Promise<boolean> {
  const value = await signInBrowserCookie.parse(request.headers.get("Cookie"));
  const at = typeof value?.at === "number" ? value.at : 0;
  return Date.now() - at < MAX_AGE_SECONDS * 1000;
}
