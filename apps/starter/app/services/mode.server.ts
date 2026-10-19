// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN } from "@carbon/auth";
import type { ModePreference } from "@carbon/utils";
import { getModeFromCookies, MODE_COOKIE } from "@carbon/utils";
import * as cookie from "cookie";

/** `mode` is what to render; `modePreference` is what the user chose. */
export function getMode(request: Request) {
  return getModeFromCookies(request.headers.get("cookie"));
}

export function setMode(mode: ModePreference) {
  if (mode === "system") {
    return cookie.serialize(MODE_COOKIE, "", { path: "/", maxAge: -1 });
  } else {
    const cookieOptions: cookie.SerializeOptions = {
      path: "/",
      maxAge: 31536000
    };

    if (DOMAIN && !DOMAIN.startsWith("localhost")) {
      cookieOptions.domain = DOMAIN;
    }
    return cookie.serialize(MODE_COOKIE, mode, cookieOptions);
  }
}
