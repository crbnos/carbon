// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ThemeName } from "@carbon/utils";
import { halloweenTheme, resolveTheme } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "theme";

/**
 * The theme to render: Halloween for everyone while it is in season, whatever
 * the cookie holds; the default outside its window.
 */
export function getTheme(_request: Request): ThemeName {
  return resolveTheme(halloweenTheme.name).name;
}

export function setTheme(theme: string) {
  return cookie.serialize(cookieName, theme, { path: "/", maxAge: 31536000 });
}
