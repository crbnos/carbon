// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { ThemeName } from "@carbon/utils";
import { resolveTheme, storedTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

/**
 * The theme to render: a seasonal theme while in season, for everyone;
 * otherwise the cookie's, or the default (`resolveTheme`).
 */
export function getTheme(request: Request): ThemeName {
  return resolveTheme(readCookie(request)).name;
}

/**
 * The everyday theme the user picked, whatever is in season: what a picker
 * shows as chosen and posts back (`storedTheme`).
 */
export function getStoredTheme(request: Request): ThemeName {
  return storedTheme(readCookie(request)).name;
}

function readCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  return cookieHeader ? cookie.parse(cookieHeader)[cookieName] : null;
}

export function setTheme(theme: string) {
  const cookieDomain = getCookieDomain(DOMAIN);
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: 31536000
  };

  return cookie.serialize(cookieName, theme, cookieOptions);
}
