// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { ThemeName } from "@carbon/utils";
import { resolveTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

/**
 * The theme to render: the cookie's, unless a seasonal theme is forced, or
 * the default when it names none we offer now (`resolveTheme`).
 */
export function getTheme(request: Request): ThemeName {
  const cookieHeader = request.headers.get("cookie");
  const stored = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : null;
  return resolveTheme(stored).name;
}

export function setTheme(theme: string) {
  const cookieDomain = getCookieDomain(DOMAIN);
  return cookie.serialize(cookieName, theme, {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: 31536000
  });
}
