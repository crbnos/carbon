// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { ThemeName } from "@carbon/utils";
import { resolveTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

/**
 * The theme to render: a seasonal theme while in season, for everyone;
 * otherwise the cookie's, or the default (`resolveTheme`).
 */
export function getTheme(request: Request): ThemeName {
  const cookieHeader = request.headers.get("cookie");
  const stored = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : null;
  return resolveTheme(stored).name;
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
