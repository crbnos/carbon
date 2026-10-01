// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import * as cookie from "cookie";

const cookieName = "theme";
const themes = [
  "zinc",
  "neutral",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet"
] as const;
type Theme = (typeof themes)[number];

export function getTheme(request: Request): Theme {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : "zinc";
  if (themes.includes(parsed as Theme)) return parsed as Theme;
  return "zinc";
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
