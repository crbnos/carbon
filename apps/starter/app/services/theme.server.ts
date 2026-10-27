// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ThemeName } from "@carbon/utils";
import { themeCookieWrites, themeForRequest } from "@carbon/utils";
import * as cookie from "cookie";

/** The theme to render (`themeForRequest`). */
export function getTheme(request: Request): ThemeName {
  return themeForRequest(
    request.headers.get("cookie"),
    new URL(request.url).pathname
  ).name;
}

/** The `Set-Cookie` headers for a theme pick (`themeCookieWrites`). */
export function setTheme(theme: string, { inApp }: { inApp: boolean }) {
  const headers = new Headers();
  for (const { name, value, maxAge } of themeCookieWrites(theme, { inApp })) {
    headers.append(
      "Set-Cookie",
      cookie.serialize(name, value, { path: "/", maxAge })
    );
  }
  return headers;
}
