// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  return cookie.serialize(cookieName, theme, { path: "/", maxAge: 31536000 });
}
