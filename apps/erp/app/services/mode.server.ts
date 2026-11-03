// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { ModePreference } from "@carbon/utils";
import {
  DEFAULT_WINDOW_THEME,
  getModeFromCookies,
  getUiScaleFromCookies,
  getWindowThemeFromCookies,
  MODE_COOKIE,
  WINDOW_THEME_COOKIE
} from "@carbon/utils";
import * as cookie from "cookie";

/** `mode` is what to render; `modePreference` is what the user chose. */
export function getMode(request: Request) {
  return getModeFromCookies(request.headers.get("cookie"));
}

export function setMode(mode: ModePreference) {
  const cookieDomain = getCookieDomain(DOMAIN);
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: mode === "system" ? -1 : 31536000
  };

  return cookie.serialize(
    MODE_COOKIE,
    mode === "system" ? "" : mode,
    cookieOptions
  );
}

/** The text size and density to render (`@carbon/utils` `ui-scale`). */
export function getUiScale(request: Request) {
  return getUiScaleFromCookies(request.headers.get("cookie"));
}

/** Stores one text size or density choice; `default` clears its cookie. */
export function setUiScale(name: string, value: string) {
  const cookieDomain = getCookieDomain(DOMAIN);
  return cookie.serialize(name, value === "default" ? "" : value, {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: value === "default" ? -1 : 31536000
  });
}

/** The window theme to render (`@carbon/utils` `window-themes`), or `null`. */
export function getWindowTheme(request: Request) {
  return getWindowThemeFromCookies(request.headers.get("cookie"));
}

/** Stores a window theme choice; `default` clears its cookie. */
export function setWindowTheme(value: string) {
  const cookieDomain = getCookieDomain(DOMAIN);
  const isDefault = value === DEFAULT_WINDOW_THEME;
  return cookie.serialize(WINDOW_THEME_COOKIE, isDefault ? "" : value, {
    path: "/",
    sameSite: "lax",
    secure: !!cookieDomain,
    domain: cookieDomain,
    maxAge: isDefault ? -1 : 31536000
  });
}
