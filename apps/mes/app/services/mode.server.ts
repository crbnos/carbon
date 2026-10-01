// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { Mode } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "mode";

export function getMode(request: Request): Mode | null {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[cookieName]
    : "light";
  if (parsed === "light" || parsed === "dark") return parsed;
  return null;
}

export function setMode(mode: Mode | "system") {
  const cookieDomain = getCookieDomain(DOMAIN);
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: mode === "system" ? -1 : 31536000
  };

  return cookie.serialize(
    cookieName,
    mode === "system" ? "" : mode,
    cookieOptions
  );
}
