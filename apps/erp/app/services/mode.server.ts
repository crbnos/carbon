// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import type { ModePreference } from "@carbon/utils";
import {
  getModeFromCookies,
  getUiScaleFromCookies,
  MODE_COOKIE
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
