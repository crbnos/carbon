// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN } from "@carbon/auth";
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
  if (mode === "system") {
    return cookie.serialize(cookieName, "", { path: "/", maxAge: -1 });
  } else {
    const cookieOptions: cookie.SerializeOptions = {
      path: "/",
      maxAge: 31536000
    };

    if (DOMAIN && !DOMAIN.startsWith("localhost")) {
      cookieOptions.domain = DOMAIN;
    }
    return cookie.serialize(cookieName, mode, cookieOptions);
  }
}
