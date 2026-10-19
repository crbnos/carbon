// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";
import type { Mode, ModePreference } from "./types";

/**
 * The user's explicit choice, `light` or `dark`. No cookie means `system`:
 * follow the operating system. Written by the apps' root action.
 */
export const MODE_COOKIE = "mode";

/**
 * What the operating system prefers, as the browser last reported it. Written
 * by `colorSchemeHintScript` (and on a live OS change) so the server renders a
 * `system` user in the right mode instead of guessing.
 */
export const COLOR_SCHEME_HINT_COOKIE = "carbon-prefers-color-scheme";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export const COLOR_SCHEME_HINT_MAX_AGE = 31536000;

function asMode(value: string | undefined): Mode | null {
  return value === "light" || value === "dark" ? value : null;
}

/**
 * Resolve the mode to render from a request's cookie header. An explicit
 * choice wins; otherwise the OS hint; otherwise light, which the hint script
 * corrects with one reload on the first visit from a dark-mode OS.
 */
export function getModeFromCookies(cookieHeader: string | null): {
  mode: Mode;
  modePreference: ModePreference;
} {
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const explicit = asMode(cookies[MODE_COOKIE]);
  if (explicit) return { mode: explicit, modePreference: explicit };

  return {
    mode: asMode(cookies[COLOR_SCHEME_HINT_COOKIE]) ?? "light",
    modePreference: "system"
  };
}

/**
 * Inline `<head>` script, run before first paint. It records the OS preference
 * in `COLOR_SCHEME_HINT_COOKIE`, and reloads only when the page was rendered in
 * the wrong mode: the user follows the system, and the server's guess (the
 * previous hint, or light when there was none) disagrees with the OS. It never
 * reloads when the cookie cannot be written, so blocked cookies cannot loop.
 */
export const colorSchemeHintScript = `(function () {
  try {
    if (!navigator.cookieEnabled) return;
    var hint = ${JSON.stringify(COLOR_SCHEME_HINT_COOKIE)};
    var actual = window.matchMedia(${JSON.stringify(PREFERS_DARK_QUERY)}).matches ? "dark" : "light";
    var cookies = {};
    document.cookie.split(";").forEach(function (part) {
      var i = part.indexOf("=");
      if (i > -1) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
    var reported = cookies[hint];
    if (reported === actual) return;
    document.cookie = hint + "=" + actual + "; Max-Age=${COLOR_SCHEME_HINT_MAX_AGE}; SameSite=Lax; Path=/";
    if (document.cookie.indexOf(hint + "=" + actual) === -1) return;
    var explicit = cookies[${JSON.stringify(MODE_COOKIE)}];
    if (explicit === "light" || explicit === "dark") return;
    var rendered = reported === "dark" ? "dark" : "light";
    if (rendered === actual) return;
    document.documentElement.style.visibility = "hidden";
    window.location.reload();
  } catch (e) {}
})();`;
